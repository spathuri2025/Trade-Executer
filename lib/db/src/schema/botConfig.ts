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
