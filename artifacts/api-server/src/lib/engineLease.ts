import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, engineLeasesTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Ownership leases for the per-user trading engines.
 *
 * Why this exists: Render's zero-downtime deploy runs the outgoing and incoming
 * instances at the same time for a few seconds. Both read `running = true` and
 * both resume every bot, so one signal produced two cycles — harmless in dry
 * run, two real orders otherwise. `numInstances: 1` does not cover the handover.
 *
 * The rule the rest of the engine relies on: **a process may place orders for a
 * user only while it holds an unexpired lease on that user's engine.** Losing
 * the lease is treated exactly like being stopped.
 *
 * Correctness rests on three things:
 *
 *  1. Acquisition is ONE statement. An "is it free? then take it" pair of
 *     queries is a race with a window between them — precisely the window two
 *     instances start up in. The upsert below decides in the database.
 *  2. Every expiry comparison uses the DATABASE clock (`now()`), never
 *     `Date.now()`. Two processes may disagree about the time; they cannot
 *     disagree about the database's answer.
 *  3. A crashed owner needs no cleanup. Its lease expires on its own and the
 *     next process takes over — at worst LEASE_TTL_MS later.
 */

/** Identifies THIS process. Regenerated on every boot, so no two instances collide. */
export const INSTANCE_ID = `${process.pid}-${crypto.randomBytes(6).toString("hex")}`;

/**
 * How long a lease survives without renewal.
 *
 * The trade-off: too short and a slow event loop (a long broker call, GC) can
 * let a healthy owner lose its own lease; too long and a crashed instance's
 * engines stay frozen until it lapses. 90s tolerates two missed renewals and
 * still hands over well inside a deploy. Graceful shutdown releases immediately,
 * so the TTL only governs the crash case.
 */
export const LEASE_TTL_MS = 90_000;

/** Renewal cadence — a third of the TTL, so two consecutive failures are survivable. */
export const LEASE_RENEW_MS = 30_000;

export type LeaseResource = "bot" | "scanner";

/**
 * Thrown when another live process holds the lease for an engine. Not a
 * failure: the engine is running, elsewhere. Callers must report it as "already
 * running" and never clear the user's `running` intent.
 */
export class EngineOwnedElsewhereError extends Error {}

const ttlInterval = sql`make_interval(secs => ${LEASE_TTL_MS / 1000})`;

/**
 * Claim (or re-claim) a lease. Returns true only if this process owns it after
 * the statement runs.
 *
 * The `where` on the conflict branch is what makes this safe: an existing row is
 * overwritten ONLY when it has expired or already belongs to us. A live lease
 * held by another process fails the predicate, no row comes back, and we know we
 * did not get it. Re-acquiring our own lease is deliberately allowed — it is how
 * renewal and repeated start clicks behave harmlessly.
 */
export async function acquireLease(userId: number, resource: LeaseResource): Promise<boolean> {
  try {
    const rows = await db
      .insert(engineLeasesTable)
      .values({
        userId,
        resource,
        ownerId: INSTANCE_ID,
        expiresAt: sql`now() + ${ttlInterval}`,
      })
      .onConflictDoUpdate({
        target: [engineLeasesTable.userId, engineLeasesTable.resource],
        set: {
          ownerId: INSTANCE_ID,
          expiresAt: sql`now() + ${ttlInterval}`,
          renewedAt: sql`now()`,
          acquiredAt: sql`case when ${engineLeasesTable.ownerId} = ${INSTANCE_ID}
                               then ${engineLeasesTable.acquiredAt} else now() end`,
        },
        setWhere: sql`${engineLeasesTable.expiresAt} < now() OR ${engineLeasesTable.ownerId} = ${INSTANCE_ID}`,
      })
      .returning({ ownerId: engineLeasesTable.ownerId });

    return rows.length > 0;
  } catch (err) {
    // Fail CLOSED. A database we cannot reach is not permission to trade — and
    // the one moment this is most likely to happen (a deploy) is exactly when
    // another instance may be holding the lease.
    logger.error({ userId, resource, err }, "Could not acquire engine lease — treating as NOT owned");
    return false;
  }
}

/**
 * Extend a lease we already hold. False means we lost it: another process took
 * over after ours expired, or the row was deleted. The caller must stop.
 */
export async function renewLease(userId: number, resource: LeaseResource): Promise<boolean> {
  try {
    const rows = await db
      .update(engineLeasesTable)
      .set({ expiresAt: sql`now() + ${ttlInterval}`, renewedAt: sql`now()` })
      .where(
        and(
          eq(engineLeasesTable.userId, userId),
          eq(engineLeasesTable.resource, resource),
          eq(engineLeasesTable.ownerId, INSTANCE_ID)
        )
      )
      .returning({ ownerId: engineLeasesTable.ownerId });

    return rows.length > 0;
  } catch (err) {
    // Deliberately fails OPEN, unlike acquire. A transient database blip must
    // not stop a bot that is genuinely still ours — we keep the lease we already
    // hold until it actually expires, and holdsLease() re-checks before orders.
    logger.warn({ userId, resource, err }, "Lease renewal failed — keeping the lease until it expires");
    return true;
  }
}

/**
 * Is this process still the owner, right now, by the database's clock?
 *
 * Called before placing orders. In-memory `running` is not sufficient: a process
 * that has lost its lease still believes it is running until its next renewal.
 */
export async function holdsLease(userId: number, resource: LeaseResource): Promise<boolean> {
  try {
    const [row] = await db
      .select({ ownerId: engineLeasesTable.ownerId })
      .from(engineLeasesTable)
      .where(
        and(
          eq(engineLeasesTable.userId, userId),
          eq(engineLeasesTable.resource, resource),
          eq(engineLeasesTable.ownerId, INSTANCE_ID),
          sql`${engineLeasesTable.expiresAt} > now()`
        )
      );
    return row !== undefined;
  } catch (err) {
    logger.error({ userId, resource, err }, "Could not verify engine lease — treating as NOT owned");
    return false;
  }
}

/**
 * Give up a lease we hold. Scoped to our own owner id so a late release can
 * never revoke the lease a successor has already taken.
 *
 * This is what makes a deploy handover instant rather than TTL-bound: the
 * outgoing process releases on SIGTERM and the incoming one acquires straight
 * away, instead of both waiting 90 seconds.
 */
export async function releaseLease(userId: number, resource: LeaseResource): Promise<void> {
  try {
    await db
      .delete(engineLeasesTable)
      .where(
        and(
          eq(engineLeasesTable.userId, userId),
          eq(engineLeasesTable.resource, resource),
          eq(engineLeasesTable.ownerId, INSTANCE_ID)
        )
      );
  } catch (err) {
    // Not fatal: the lease expires on its own, so the worst case is a slower
    // handover rather than a stuck engine.
    logger.warn({ userId, resource, err }, "Could not release engine lease — it will expire on its own");
  }
}

/** Release every lease this process holds. Used on graceful shutdown. */
export async function releaseAllLeases(): Promise<void> {
  try {
    const rows = await db
      .delete(engineLeasesTable)
      .where(eq(engineLeasesTable.ownerId, INSTANCE_ID))
      .returning({ userId: engineLeasesTable.userId });
    if (rows.length > 0) {
      logger.info({ instanceId: INSTANCE_ID, released: rows.length }, "Released engine leases on shutdown");
    }
  } catch (err) {
    logger.warn({ err }, "Could not release engine leases on shutdown — they will expire on their own");
  }
}
