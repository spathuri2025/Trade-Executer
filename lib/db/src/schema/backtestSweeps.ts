import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

import { usersTable } from "./users";

/**
 * One parameter sweep: every enabled instrument × timeframe × strategy ×
 * parameter set, backtested and scored.
 *
 * Stored rather than computed per request because a full sweep makes dozens of
 * paced broker calls and takes minutes — far longer than an HTTP request should
 * live. The route starts a run and returns immediately; the UI polls this row.
 *
 * `summary` and `results` are JSON text, matching the codebase's existing
 * preference for portable text columns (see contracts.fileData) over jsonb.
 */
export const backtestSweepsTable = pgTable("backtest_sweeps", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["running", "complete", "failed"] }).notNull().default("running"),
  /** Progress for the UI while running: combos scored so far, and the total planned. */
  combosDone: integer("combos_done").notNull().default(0),
  combosTotal: integer("combos_total").notNull().default(0),
  /** JSON SweepSummary — the verdict and aggregate statistics. */
  summary: text("summary"),
  /** JSON SweepCombo[] — every combination scored, best first. */
  results: text("results"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export type BacktestSweepRow = typeof backtestSweepsTable.$inferSelect;
