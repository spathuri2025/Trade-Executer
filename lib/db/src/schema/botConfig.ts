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
  /**
   * Close positions this many minutes before their market's session ends, and
   * open nothing new that close to it. Avoids holding through an overnight or
   * weekend gap, where a price can jump straight past a stop-loss. Only a
   * session end followed by a real break counts — not a short daily pause.
   * 0 = disabled (the default, so existing users' behaviour is unchanged).
   */
  closeBeforeSessionEndMinutes: integer("close_before_session_end_minutes").notNull().default(0),
  /**
   * Ceiling on TOTAL exposure to one instrument, as a percent of account value,
   * counting every open position in it and both directions.
   *
   * maxPositionSizePercent caps a single ORDER, which is not the same thing: on
   * 22-23 Sep 2026 the engine sold SMCI 0.36 units at a time, 108 orders, into
   * a 39-unit short worth ~80% of the account. Every existing limit was obeyed
   * — the concurrent-position cap counts distinct instruments, so adding to one
   * already held is free. 0 = disabled.
   */
  /** Which trading profile is currently applied. Display only — the engine reads the columns here. */
  activeProfileId: integer("active_profile_id"),
  maxInstrumentExposurePercent: real("max_instrument_exposure_percent").notNull().default(0),
  /** Ceiling on total exposure across all instruments, same units. 0 = disabled. */
  maxTotalExposurePercent: real("max_total_exposure_percent").notNull().default(0),
  /**
   * Stop opening new positions for the rest of the UTC day once equity is up
   * this much from the day's start, in account currency. Closes still go
   * through. 0 = disabled.
   */
  dailyProfitTarget: real("daily_profit_target").notNull().default(0),
  /**
   * The account must never trade below this equity, in account currency.
   *
   * Every other loss limit here is a PERCENTAGE of a baseline that re-bases:
   * the day's open, the week's open, the intraday peak. An account can fall
   * indefinitely in individually compliant steps. This one does not move, which
   * makes it the only limit that answers "never below X". 0 = disabled, and it
   * stays disabled by default because a floor set by guesswork would halt a
   * healthy account.
   */
  equityFloor: real("equity_floor").notNull().default(0),
  /**
   * Halt when equity falls this far below the week's opening equity (ISO week,
   * Monday-based). Five days each losing 1.9% break no daily limit and still
   * cost 9% of the account; nothing in the product saw that until this existed.
   */
  maxWeeklyLossPercent: real("max_weekly_loss_percent").notNull().default(5),
  /**
   * Halt after this many losing closes in a row. 0 = disabled.
   *
   * A losing streak is the signal that conditions have changed under the
   * strategy — the limits above only notice once the money is already gone.
   * Counted from the broker's own transaction history, since most closes are
   * stop-losses that never pass through the bot.
   */
  maxConsecutiveLosses: integer("max_consecutive_losses").notNull().default(6),
  /**
   * Minimum minutes between opening positions in the SAME instrument. 0 = off.
   *
   * On 24 Sep 2026 a mode switch re-armed the cycle timer, firing a second
   * cycle 10 seconds after the first, and GOLD and US500 were each bought twice
   * — the broker's position list had not caught up, so the open-position check
   * could not see the first fill. This cooldown reads our own order log, which
   * had both.
   */
  reentryCooldownMinutes: integer("reentry_cooldown_minutes").notNull().default(5),
  /**
   * When true, the bot holds at most ONE position per instrument: a same-side
   * order on an instrument already held is refused.
   *
   * Pyramiding is how the 39-unit SMCI short was built one compliant order at a
   * time. The exposure caps bound the damage; this stops it being built at all.
   */
  onePositionPerInstrument: boolean("one_position_per_instrument").notNull().default(true),
  /**
   * Ceiling on NET directional exposure — longs minus shorts — as a percent of
   * account value. 0 = disabled.
   *
   * Every other cap here is per instrument or gross, and neither notices that
   * several positions are the same bet. On 24 Sep 2026 the bot held £250 short
   * in gold and £250 short in each of two US indices: three positions at 5% of
   * the account apiece, well inside every limit, and in substance one £750 bet
   * that everything falls together. Correlated markets do not diversify.
   */
  maxNetDirectionalPercent: real("max_net_directional_percent").notNull().default(0),
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
