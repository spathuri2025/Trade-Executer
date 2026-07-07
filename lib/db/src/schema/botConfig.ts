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
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BotConfigRow = typeof botConfigTable.$inferSelect;
