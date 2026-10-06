import { pgTable, serial, integer, real, text, timestamp, index } from "drizzle-orm/pg-core";

import { usersTable } from "./users";

/**
 * Simulated positions, so a dry run can be measured.
 *
 * Dry run used to write an entry row into `trades` and stop. Open positions are
 * read from the broker, and in dry run the broker has none — so the engine saw
 * an empty book every cycle, treated every signal as a fresh entry, and nothing
 * ever closed. A week of it produced entries and no profit or loss, which is
 * the only thing a dry run is for.
 *
 * Positions live here instead, with the stop and target they would have been
 * given, and are resolved against real subsequent bars.
 */
export const paperPositionsTable = pgTable(
  "paper_positions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    ticker: text("ticker").notNull(),
    side: text("side", { enum: ["BUY", "SELL"] }).notNull(),
    quantity: real("quantity").notNull(),
    entryPrice: real("entry_price").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    /** Price levels, not percentages — the percentages can change under an open position. */
    stopLevel: real("stop_level"),
    targetLevel: real("target_level"),
    /** Which strategy opened it, so results can be attributed rather than averaged. */
    strategy: text("strategy"),
    regime: text("regime"),
    exitPrice: real("exit_price"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** "stop-loss" | "take-profit" | "signal" — how it ended. Null while open. */
    exitReason: text("exit_reason"),
    /**
     * Realised result in account currency, GROSS of spread. Entry and exit come
     * from mid-price bars, so live results would be worse by roughly the spread
     * on every trade — between 0.085% and 0.5% on this account's instruments.
     * Anything reporting this figure has to say so.
     */
    pnl: real("pnl"),
  },
  (t) => [index("paper_positions_user_open").on(t.userId, t.closedAt)]
);

export type PaperPositionRow = typeof paperPositionsTable.$inferSelect;
