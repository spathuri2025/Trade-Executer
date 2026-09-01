import { pgTable, integer, text, timestamp, primaryKey } from "drizzle-orm/pg-core";

import { usersTable } from "./users";

/**
 * Which process currently owns a user's trading engine.
 *
 * The problem this solves, observed in production on 30 Aug 2026: Render does
 * zero-downtime deploys, so the new instance boots and passes its health check
 * BEFORE the old one is killed. For a few seconds both are alive, and both read
 * `bot_config.running = true` and resume every running bot. Two processes then
 * act on the same signal. In dry run that showed up as two interleaved sets of
 * signal rows milliseconds apart; with dry run off it is two real orders.
 *
 * `numInstances: 1` in render.yaml does NOT prevent this — it governs
 * steady-state scaling, not the deploy handover.
 *
 * A lease is a claim with an expiry. A process may only run an engine while it
 * holds an unexpired lease, and must keep renewing to keep it. If the process
 * dies, the lease simply expires and the next one takes over — no cleanup
 * needed, and nothing is left permanently locked by a crash.
 *
 * `resource` scopes the claim: "bot" and "scanner" are separate engines for the
 * same user, so they are separate rows and can be owned independently.
 */
export const engineLeasesTable = pgTable(
  "engine_leases",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** "bot" | "scanner" — plain text, since the set is ours and small. */
    resource: text("resource").notNull(),
    /**
     * Identifies the owning PROCESS, not the machine or the user: a fresh random
     * id is generated at boot. Two instances of the same deploy therefore never
     * share one, which is the entire point.
     */
    ownerId: text("owner_id").notNull(),
    /**
     * The lease is void from this moment unless renewed. Every acquire/renew
     * decision compares against the DATABASE's clock (now()), never the Node
     * process's — two instances with skewed clocks must still agree on who owns
     * what, and the database is the only clock they share.
     */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull().defaultNow(),
    renewedAt: timestamp("renewed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.resource] })]
);

export type EngineLeaseRow = typeof engineLeasesTable.$inferSelect;
