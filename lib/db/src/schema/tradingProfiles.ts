import { pgTable, serial, integer, real, text, timestamp, unique } from "drizzle-orm/pg-core";

import { usersTable } from "./users";

/**
 * Named trading modes — "Scalping", "Intraday" — that a user switches between
 * in one click.
 *
 * Switching mode by hand meant editing six fields, and on 24 Sep 2026 two of
 * them landed as 0 on separate attempts (0 means "disabled" for both Max
 * Concurrent Positions and Take-Profit, so each silently removed a control).
 * A profile applies the whole set atomically.
 *
 * A profile holds only HOW the engine trades. It deliberately does NOT hold
 * risk per trade, concurrent positions, trades per day, the daily loss and
 * drawdown limits, or the exposure caps: those are account-level and must
 * survive every switch, or changing mode could quietly loosen a safety limit.
 */
export const tradingProfilesTable = pgTable(
  "trading_profiles",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    strategyMode: text("strategy_mode", { enum: ["auto", "scalp"] }).notNull(),
    barResolution: text("bar_resolution", {
      enum: ["MINUTE", "MINUTE_5", "MINUTE_15", "MINUTE_30", "HOUR", "HOUR_4", "DAY", "WEEK"],
    }).notNull(),
    intervalMinutes: integer("interval_minutes").notNull(),
    stopLossPercent: real("stop_loss_percent").notNull(),
    takeProfitPercent: real("take_profit_percent").notNull(),
    /** Only consulted in scalp mode, but stored per profile so each carries its own. */
    minEdgeVsSpread: real("min_edge_vs_spread").notNull(),
    aiTradeMode: text("ai_trade_mode", { enum: ["off", "guard", "autonomous"] }).notNull(),
    minAiConfidence: text("min_ai_confidence", { enum: ["any", "medium", "high"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("trading_profiles_user_name").on(t.userId, t.name)]
);

export type TradingProfileRow = typeof tradingProfilesTable.$inferSelect;

/**
 * When each mode was switched on.
 *
 * Without this, a week of results is a mixture of modes with no way to tell
 * which produced what — and the whole point of having modes is to find out
 * which one makes money.
 */
export const profileActivationsTable = pgTable("profile_activations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  /** Name rather than id: the record must stay readable if the profile is renamed or deleted. */
  profileName: text("profile_name").notNull(),
  activatedAt: timestamp("activated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProfileActivationRow = typeof profileActivationsTable.$inferSelect;
