/**
 * Subscription plan entitlements — the single source of truth for what a given
 * user is allowed to do.
 *
 * The `subscriptions` table existed for a while as pure record-keeping (the
 * Admin Centre wrote to it, nothing read it). This module is what finally makes
 * it mean something: every gate in the app resolves through `getPlanLimits`.
 *
 * Deliberately NOT cached. It's one indexed query per bot cycle / per AI
 * request, and caching would delay both an upgrade taking effect and — more
 * importantly — a lapsed subscription losing access.
 */
import { and, eq, lt, sql } from "drizzle-orm";
import { db, usersTable, subscriptionsTable, aiUsageTable } from "@workspace/db";

export type PlanName = "free" | "starter" | "pro" | "enterprise";

export interface PlanLimits {
  /** May place real (non-dry-run) orders. */
  liveTrading: boolean;
  /** May use the AI guard / autonomous trade modes. */
  aiTradeModes: boolean;
  /** Max tracked instruments. Infinity = uncapped. */
  maxInstruments: number;
  /** Max user-initiated AI requests per UTC day. Infinity = uncapped. */
  aiQueriesPerDay: number;
}

/**
 * Tune pricing tiers here — this constant is the whole product's entitlement
 * matrix. The two metered limits target the real variable costs: instruments
 * drive broker API calls, AI queries drive Claude tokens.
 */
export const PLAN_LIMITS: Record<PlanName, PlanLimits> = {
  free: { liveTrading: false, aiTradeModes: false, maxInstruments: 3, aiQueriesPerDay: 10 },
  starter: { liveTrading: true, aiTradeModes: false, maxInstruments: 10, aiQueriesPerDay: 50 },
  pro: { liveTrading: true, aiTradeModes: true, maxInstruments: 30, aiQueriesPerDay: 200 },
  enterprise: { liveTrading: true, aiTradeModes: true, maxInstruments: Infinity, aiQueriesPerDay: Infinity },
};

/**
 * Only these subscription statuses actually entitle anything. This is what
 * gives "past_due" and "canceled" teeth — before this, they were decorative
 * labels in the Admin Centre.
 */
const ENTITLING_STATUSES = new Set(["active", "trialing"]);

/**
 * Resolve a user's effective plan, which is not simply `subscriptions.plan`:
 *  - admins always get the top tier, so the operator can never lock themselves
 *    out of their own product by mis-setting a row;
 *  - no subscription row at all means free (new signups);
 *  - a non-entitling status downgrades to free regardless of the plan named on
 *    the row — a `past_due` "pro" is a free user until they settle up.
 */
export async function getEffectivePlan(userId: number): Promise<PlanName> {
  const [row] = await db
    .select({
      role: usersTable.role,
      plan: subscriptionsTable.plan,
      status: subscriptionsTable.status,
    })
    .from(usersTable)
    .leftJoin(subscriptionsTable, eq(subscriptionsTable.userId, usersTable.id))
    .where(eq(usersTable.id, userId));

  // Unknown user id — fail closed to the least-privileged plan.
  if (!row) return "free";
  if (row.role === "admin") return "enterprise";
  if (!row.plan || !row.status) return "free";
  if (!ENTITLING_STATUSES.has(row.status)) return "free";
  return row.plan;
}

export async function getPlanLimits(userId: number): Promise<PlanLimits> {
  return PLAN_LIMITS[await getEffectivePlan(userId)];
}

/** UTC calendar-day key ('YYYY-MM-DD') used to bucket daily AI usage. */
export function utcDayKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export interface QuotaResult {
  allowed: boolean;
  used: number;
  limit: number;
}

/**
 * Atomically consume one AI request from today's allowance.
 *
 * The increment is guarded by a `where count < limit` on the upsert's update
 * branch, so concurrent requests can't both slip past the cap and the stored
 * counter never inflates past the limit on rejected calls. A rejected request
 * costs one extra read (to report the current usage) — rare and cheap.
 */
export async function consumeAiQuota(userId: number): Promise<QuotaResult> {
  const { aiQueriesPerDay: limit } = await getPlanLimits(userId);
  if (limit === Infinity) return { allowed: true, used: 0, limit };
  // A zero (or negative) allowance can't go through the insert path below —
  // the first request of the day would have no existing row to conflict with
  // and would be allowed through.
  if (limit <= 0) return { allowed: false, used: 0, limit };

  const day = utcDayKey();
  const [row] = await db
    .insert(aiUsageTable)
    .values({ userId, day, count: 1 })
    .onConflictDoUpdate({
      target: [aiUsageTable.userId, aiUsageTable.day],
      set: { count: sql`${aiUsageTable.count} + 1`, updatedAt: new Date() },
      where: lt(aiUsageTable.count, limit),
    })
    .returning();

  if (row) return { allowed: true, used: row.count, limit };

  // No row returned => the conflict fired but the guard rejected the update,
  // i.e. the user is already at their cap for today.
  const [current] = await db
    .select({ count: aiUsageTable.count })
    .from(aiUsageTable)
    .where(and(eq(aiUsageTable.userId, userId), eq(aiUsageTable.day, day)));
  return { allowed: false, used: current?.count ?? limit, limit };
}

/**
 * Standard 402 body for an exhausted AI allowance. Shared so all five metered
 * endpoints phrase the limit identically.
 */
export function aiQuotaExceededBody(quota: QuotaResult) {
  return {
    error: `You've used all ${quota.limit} AI requests included in your plan today. Your allowance resets at midnight UTC.`,
    used: quota.used,
    limit: quota.limit,
  };
}

/** Today's usage without consuming any — for display (e.g. GET /plan). */
export async function getAiQuotaUsage(userId: number): Promise<QuotaResult> {
  const { aiQueriesPerDay: limit } = await getPlanLimits(userId);
  const [current] = await db
    .select({ count: aiUsageTable.count })
    .from(aiUsageTable)
    .where(and(eq(aiUsageTable.userId, userId), eq(aiUsageTable.day, utcDayKey())));
  const used = current?.count ?? 0;
  return { allowed: used < limit, used, limit };
}
