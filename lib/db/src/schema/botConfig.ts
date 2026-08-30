import { pgTable, serial, integer, real, boolean, text, timestamp } from "drizzle-orm/pg-core";

import { usersTable } from "./users";

/**
 * One row per user — persists BotConfig (artifacts/api-server/src/lib/botEngine.ts)
 * so per-tenant settings survive a server restart. `real` (not `numeric`) is used
 * for the percent/period fields since these are plain config numbers, not
 * money — unlike trades/scannerResults, which use numeric for financial precision.
 */
export const botConfigTable = pgTable("bot_config", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .unique()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  shortPeriod: integer("short_period").notNull().default(9),
  longPeriod: integer("long_period").notNull().default(21),
  tradeAmount: real("trade_amount").notNull().default(50),
  intervalMinutes: integer("interval_minutes").notNull().default(60),
  dryRun: boolean("dry_run").notNull().default(true),
  broker: text("broker", { enum: ["trading212", "capitalcom"] }).notNull().default("capitalcom"),
  stopLossPercent: real("stop_loss_percent").notNull().default(2),
  takeProfitPercent: real("take_profit_percent").notNull().default(4),
  riskPerTradePercent: real("risk_per_trade_percent").notNull().default(1),
  maxPositionSizePercent: real("max_position_size_percent").notNull().default(5),
  maxDailyLossPercent: real("max_daily_loss_percent").notNull().default(3),
  maxConcurrentPositions: integer("max_concurrent_positions").notNull().default(5),
  aiTradeMode: text("ai_trade_mode", { enum: ["off", "guard", "autonomous"] }).notNull().default("off"),
  /**
   * Minimum AI conviction required before a trade is placed in guard or
   * autonomous mode. "any" preserves the original behaviour of acting on every
   * decision regardless of stated confidence — which in practice meant trading
   * on "low" almost every time.
   */
  minAiConfidence: text("min_ai_confidence", { enum: ["any", "medium", "high"] }).notNull().default("any"),
  /**
   * "auto" keeps the regime router (trend-following / mean-reversion).
   * "scalp" routes every instrument to the fast micro-reversion strategy and
   * bypasses the regime filter — a 1-minute ADX reading is noise.
   */
  strategyMode: text("strategy_mode", { enum: ["auto", "scalp"] }).notNull().default("auto"),
  /**
   * How many times the expected move must exceed the live round-trip spread
   * before a scalp order is placed. The central risk control of the fast
   * engine: at speed the spread is fixed while the captured move shrinks, so
   * without this hurdle a scalper reliably pays more than it earns.
   */
  minEdgeVsSpread: real("min_edge_vs_spread").notNull().default(3),
  /** Hard churn cap per UTC day. 0 = unlimited. */
  maxTradesPerDay: integer("max_trades_per_day").notNull().default(50),
  /**
   * Halts the engine when equity falls this far from its INTRADAY PEAK (not
   * the day's open, which maxDailyLossPercent already covers). Strictly
   * tighter, and what a fast engine needs. 0 = disabled.
   */
  maxIntradayDrawdownPercent: real("max_intraday_drawdown_percent").notNull().default(2),
  regimeFilterEnabled: boolean("regime_filter_enabled").notNull().default(true),
  costPerTradePercent: real("cost_per_trade_percent").notNull().default(0),
  /** Capital.com candle resolution the bot/scanner/backtest all fetch bars at. */
  barResolution: text("bar_resolution", {
    enum: ["MINUTE", "MINUTE_5", "MINUTE_15", "MINUTE_30", "HOUR", "HOUR_4", "DAY", "WEEK"],
  })
    .notNull()
    .default("MINUTE_5"),
  /**
   * Whether the user WANTS the bot running. Not a live status — the running bot
   * itself is in-memory state on one instance (see botEngine.ts). This column
   * exists so `resumeRunningBots()` can re-arm those timers after a restart;
   * without it every deploy silently stopped every customer's bot.
   *
   * Written only by startBot/stopBot. A tripped daily-loss circuit breaker
   * stops the bot through stopBot too, so it persists as false and stays
   * stopped across a restart — the breaker must never auto-resume.
   */
  running: boolean("running").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BotConfigRow = typeof botConfigTable.$inferSelect;
