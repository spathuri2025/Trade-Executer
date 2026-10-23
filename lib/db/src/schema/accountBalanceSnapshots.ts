import { pgTable, serial, integer, real, text, timestamp, index } from "drizzle-orm/pg-core";

import { usersTable } from "./users";

/**
 * The account's cash balance, recorded each time the morning report runs.
 *
 * Capital.com's transaction feed does not itemise everything that moves the
 * balance. On 23 Oct 2026 the account's own export showed −£696.32 of spot-oil
 * price adjustments in a week; the API returned the trades and the overnight
 * fees for the same week to the penny, and not one adjustment row. Nothing the
 * app read could show them.
 *
 * The cash balance does move by them. So the change in cash between two
 * snapshots, minus every row the feed DID itemise, is what the broker moved
 * without saying — measured, not assumed. Only snapshots whose figures agree
 * with each other (equity = cash + open P&L) are trusted.
 */
export const accountBalanceSnapshotsTable = pgTable(
  "account_balance_snapshots",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull().defaultNow(),
    /** Realised cash: Capital.com's `deposit`. Excludes open positions. */
    cashBalance: real("cash_balance").notNull(),
    /** Capital.com's `balance`: cash plus open profit or loss. */
    equity: real("equity").notNull(),
    /** Open profit or loss at the time. */
    openPnl: real("open_pnl").notNull(),
    currency: text("currency"),
  },
  (t) => [index("account_balance_snapshots_user_time").on(t.userId, t.takenAt)]
);

export type AccountBalanceSnapshotRow = typeof accountBalanceSnapshotsTable.$inferSelect;
