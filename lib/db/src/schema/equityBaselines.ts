import { pgTable, integer, real, text, timestamp } from "drizzle-orm/pg-core";

import { usersTable } from "./users";

/**
 * The equity baselines every loss limit measures against.
 *
 * These lived only in the engine's memory. A deploy mid-session therefore
 * re-opened the day from whatever equity the new process first saw: an account
 * already £80 down started again from zero and could lose the full daily limit
 * a second time before the day ended. Render's zero-downtime deploys mean this
 * happened on every release.
 *
 * One row per user, keyed by user_id, rewritten in place. There is no history
 * here on purpose — this is the engine's working state, and the record of what
 * an account actually made lives in the broker's transaction history.
 */
export const equityBaselinesTable = pgTable("equity_baselines", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  /** UTC calendar day the daily marks belong to, "YYYY-MM-DD". */
  dayKey: text("day_key"),
  dayStartEquity: real("day_start_equity"),
  dayPeakEquity: real("day_peak_equity"),
  /** ISO week the weekly mark belongs to, "YYYY-Www". */
  weekKey: text("week_key"),
  weekStartEquity: real("week_start_equity"),
  /** The day the daily profit target was hit, so the lock survives a restart too. */
  profitLockedDayKey: text("profit_locked_day_key"),
  /**
   * Closes before this instant are ignored by the losing-streak breaker.
   *
   * Set when a halted bot is resumed. Without it, resuming re-reads the same
   * run of losses that caused the halt and trips again on the next cycle — the
   * bot could never be restarted at all.
   */
  lossStreakResetAt: timestamp("loss_streak_reset_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type EquityBaselineRow = typeof equityBaselinesTable.$inferSelect;
