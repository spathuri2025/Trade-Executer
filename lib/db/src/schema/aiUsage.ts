import { pgTable, serial, integer, text, timestamp, unique } from "drizzle-orm/pg-core";

import { usersTable } from "./users";

/**
 * Per-user, per-day counter for user-initiated AI requests (assistant chat,
 * signal analyst, chart insight, etc.) — the meter behind each plan's
 * `aiQueriesPerDay` limit.
 *
 * `day` is a plain 'YYYY-MM-DD' UTC key rather than a rolling time window:
 * "your allowance resets at midnight UTC" is something a user can actually
 * predict, and old rows are harmless (no cleanup job needed) since every
 * lookup is scoped to today's key.
 *
 * Only counts requests a user personally triggered. The bot's own AI calls
 * (guard/autonomous mode) are gated by the plan's `aiTradeModes` flag instead
 * — metering those would fail a trading cycle mid-flight.
 */
export const aiUsageTable = pgTable(
  "ai_usage",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** UTC calendar day, 'YYYY-MM-DD'. */
    day: text("day").notNull(),
    count: integer("count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.userId, table.day)],
);

export type AiUsageRow = typeof aiUsageTable.$inferSelect;
