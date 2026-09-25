import {
  db,
  instrumentsTable,
  tradesTable,
  signalsTable,
  botConfigTable,
  equityBaselinesTable,
  type BotConfigRow,
} from "@workspace/db";
import { and, eq, gte, inArray } from "drizzle-orm";
import { logger } from "./logger";
import {
  placeBrokerOrder,
  getBrokerPriceHistory,
  getBrokerAccount,
  getBrokerPositions,
  getBrokerQuote,
  getBrokerCandles,
  type NormalizedPosition,
  getBrokerTransactions,
  closeBrokerPosition,
} from "./broker";
import { getUserBrokerCredentials, type UserBrokerCredentials } from "./brokerCredentialsService";
import { summariseTransactions, parseUtc } from "./livePerformance";
import { getPlanLimits } from "./planService";
import { notifyUser } from "./notificationService";
import { computeScalpSignal, scalpRequiredBars } from "./scalpStrategy";
import { minutesUntilSessionEnd, minutesSinceSessionStart, formatSessionEnd } from "./marketHours";
import {
  rollMarks,
  hardLimitBreach,
  trailingLossStreak,
  withinCooldown,
  utcWeekKey,
  type EquityMarks,
} from "./riskGuards";
import {
  acquireLease,
  renewLease,
  holdsLease,
  releaseLease,
  EngineOwnedElsewhereError,
  LEASE_RENEW_MS,
} from "./engineLease";
import {
  routeStrategy,
  requiredBars,
  type StrategyName,
  type StrategyMode,
  type Regime,
} from "./strategyRouter";
import {
  reviewSignal,
  decideTrades,
  type AccountSnapshot,
  type PositionSnapshot,
  type CandidateInstrument,
} from "./aiTrader";

/**
 * How Claude participates in trade execution:
 * - "off":        strategy only (moving-average crossover decides).
 * - "guard":      strategy fires a signal, Claude approves/vetoes before ordering.
 * - "autonomous": Claude itself decides BUY/SELL/HOLD per instrument.
 */
export type AiTradeMode = "off" | "guard" | "autonomous";

/** Confidence floor for acting on an AI decision. */
export type MinAiConfidence = "any" | "medium" | "high";

/** Ranks confidence so a decision can be compared against the configured floor. */
const CONFIDENCE_RANK: Record<string, number> = { low: 1, medium: 2, high: 3 };
const FLOOR_RANK: Record<MinAiConfidence, number> = { any: 1, medium: 2, high: 3 };

/**
 * Whether an AI decision clears the user's conviction floor. Unknown/missing
 * confidence is treated as the weakest ("low"): if the model didn't state a
 * conviction, that is not evidence of a strong one.
 */
export function meetsConfidenceFloor(confidence: string | undefined, floor: MinAiConfidence): boolean {
  return (CONFIDENCE_RANK[String(confidence).toLowerCase()] ?? 1) >= FLOOR_RANK[floor];
}

export interface BotConfig {
  shortPeriod: number;
  longPeriod: number;
  tradeAmount: number;
  intervalMinutes: number;
  dryRun: boolean;
  broker: "trading212" | "capitalcom";
  stopLossPercent: number;
  takeProfitPercent: number;
  riskPerTradePercent: number;
  maxPositionSizePercent: number;
  maxDailyLossPercent: number;
  maxConcurrentPositions: number;
  aiTradeMode: AiTradeMode;
  /**
   * Minimum AI conviction required to act, in guard and autonomous modes.
   * "any" acts on every decision (the original behaviour); "medium"/"high"
   * discard the AI's own low-conviction calls instead of trading them.
   */
  minAiConfidence: MinAiConfidence;
  /** "auto" = regime routing; "scalp" = the fast micro-reversion engine. */
  strategyMode: StrategyMode;
  /** Expected move must exceed the live spread by this multiple before a scalp trades. */
  minEdgeVsSpread: number;
  /** Hard cap on orders per UTC day. 0 = unlimited. */
  maxTradesPerDay: number;
  /** Halt when equity falls this far from its intraday peak. 0 = disabled. */
  maxIntradayDrawdownPercent: number;
  /** Close positions this many minutes before their session ends; 0 = off. */
  closeBeforeSessionEndMinutes: number;
  /** Open nothing new for this many minutes after an instrument's session opens; 0 = off. */
  noOpenAfterSessionStartMinutes: number;
  /** Which trading mode (profile) is applied. Display only; the engine reads the fields above. */
  activeProfileId: number | null;
  /** Ceiling on total exposure to one instrument, percent of account value; 0 = off. */
  maxInstrumentExposurePercent: number;
  /** Ceiling on total exposure across all instruments, percent of account value; 0 = off. */
  maxTotalExposurePercent: number;
  /** Stop opening positions for the day once equity is up this much; 0 = off. */
  dailyProfitTarget: number;
  /** Absolute equity below which the bot must not trade at all; 0 = off. */
  equityFloor: number;
  /** Halt when equity falls this far below the week's opening equity; 0 = off. */
  maxWeeklyLossPercent: number;
  /** Halt after this many losing closes in a row; 0 = off. */
  maxConsecutiveLosses: number;
  /** A losing streak must also have cost this much, as a percent of equity, before it halts; 0 = count alone. */
  minStreakLossPercent: number;
  /** Minimum minutes between opening positions in the same instrument; 0 = off. */
  reentryCooldownMinutes: number;
  /** Refuse a same-side order in an instrument already held. */
  onePositionPerInstrument: boolean;
  /** Ceiling on NET directional exposure (longs minus shorts), percent of account value; 0 = off. */
  maxNetDirectionalPercent: number;
  /**
   * When true, each instrument is classified as trending or ranging (close-based
   * ADX) and routed to trend-following or mean-reversion automatically. When
   * false, only the trend-following MA crossover runs (pre-Phase-2 behaviour).
   */
  regimeFilterEnabled: boolean;
  /** Capital.com candle resolution fetched for signals — the scanner mirrors this. */
  barResolution: "MINUTE" | "MINUTE_5" | "MINUTE_15" | "MINUTE_30" | "HOUR" | "HOUR_4" | "DAY" | "WEEK";
}

const DEFAULT_CONFIG: BotConfig = {
  shortPeriod: 9,
  longPeriod: 21,
  tradeAmount: 50,
  intervalMinutes: 60,
  dryRun: true,
  broker: "capitalcom",
  stopLossPercent: 2,
  takeProfitPercent: 4,
  riskPerTradePercent: 1,
  maxPositionSizePercent: 5,
  maxDailyLossPercent: 3,
  maxConcurrentPositions: 5,
  aiTradeMode: "off",
  minAiConfidence: "any",
  strategyMode: "auto",
  minEdgeVsSpread: 3,
  maxTradesPerDay: 50,
  maxIntradayDrawdownPercent: 2,
  closeBeforeSessionEndMinutes: 0,
  noOpenAfterSessionStartMinutes: 0,
  activeProfileId: null,
  maxInstrumentExposurePercent: 0,
  maxTotalExposurePercent: 0,
  dailyProfitTarget: 0,
  equityFloor: 0,
  maxWeeklyLossPercent: 5,
  maxConsecutiveLosses: 6,
  minStreakLossPercent: 0.5,
  reentryCooldownMinutes: 5,
  onePositionPerInstrument: true,
  maxNetDirectionalPercent: 0,
  regimeFilterEnabled: true,
  barResolution: "MINUTE_5",
};

/**
 * Daily-loss circuit breaker state. When `tripped`, the engine is stopped and
 * refuses to trade until a human explicitly resumes it (no auto-resume).
 * `dayKey` is the UTC calendar day the baseline was captured for; `dayStartEquity`
 * is the account total equity at the start of that day, used as the loss baseline.
 */
interface CircuitBreakerState extends EquityMarks {
  tripped: boolean;
  reason: string | null;
  trippedAt: Date | null;
  dayKey: string | null;
  dayStartEquity: number | null;
  /** ISO week the weekly baseline belongs to, and the equity it opened at. */
  weekKey: string | null;
  weekStartEquity: number | null;
  /** Closes before this instant do not count towards the losing streak. */
  lossStreakResetAt: Date | null;
  /** Highest equity seen so far today — the reference for the intraday drawdown halt. */
  dayPeakEquity: number | null;
  /**
   * The UTC day on which the daily profit target was reached. Once set for
   * today, the lock holds until the day changes — even if equity then dips back
   * under the target. Re-opening on the dip is exactly how a good day gets given
   * back, which is what the lock exists to prevent.
   */
  profitLockedDayKey: string | null;
}

interface BotState {
  running: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  config: BotConfig;
  circuitBreaker: CircuitBreakerState;
  intervalHandle: ReturnType<typeof setInterval> | null;
  /**
   * Set only while a staggered first cycle is pending — used when restoring
   * bots at boot so they don't all hit the broker in the same instant. Must be
   * cleared by stopBot alongside intervalHandle, or a "stopped" bot would still
   * fire one cycle.
   */
  pendingStartHandle: ReturnType<typeof setTimeout> | null;
  /**
   * Claimed synchronously by startBot before it awaits anything, so two
   * concurrent starts cannot both pass the `running` check and each arm their
   * own interval. `running` alone cannot do this job: it is only set after the
   * credential/entitlement awaits, leaving a window in which both callers see
   * false. An orphaned interval is invisible (nothing holds its handle) and
   * would double every cycle — duplicate live orders once dry run is off.
   *
   * Guards this PROCESS against itself. The ownership lease guards it against
   * other processes — a different problem, and neither substitutes for the other.
   */
  starting: boolean;
  /** Keeps the ownership lease alive while this process runs the bot. */
  leaseHandle: ReturnType<typeof setInterval> | null;
  /**
   * When the last cycle STARTED, kept separately from lastRunAt (which records
   * when one finished, for the UI). Used to refuse a cycle that arrives too soon
   * after the previous one — see MIN_CYCLE_GAP_MS.
   */
  lastCycleStartedAt: Date | null;
}

function freshCircuitBreaker(): CircuitBreakerState {
  return {
    tripped: false,
    reason: null,
    trippedAt: null,
    dayKey: null,
    dayStartEquity: null,
    dayPeakEquity: null,
    weekKey: null,
    weekStartEquity: null,
    lossStreakResetAt: null,
    profitLockedDayKey: null,
  };
}

/**
 * Loads the persisted equity baselines into a fresh breaker.
 *
 * Without this every deploy re-opened the day at whatever equity the new
 * process first saw, so an account already down could lose the daily limit
 * again before the day ended. A tripped breaker is NOT restored here: that
 * lives in `bot_config.running`, which stopBot already persists, and a halted
 * bot stays halted because it is not resumed, not because a flag says so.
 */
async function loadEquityMarks(userId: number): Promise<CircuitBreakerState> {
  const breaker = freshCircuitBreaker();
  try {
    const [row] = await db.select().from(equityBaselinesTable).where(eq(equityBaselinesTable.userId, userId));
    if (row) {
      breaker.dayKey = row.dayKey;
      breaker.dayStartEquity = row.dayStartEquity;
      breaker.dayPeakEquity = row.dayPeakEquity;
      breaker.weekKey = row.weekKey;
      breaker.weekStartEquity = row.weekStartEquity;
      breaker.profitLockedDayKey = row.profitLockedDayKey;
      breaker.lossStreakResetAt = row.lossStreakResetAt;
    }
  } catch (err) {
    // Fail open with fresh marks rather than refusing to run. A lost baseline
    // costs one day of measurement; a bot that will not start costs the ability
    // to close open positions.
    logger.error({ err, userId }, "Could not load equity baselines — measuring from this cycle");
  }
  return breaker;
}

/**
 * Writes the baselines back. Never throws: a failed write must not abort a
 * cycle that may be trying to close a position.
 */
async function persistEquityMarks(userId: number, cb: CircuitBreakerState): Promise<void> {
  const marks = {
    dayKey: cb.dayKey,
    dayStartEquity: cb.dayStartEquity,
    dayPeakEquity: cb.dayPeakEquity,
    weekKey: cb.weekKey,
    weekStartEquity: cb.weekStartEquity,
    profitLockedDayKey: cb.profitLockedDayKey,
    lossStreakResetAt: cb.lossStreakResetAt,
  };
  try {
    await db
      .insert(equityBaselinesTable)
      .values({ userId, ...marks, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: equityBaselinesTable.userId,
        set: { ...marks, updatedAt: new Date() },
      });
  } catch (err) {
    logger.error({ err, userId }, "Could not persist equity baselines");
  }
}

/**
 * Trips a breaker, stops the bot and tells the user — the one path every risk
 * halt goes through.
 *
 * Order matters: the flag is set before the bot is stopped, so a cycle already
 * in flight sees a tripped breaker and refuses to trade even if it reaches the
 * order path before stopBot's timers are cleared.
 */
async function haltTrading(userId: number, state: BotState, reason: string, title: string): Promise<void> {
  const cb = state.circuitBreaker;
  cb.tripped = true;
  cb.trippedAt = new Date();
  cb.reason = reason;
  await stopBot(userId);
  // A halted bot the user doesn't know about is the worst silent state this
  // product has. notifyUser never throws, so it cannot break the halt itself;
  // the body is the same wording the user sees in the app, no internal detail.
  await notifyUser(userId, { type: "circuit_breaker", title, body: reason, link: "/settings" });
}

/**
 * How many of the account's most recent closes lost money, in a row.
 *
 * Cached for a minute: at one-minute scalp cycles this would otherwise be an
 * extra broker call every cycle, and a streak cannot change without a close.
 * Returns null when the history can't be read — an unknown streak must not halt
 * a bot, and the equity limits still bound the loss either way.
 */
const lossStreakCache = new Map<number, { at: number; streak: { count: number; loss: number } }>();
const LOSS_STREAK_TTL_MS = 60_000;

async function consecutiveLossStreak(
  userId: number,
  credentials: UserBrokerCredentials
): Promise<{ count: number; loss: number } | null> {
  const cached = lossStreakCache.get(userId);
  if (cached && Date.now() - cached.at < LOSS_STREAK_TTL_MS) return cached.streak;

  try {
    const to = new Date();
    // Three days back: long enough to hold a streak that spans a weekend, short
    // enough that the response stays small.
    const from = new Date(to.getTime() - 3 * 24 * 60 * 60 * 1000);
    const rows = await getBrokerTransactions(userId, credentials, from, to);
    // Trading 212 has no transaction history endpoint, so there is nothing to
    // count and the streak stays unknown rather than falsely zero.
    if (rows === null) return null;
    const resetAt = botStates.get(userId)?.circuitBreaker.lossStreakResetAt ?? null;
    const closes = summariseTransactions(rows)
      .recentTrades.filter((t) => resetAt === null || parseUtc(t.dateUtc) > resetAt)
      // summariseTransactions returns newest first; the streak counts backwards
      // from the most recent, so oldest-first is what trailingLossStreak wants.
      .slice()
      .reverse();
    const streak = trailingLossStreak(closes);
    lossStreakCache.set(userId, { at: Date.now(), streak });
    return streak;
  } catch (err) {
    logger.warn({ err, userId }, "Could not read trade history for the losing-streak breaker");
    return null;
  }
}

/** Per-user in-memory bot state — one isolated bot per customer, no cross-tenant sharing. */
const botStates = new Map<number, BotState>();

function rowToConfig(row: BotConfigRow): BotConfig {
  return {
    shortPeriod: row.shortPeriod,
    longPeriod: row.longPeriod,
    tradeAmount: row.tradeAmount,
    intervalMinutes: row.intervalMinutes,
    dryRun: row.dryRun,
    broker: row.broker,
    stopLossPercent: row.stopLossPercent,
    takeProfitPercent: row.takeProfitPercent,
    riskPerTradePercent: row.riskPerTradePercent,
    maxPositionSizePercent: row.maxPositionSizePercent,
    maxDailyLossPercent: row.maxDailyLossPercent,
    maxConcurrentPositions: row.maxConcurrentPositions,
    aiTradeMode: row.aiTradeMode,
    minAiConfidence: row.minAiConfidence,
    strategyMode: row.strategyMode,
    minEdgeVsSpread: row.minEdgeVsSpread,
    maxTradesPerDay: row.maxTradesPerDay,
    maxIntradayDrawdownPercent: row.maxIntradayDrawdownPercent,
    closeBeforeSessionEndMinutes: row.closeBeforeSessionEndMinutes,
    noOpenAfterSessionStartMinutes: row.noOpenAfterSessionStartMinutes,
    activeProfileId: row.activeProfileId,
    maxInstrumentExposurePercent: row.maxInstrumentExposurePercent,
    maxTotalExposurePercent: row.maxTotalExposurePercent,
    dailyProfitTarget: row.dailyProfitTarget,
    equityFloor: row.equityFloor,
    maxWeeklyLossPercent: row.maxWeeklyLossPercent,
    maxConsecutiveLosses: row.maxConsecutiveLosses,
    minStreakLossPercent: row.minStreakLossPercent,
    reentryCooldownMinutes: row.reentryCooldownMinutes,
    onePositionPerInstrument: row.onePositionPerInstrument,
    maxNetDirectionalPercent: row.maxNetDirectionalPercent,
    regimeFilterEnabled: row.regimeFilterEnabled,
    barResolution: row.barResolution,
  };
}

async function persistConfig(userId: number, config: BotConfig): Promise<void> {
  await db
    .insert(botConfigTable)
    .values({ userId, ...config })
    .onConflictDoUpdate({ target: botConfigTable.userId, set: { ...config, updatedAt: new Date() } });
}

/**
 * Records whether the user wants the bot running, so a restart can restore it.
 * Deliberately separate from persistConfig: `running` is state, not settings,
 * and writing it through the config path would let a plain settings save
 * silently start or stop a bot.
 *
 * getOrCreateBotState guarantees a row exists before either start or stop can
 * be reached, so a plain UPDATE is enough.
 */
async function persistRunning(userId: number, running: boolean): Promise<void> {
  await db
    .update(botConfigTable)
    .set({ running, updatedAt: new Date() })
    .where(eq(botConfigTable.userId, userId));
}

/**
 * Returns (creating if needed) a user's in-memory bot state. On first access
 * this cycle, loads persisted config from `bot_config` so settings survive a
 * server restart — falls back to defaults (and persists them) if the user has
 * never configured anything yet.
 */
async function getOrCreateBotState(userId: number): Promise<BotState> {
  const existing = botStates.get(userId);
  if (existing) return existing;

  // Both reads together: the baselines must be in place before the first cycle
  // can measure a loss against them, and loading them afterwards would leave a
  // window in which a restarted bot measured the day from its restart — the
  // exact hole persisting them closes.
  const [[row], breaker] = await Promise.all([
    db.select().from(botConfigTable).where(eq(botConfigTable.userId, userId)),
    loadEquityMarks(userId),
  ]);

  // Another caller may have created the state while this one awaited the read.
  // Returning theirs keeps ONE state object per user: two would mean the timers
  // armed against the discarded copy could never be found again to stop them.
  const raced = botStates.get(userId);
  if (raced) return raced;

  const config = row ? rowToConfig(row) : { ...DEFAULT_CONFIG };

  // Deliberately starts as NOT running even when the row says running: true.
  // Only resumeRunningBots() may flip it, because that is the one path that also
  // arms the timers. Trusting the column here would make the UI claim RUNNING
  // while nothing was scheduled — the exact lie this column exists to prevent.
  const state: BotState = {
    running: false,
    lastRunAt: null,
    nextRunAt: null,
    config,
    circuitBreaker: breaker,
    intervalHandle: null,
    pendingStartHandle: null,
    starting: false,
    leaseHandle: null,
    lastCycleStartedAt: null,
  };
  // Published to the map BEFORE the persistConfig await below, so the `raced`
  // check above is the only window a concurrent caller can be in. Awaiting
  // first would let two callers each build a state and the second overwrite the
  // first — leaving the loser's caller holding a state the map no longer knows
  // about, whose timers nothing could ever stop.
  botStates.set(userId, state);

  if (!row) await persistConfig(userId, config);
  return state;
}

/** "£40.00" for GBP, otherwise "40.00 EUR" — for messages the user reads. */
function formatMoney(amount: number, currency: string | null): string {
  const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : currency === "EUR" ? "€" : null;
  return symbol ? `${symbol}${amount.toFixed(2)}` : `${amount.toFixed(2)}${currency ? ` ${currency}` : ""}`;
}

/**
 * "net long £750" / "net short £750" / "flat" — for the one message where the
 * sign is the whole point.
 */
function directionWords(net: number, currency: string | null): string {
  if (net === 0) return "flat";
  return `net ${net > 0 ? "long" : "short"} ${formatMoney(Math.abs(net), currency)}`;
}

/** UTC calendar-day key (YYYY-MM-DD) used to reset the daily-loss baseline. */
function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Combined entry-side quote check: whether a NEW position should be blocked
 * because the market is known to be closed, and the broker's minimum
 * tradeable size for this instrument (if known). One quote fetch serves both,
 * since they're both read off the same underlying broker quote.
 *
 * `marketClosed` only ever gates opening exposure — callers must never use it
 * to block a SELL that closes/reduces an existing position. `minDealSize` is
 * relevant to every NEW order (including adding to an existing position, not
 * just opening a brand-new one), so callers should check it unconditionally
 * rather than gating it the same way as `marketClosed`.
 *
 * Fails open on a quote-fetch error (`{ marketClosed: false, minDealSize:
 * null }`, i.e. "allow the trade" / "no minimum known") — this is a safety
 * filter layered on top of the existing risk gates, not itself a risk
 * control, so a transient lookup failure should not block trading entirely.
 */
async function checkEntryQuote(
  userId: number,
  credentials: UserBrokerCredentials,
  ticker: string
): Promise<{
  marketClosed: boolean;
  unorderable: boolean;
  minDealSize: number | null;
  /** The broker's minimum stop/take-profit distance, percent; null when unknown. */
  minStopDistancePercent: number | null;
  spreadPct: number | null;
  /** Minutes until this market's session ends for a real break; null if none/unknown. */
  minutesToSessionEnd: number | null;
  /** Minutes since this market's session opened after a real break; null if none/unknown. */
  minutesSinceSessionOpen: number | null;
}> {
  try {
    const quote = await getBrokerQuote(userId, credentials, ticker);
    // Round-trip cost as a fraction of price. Taken from the SAME quote as the
    // other two checks rather than a second call — at one-minute cycles an
    // extra request per instrument per cycle is real rate-limit pressure.
    const rawSpread = quote.price > 0 ? (quote.offer - quote.bid) / quote.price : NaN;
    return {
      marketClosed: quote.marketStatus !== null && quote.marketStatus !== "TRADEABLE",
      // Stricter than marketClosed: not "no new positions" but "no orders at
      // all". Blocks closes too — the broker will reject them anyway, and
      // sending one every cycle until the open is how a single losing position
      // produced 32 rejected sells overnight on 17-18 Sep.
      unorderable: quote.marketStatus !== null && UNORDERABLE_STATUSES.has(quote.marketStatus),
      minDealSize: quote.minDealSize,
      minStopDistancePercent: quote.minStopDistancePercent,
      spreadPct: Number.isFinite(rawSpread) && rawSpread >= 0 ? rawSpread : null,
      minutesToSessionEnd: minutesUntilSessionEnd(quote.openingHours),
      minutesSinceSessionOpen: minutesSinceSessionStart(quote.openingHours),
    };
  } catch (err) {
    logger.warn({ userId, ticker, err }, "Could not check market status/min size — allowing trade (fail-open)");
    // null spread means "unknown". The scalp cost gate treats unknown as a
    // BLOCK, unlike the other two fields' fail-open: trading blind on cost is
    // precisely the mistake the fast engine exists to avoid.
    // unorderable false: one order that the broker may reject is better than
    // stranding a close because a quote lookup blipped.
    return {
      marketClosed: false,
      unorderable: false,
      minDealSize: null,
      minStopDistancePercent: null,
      spreadPct: null,
      minutesToSessionEnd: null,
      minutesSinceSessionOpen: null,
    };
  }
}

/**
 * True when an OPEN position's instrument market is confirmed closed and the
 * position should be force-flattened this cycle. Deliberately the OPPOSITE
 * fail direction from checkEntryQuote: on a quote-fetch error this returns
 * false ("leave it open, retry next cycle") rather than true, because forcing
 * a close based on incomplete information is a worse mistake than delaying a
 * confirmed one by one cycle — an unforced exit at a bad moment is
 * irreversible within the cycle, unlike a skipped entry which just waits for
 * the next signal. Same underlying quote check as checkEntryQuote's
 * marketClosed field, but kept as a separate named function (not a shared
 * parameterized helper) since the two gates' intent genuinely differs even
 * though today's return values happen to coincide. (checkEntryQuote itself
 * used to be named isMarketClosedForEntry — renamed when it grew a second
 * field, minDealSize, that this flatten-side function has no equivalent of.)
 */
/**
 * Broker states in which NO order is accepted, so attempting to flatten is
 * guaranteed to be rejected. Treating "not TRADEABLE" as "flatten now" made
 * this function self-defeating: it fired precisely when the close could not
 * be placed. Observed live on 25 Aug 2026 — an AMZN position produced seven
 * consecutive rejected orders, one per hourly cycle from 01:15 to 07:15, each
 * answered by Capital.com with "Rejected. AMZN is currently closed."
 *
 * Restricted-but-orderable states (EDITS_ONLY, EDIT, AUCTION) are where
 * flatten-by-close genuinely works: new positions are barred while existing
 * ones can still be closed, which is exactly the situation it was written for.
 */
const UNORDERABLE_STATUSES = new Set(["CLOSED", "OFFLINE", "SUSPENDED", "AUCTION_NO_EDIT"]);

async function isMarketClosedForFlatten(
  userId: number,
  credentials: UserBrokerCredentials,
  ticker: string
): Promise<boolean> {
  try {
    const quote = await getBrokerQuote(userId, credentials, ticker);
    const status = quote.marketStatus;
    if (status === null || status === "TRADEABLE") return false;

    if (UNORDERABLE_STATUSES.has(status)) {
      // Nothing can be done this cycle: the position stays open (protected by
      // its broker-side stop) and we do NOT burn an order the broker will
      // certainly reject. Logged at debug because it recurs every cycle for as
      // long as the market is shut, which is most of the night.
      logger.debug(
        { userId, ticker, marketStatus: status },
        "Flatten-by-close skipped — market is closed, no order can be placed"
      );
      return false;
    }

    return true;
  } catch (err) {
    logger.warn({ userId, ticker, err }, "Could not check market status for flatten-by-close — leaving position open (fail-closed)");
    return false;
  }
}


/**
 * The fast engine's central risk control: refuse any trade whose expected move
 * cannot clear the round-trip spread by the configured multiple.
 *
 * Only applies in scalp mode. The slower strategies hold long enough that the
 * spread is a small fraction of the move, and they carry no move estimate to
 * test anyway; imposing this on them would silently block trades on a number
 * they never computed.
 *
 * A null spread (quote lookup failed) BLOCKS. Everywhere else in this file an
 * unknown fails open, because a skipped entry is cheap. Here it fails closed:
 * trading blind on cost is the specific mistake the fast engine exists to
 * avoid, and at one-minute frequency the next chance is sixty seconds away.
 */
export function clearsCostHurdle(
  cfg: Pick<BotConfig, "strategyMode" | "minEdgeVsSpread">,
  expectedMovePct: number | null,
  spreadPct: number | null,
): boolean {
  if (cfg.strategyMode !== "scalp") return true;
  if (cfg.minEdgeVsSpread <= 0) return true;
  if (spreadPct === null || expectedMovePct === null) return false;
  return expectedMovePct >= cfg.minEdgeVsSpread * spreadPct;
}

/** User-facing explanation for a blocked scalp, recorded against the signal. */
export function costHurdleReason(
  cfg: Pick<BotConfig, "minEdgeVsSpread">,
  expectedMovePct: number | null,
  spreadPct: number | null,
): string {
  if (spreadPct === null || expectedMovePct === null) {
    return "Trade skipped: the live spread could not be read, so the trade could not be shown to be worth its cost.";
  }
  const need = cfg.minEdgeVsSpread * spreadPct;
  return (
    `Trade skipped: expected move ${(expectedMovePct * 100).toFixed(3)}% does not clear ` +
    `${cfg.minEdgeVsSpread}x the ${(spreadPct * 100).toFixed(3)}% spread (needs ${(need * 100).toFixed(3)}%).`
  );
}

export class BrokerNotConnectedError extends Error {}

/** Thrown when scalp mode is started with more instruments than its rate budget allows. */
export class ScalpInstrumentLimitError extends Error {}

// Defined in engineLease.ts (it is a lease concept, shared with the scanner),
// re-exported here so existing importers of botEngine keep working.
export { EngineOwnedElsewhereError } from "./engineLease";

/** Rate-limit budget: ~3 broker calls per instrument per cycle against ~10 req/s. */
export const SCALP_MAX_INSTRUMENTS = 20;

export async function getBotStatus(userId: number) {
  const state = await getOrCreateBotState(userId);
  return {
    running: state.running,
    lastRunAt: state.lastRunAt?.toISOString() ?? null,
    nextRunAt: state.nextRunAt?.toISOString() ?? null,
    config: state.config,
    circuitBreaker: {
      tripped: state.circuitBreaker.tripped,
      reason: state.circuitBreaker.reason,
      trippedAt: state.circuitBreaker.trippedAt?.toISOString() ?? null,
      dayStartEquity: state.circuitBreaker.dayStartEquity,
    },
  };
}

/**
 * Pure lookup of whether a user's bot is running — unlike getBotStatus, never
 * creates in-memory state for a user who has never started a bot. Safe to call
 * for every row of an admin customer list without side effects.
 */
export function peekBotRunning(userId: number): boolean {
  return botStates.get(userId)?.running ?? false;
}

/**
 * Clears a tripped circuit breaker and restarts the bot. This is the ONLY way
 * to resume after a halt — the engine never auto-resumes.
 *
 * What a resume does and does not reset is the whole design:
 * - The DAY re-bases, so the daily limits measure from the resume point. That
 *   is what makes resuming useful at all.
 * - The WEEK does NOT. Re-basing it would let a resume grant another full
 *   weekly allowance, and a limit that any click can clear bounds nothing.
 * - The losing streak resets, because the closes that caused the halt are still
 *   in the broker's history and would trip it again on the next cycle.
 * - The equity floor cannot be reset by anything here: it is an absolute number
 *   and an account below it halts again next cycle, by design. Lower the floor
 *   or add funds.
 */
export async function resumeBot(userId: number) {
  const state = await getOrCreateBotState(userId);
  const cb = state.circuitBreaker;
  cb.tripped = false;
  cb.reason = null;
  cb.trippedAt = null;
  cb.dayKey = null;
  cb.dayStartEquity = null;
  cb.dayPeakEquity = null;
  cb.profitLockedDayKey = null;
  cb.lossStreakResetAt = new Date();
  lossStreakCache.delete(userId);
  await persistEquityMarks(userId, cb);
  logger.info({ userId, weekStartEquity: cb.weekStartEquity }, "Circuit breaker cleared — resuming bot");
  return startBot(userId);
}

export async function updateConfig(userId: number, patch: Partial<BotConfig>) {
  const state = await getOrCreateBotState(userId);
  Object.assign(state.config, patch);
  await persistConfig(userId, state.config);

  if (state.running) {
    // Restart on the EXISTING cadence, not from zero.
    //
    // startBot's default is an immediate first cycle, which is right for a
    // start and wrong for a restart: on 24 Sep 2026 switching trading mode at
    // 11:09:10 fired a cycle 10 seconds after the 11:09:00 one, and GOLD and
    // US500 were each bought a second time. Holding the first cycle back by
    // whatever is left of the interval keeps a settings save from being a
    // trading decision.
    const intervalMs = state.config.intervalMinutes * 60 * 1000;
    const sinceLast = state.lastCycleStartedAt ? Date.now() - state.lastCycleStartedAt.getTime() : null;
    const delay = sinceLast === null ? 0 : Math.max(0, intervalMs - sinceLast);
    await stopBot(userId);
    await startBot(userId, { firstCycleDelayMs: delay });
  }

  return getBotStatus(userId);
}

/**
 * Arms the cycle timers. `delayMs > 0` holds the first cycle back — used when
 * restoring many bots at boot — and only starts the repeating interval once that
 * first cycle has run, so a restored bot never fires two cycles close together.
 */
/**
 * Keep renewing the ownership lease for as long as we run this bot, and stop the
 * bot the moment we lose it.
 *
 * Losing a lease means another process has taken over — continuing would put two
 * engines on one account, the exact failure this whole mechanism exists to
 * prevent. Stopping locally is therefore the safe response, not an error case.
 */
function armLeaseRenewal(userId: number, state: BotState): void {
  if (state.leaseHandle) clearInterval(state.leaseHandle);
  state.leaseHandle = setInterval(() => {
    void (async () => {
      if (!state.running) return;
      const stillOurs = await renewLease(userId, "bot");
      if (!stillOurs) {
        logger.error({ userId }, "Lost the bot's ownership lease — another process has taken over; stopping here");
        await stopBot(userId, { keepRunningFlag: true });
      }
    })();
  }, LEASE_RENEW_MS);
}

function armCycleTimers(userId: number, state: BotState, delayMs: number): void {
  const ms = state.config.intervalMinutes * 60 * 1000;

  // Defence in depth behind startBot's `starting` claim: arming always replaces
  // whatever was armed before, so no path can accumulate two timers on one bot.
  if (state.intervalHandle) {
    clearInterval(state.intervalHandle);
    state.intervalHandle = null;
  }
  if (state.pendingStartHandle) {
    clearTimeout(state.pendingStartHandle);
    state.pendingStartHandle = null;
  }

  if (delayMs <= 0) {
    void runCycle(userId, { scheduled: true });
    state.intervalHandle = setInterval(() => void runCycle(userId, { scheduled: true }), ms);
    state.nextRunAt = new Date(Date.now() + ms);
    return;
  }

  state.nextRunAt = new Date(Date.now() + delayMs);
  state.pendingStartHandle = setTimeout(() => {
    state.pendingStartHandle = null;
    // Stopped (or suspended) while we were waiting — do not trade.
    if (!state.running) return;
    void runCycle(userId, { scheduled: true });
    state.intervalHandle = setInterval(() => void runCycle(userId, { scheduled: true }), ms);
    state.nextRunAt = new Date(Date.now() + ms);
  }, delayMs);
}

export async function startBot(userId: number, opts: { firstCycleDelayMs?: number } = {}) {
  const state = await getOrCreateBotState(userId);
  // Check and claim with NO await between them — that is what makes this
  // atomic on a single-threaded event loop. Two Start clicks a second apart
  // would otherwise both get past `running` (only set after the awaits below)
  // and each arm an interval, of which stopBot can only ever clear one.
  if (state.running || state.starting) return getBotStatus(userId);
  state.starting = true;

  try {
    const credentials = await getUserBrokerCredentials(userId);
    if (!credentials) {
      throw new BrokerNotConnectedError("Connect a broker account before starting the bot");
    }

    // Claim ownership before arming anything. If another live process holds the
    // lease, that process is already running this bot — starting here would
    // double every cycle, which during a deploy means two real orders per
    // signal. Refusing is correct and invisible to the user: their bot IS
    // running, just not in this process.
    if (!(await acquireLease(userId, "bot"))) {
      logger.warn({ userId }, "Bot not started — another process holds the lease for it");
      throw new EngineOwnedElsewhereError(
        "This bot is already running in another process. It will move here automatically within 90 seconds if that process has stopped."
      );
    }

  // Scalp mode runs on short intervals and spends ~3 broker calls per
  // instrument per cycle. Capital.com allows roughly 10 requests/second, so a
  // large watchlist at one-minute cycles would be rate-limited into failure
  // rather than trading fast. Refuse clearly instead of degrading mysteriously.
    if (state.config.strategyMode === "scalp") {
      const enabled = await db
        .select({ id: instrumentsTable.id })
        .from(instrumentsTable)
        .where(and(eq(instrumentsTable.userId, userId), eq(instrumentsTable.enabled, true)));
      if (enabled.length > SCALP_MAX_INSTRUMENTS) {
        throw new ScalpInstrumentLimitError(
          `Fast mode supports up to ${SCALP_MAX_INSTRUMENTS} instruments; you have ${enabled.length} enabled. ` +
            `At one-minute cycles more than that exceeds your broker's rate limit.`,
        );
      }
    }

    state.running = true;
    await persistRunning(userId, true);
    armLeaseRenewal(userId, state);
    armCycleTimers(userId, state, opts.firstCycleDelayMs ?? 0);

    logger.info({ userId, config: state.config }, "Bot started");
    return getBotStatus(userId);
  } finally {
    // Released on the error paths too (no broker, too many scalp instruments),
    // so a rejected start never leaves the bot permanently unstartable.
    state.starting = false;
  }
}

/**
 * Stops the bot and records that intent, so a restart doesn't bring it back.
 * Awaiting matters: if the process dies between the in-memory stop and the
 * write, the next boot would resurrect a bot the user (or the circuit breaker)
 * had stopped — worse than failing to resume one.
 */
export async function stopBot(
  userId: number,
  /**
   * `keepRunningFlag` stops this process's timers WITHOUT recording that the
   * user wants the bot stopped. Used when we lose the ownership lease: the bot
   * is still meant to be running — another process is running it — so clearing
   * the column would stop it everywhere and leave the UI lying about intent.
   */
  opts: { keepRunningFlag?: boolean } = {}
): Promise<void> {
  const state = botStates.get(userId);
  if (!state) {
    // No in-memory state, but the column may still say running — e.g. an admin
    // suspending a user whose bot lives on a previous process. Clear it anyway.
    await persistRunning(userId, false).catch((err: unknown) =>
      logger.error({ err, userId }, "Failed to persist stopped state"),
    );
    return;
  }
  if (state.intervalHandle) {
    clearInterval(state.intervalHandle);
    state.intervalHandle = null;
  }
  if (state.pendingStartHandle) {
    clearTimeout(state.pendingStartHandle);
    state.pendingStartHandle = null;
  }
  if (state.leaseHandle) {
    clearInterval(state.leaseHandle);
    state.leaseHandle = null;
  }
  state.running = false;
  state.nextRunAt = null;
  // A stopped bot's last cycle must not throttle its next start: the gap guard
  // exists to stop a RUNNING bot cycling twice, and a stop-then-start is a
  // deliberate act. updateConfig, the one path that restarts a running bot,
  // computes its own delay before calling this — that is what preserves the
  // cadence there.
  state.lastCycleStartedAt = null;

  if (opts.keepRunningFlag) {
    // We lost the lease rather than being told to stop. The new owner holds it;
    // releasing here would delete THEIR row, so do nothing but stand down.
    logger.info({ userId }, "Bot stood down locally — ownership moved to another process");
    return;
  }

  // Release before persisting: a successor that picks this up immediately should
  // find the lease free. Scoped to our own owner id, so this can never revoke
  // someone else's claim.
  await releaseLease(userId, "bot");
  await persistRunning(userId, false).catch((err: unknown) =>
    logger.error({ err, userId }, "Failed to persist stopped state"),
  );
  logger.info({ userId }, "Bot stopped");
}

export async function stopBotAndGetStatus(userId: number) {
  await stopBot(userId);
  return getBotStatus(userId);
}

/** Spacing between restored bots' first cycles, to avoid a burst of broker calls at boot. */
const RESUME_STAGGER_MS = 20_000;

/**
 * Re-arms every bot that was running before this process started.
 *
 * Bot state is in-memory (see the botStates map), so without this every deploy
 * or restart silently stopped every customer's bot — and the UI would show
 * STOPPED only if the user happened to look. Called once from the server entry
 * point, never from app.ts, so importing the app in tests doesn't start trading.
 *
 * Restoration goes through startBot, which means the plan check in runCycle still
 * applies: a user whose plan no longer allows live trading resumes in dry-run
 * rather than placing real orders.
 */
export async function resumeRunningBots(): Promise<{ resumed: number; skipped: number }> {
  let resumed = 0;
  let skipped = 0;

  let rows: BotConfigRow[];
  try {
    rows = await db.select().from(botConfigTable).where(eq(botConfigTable.running, true));
  } catch (err) {
    // Never take the server down over this — the app must still serve requests
    // (and let users press Start themselves) if the lookup fails.
    logger.error({ err }, "Could not read bots to resume — all bots remain stopped");
    return { resumed: 0, skipped: 0 };
  }

  if (rows.length === 0) {
    logger.info("No bots to resume");
    return { resumed: 0, skipped: 0 };
  }

  for (const [index, row] of rows.entries()) {
    try {
      await startBot(row.userId, { firstCycleDelayMs: (index + 1) * RESUME_STAGGER_MS });
      resumed += 1;
    } catch (err) {
      skipped += 1;
      if (err instanceof EngineOwnedElsewhereError) {
        // The outgoing instance still owns this bot — the normal case for the
        // few seconds a zero-downtime deploy runs both. It is still running, so
        // the `running` flag stays exactly as it is. Once the old process exits
        // it releases the lease (or the lease expires) and the next resume pass
        // picks the bot up here.
        logger.info({ userId: row.userId }, "Bot owned by another process — not resuming here");
        continue;
      }
      // Most likely BrokerNotConnectedError: the user disconnected their broker
      // while this process was down. Clear the flag so the UI honestly shows
      // STOPPED rather than claiming a bot that cannot run.
      logger.error({ err, userId: row.userId }, "Could not resume bot — leaving it stopped");
      await persistRunning(row.userId, false).catch((persistErr: unknown) =>
        logger.error({ err: persistErr, userId: row.userId }, "Failed to clear running flag"),
      );
    }
  }

  logger.info({ resumed, skipped }, "Finished resuming bots after restart");
  return { resumed, skipped };
}

/** How often an instance re-checks for running bots nobody is currently running. */
/**
 * 15s rather than 60s: the sweep is how the incoming instance takes over once
 * the outgoing one releases, so this interval IS most of the deploy handover
 * gap. The query is one indexed read of bot_config every 15 seconds.
 */
export const ADOPTION_SWEEP_MS = 15_000;

let adoptionHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Periodically adopt bots that are meant to be running but that this process is
 * not running.
 *
 * Without this, a deploy would strand them. The incoming instance boots while
 * the outgoing one still holds the leases, declines to resume (correctly — the
 * bots are running over there), and then the old process exits. Nothing would
 * ever try again, so every bot would sit stopped until someone noticed and
 * pressed Start.
 *
 * The sweep closes that gap from the other side: whoever is alive keeps asking,
 * and the first to find a free lease takes over. It is also the recovery path
 * for an instance that crashed without releasing — its leases lapse and are
 * picked up within a sweep of expiry.
 *
 * Safe to run on every instance: acquisition is atomic, so a bot already owned
 * is simply skipped. Adoption starts a cycle immediately (no stagger) — this is
 * a handover, and the gap is already as long as it has been.
 */
export function startAdoptionSweep(): void {
  if (adoptionHandle) return;
  adoptionHandle = setInterval(() => {
    void (async () => {
      let rows: BotConfigRow[];
      try {
        rows = await db.select().from(botConfigTable).where(eq(botConfigTable.running, true));
      } catch (err) {
        logger.warn({ err }, "Adoption sweep could not read running bots");
        return;
      }
      for (const row of rows) {
        if (botStates.get(row.userId)?.running) continue; // already ours
        try {
          await startBot(row.userId);
          logger.info({ userId: row.userId }, "Adopted a bot whose previous owner released it");
        } catch (err) {
          // Still owned elsewhere, or the broker is gone. Both are expected and
          // quiet — the next sweep tries again.
          if (!(err instanceof EngineOwnedElsewhereError)) {
            logger.debug({ userId: row.userId, err }, "Adoption sweep could not start a bot");
          }
        }
      }

      // Scanners need adopting for the same reason and on the same cadence.
      // Imported lazily: scannerEngine imports botEngine for getBotStatus, and a
      // static import here would close that cycle at module load.
      try {
        const { adoptOwnerlessScanners } = await import("./scannerEngine");
        await adoptOwnerlessScanners();
      } catch (err) {
        logger.warn({ err }, "Adoption sweep could not adopt scanners");
      }
    })();
  }, ADOPTION_SWEEP_MS);
  // Never hold the process open for this.
  adoptionHandle.unref?.();
}

/**
 * Stop every bot this process runs, for shutdown. Timers stop, so no NEW cycle
 * begins; `running` in the database is left alone, because the user still
 * wants these bots running — the next instance is about to run them.
 *
 * It does not release the leases. The caller must first wait for
 * cyclesInFlight() to reach zero: a cycle that began before shutdown may be
 * mid-order, and releasing its lease then would let the incoming instance
 * start trading the same account before the outgoing one has finished.
 */
export async function standDownAllBots(): Promise<number> {
  const running = [...botStates.entries()].filter(([, st]) => st.running).map(([userId]) => userId);
  for (const userId of running) {
    await stopBot(userId, { keepRunningFlag: true });
  }
  return running.length;
}

export function stopAdoptionSweep(): void {
  if (adoptionHandle) {
    clearInterval(adoptionHandle);
    adoptionHandle = null;
  }
}

/**
 * Cycles currently executing in this process. Shutdown waits for this to reach
 * zero before giving up the ownership lease — see standDownAllBots.
 */
let cyclesInFlightCount = 0;

export function cyclesInFlight(): number {
  return cyclesInFlightCount;
}

/**
 * Closest two cycles may legitimately run. Anything closer is a duplicate: a
 * re-armed timer, a manual cycle landing on a scheduled one, or a start racing
 * a restore.
 */
const MIN_CYCLE_GAP_MS = 60_000;

/**
 * `scheduled` marks a cycle the ENGINE started — a timer, a restart, a resume.
 * Those must respect the cadence, because a duplicate among them is always a
 * bug. A cycle a person asked for is not throttled: they can see what they
 * clicked, and refusing it silently would look broken.
 */
export async function runCycle(
  userId: number,
  opts: { scheduled?: boolean } = {}
): Promise<Array<{ ticker: string; signal: string; tradeExecuted: boolean }>> {
  cyclesInFlightCount += 1;
  try {
    return await runCycleUnlocked(userId, opts.scheduled === true);
  } finally {
    cyclesInFlightCount -= 1;
  }
}

async function runCycleUnlocked(
  userId: number,
  scheduled: boolean
): Promise<Array<{ ticker: string; signal: string; tradeExecuted: boolean }>> {
  const results: Array<{ ticker: string; signal: string; tradeExecuted: boolean }> = [];

  const credentials = await getUserBrokerCredentials(userId);
  if (!credentials) {
    logger.warn({ userId }, "No broker connected — skipping trading cycle");
    return results;
  }

  const state = await getOrCreateBotState(userId);

  // Defence in depth behind updateConfig's cadence-preserving restart: whatever
  // arms a cycle, a running bot never trades twice in quick succession. The gap
  // is half the interval, capped at a minute, so it can never swallow a
  // legitimate cycle — only one that arrived far too early.
  const gapMs = Math.min(MIN_CYCLE_GAP_MS, (state.config.intervalMinutes * 60 * 1000) / 2);
  if (scheduled && state.running && state.lastCycleStartedAt && Date.now() - state.lastCycleStartedAt.getTime() < gapMs) {
    logger.warn(
      { userId, sinceLastMs: Date.now() - state.lastCycleStartedAt.getTime(), gapMs },
      "Cycle skipped — another cycle ran moments ago"
    );
    return results;
  }
  state.lastCycleStartedAt = new Date();
  state.lastRunAt = new Date();
  if (state.running) {
    const ms = state.config.intervalMinutes * 60 * 1000;
    state.nextRunAt = new Date(Date.now() + ms);
  }

  const instruments = await db
    .select()
    .from(instrumentsTable)
    .where(and(eq(instrumentsTable.userId, userId), eq(instrumentsTable.enabled, true)));

  const cfg = state.config;
  const { shortPeriod, longPeriod } = cfg;

  // Subscription entitlements, re-read every cycle (never cached) so an
  // upgrade takes effect on the next cycle — and, more importantly, so a
  // lapsed or downgraded plan stops placing real orders on the next cycle
  // even if the bot is already running.
  const limits = await getPlanLimits(userId);

  // Safety gate: real orders are only ever placed while the bot is actually
  // running (scheduled). A manual trigger (e.g. POST /signals/run) while the
  // bot is Stopped is forced to simulate, so it can never move real money.
  //
  // The plan check is the SECURITY boundary for the paywall: `cfg.dryRun` is a
  // user-editable setting, so a free user could simply switch it off. The
  // route that writes it rejects that too, but this is the gate that actually
  // guarantees no real order is ever placed without a live-trading plan.
  // Ownership check, immediately before anything can be ordered.
  //
  // In-memory `running` is not enough: a process that has lost its lease still
  // believes it is running until its next renewal, up to LEASE_RENEW_MS later.
  // That window is exactly a deploy handover, so it is the window that would
  // produce duplicate orders. Verified against the database's clock every cycle.
  //
  // Skipped entirely for a manual, not-running cycle: those are already forced
  // to dry run below and place nothing, so they need no ownership.
  const ownsEngine = state.running ? await holdsLease(userId, "bot") : false;
  if (state.running && !ownsEngine) {
    logger.error({ userId }, "Cycle aborted — this process no longer owns the bot");
    await stopBot(userId, { keepRunningFlag: true });
    return results;
  }

  const dryRun = cfg.dryRun || !state.running || !limits.liveTrading;
  if (cfg.dryRun === false && !state.running) {
    logger.warn({ userId }, "Bot is stopped — forcing dry-run for this manual cycle (no real orders)");
  }
  if (cfg.dryRun === false && state.running && !limits.liveTrading) {
    logger.warn({ userId }, "Plan does not include live trading — forcing dry-run (no real orders)");
  }

  // AI guard/autonomous modes are a paid entitlement; fall back to the plain
  // strategy path when the plan doesn't include them.
  const aiTradeMode: AiTradeMode = limits.aiTradeModes ? cfg.aiTradeMode : "off";
  if (cfg.aiTradeMode !== "off" && !limits.aiTradeModes) {
    logger.warn({ userId, requested: cfg.aiTradeMode }, "Plan does not include AI trade modes — falling back to strategy-only");
  }

  // Fetch account once per cycle — used for position sizing and (in AI modes) context.
  let account: AccountSnapshot | null = null;
  try {
    const a = await getBrokerAccount(userId, credentials);
    account = { cash: a.cash, total: a.total, currency: a.currency };
  } catch (err) {
    logger.warn({ userId, broker: credentials.broker, err }, "Could not fetch account balance — falling back to fixed tradeAmount");
  }
  const accountBalance = account?.total ?? null;

  // Daily-loss circuit breaker. Runs before any trading logic so a tripped
  // breaker halts the cycle entirely. Baseline is the first equity observed each
  // UTC day; once the loss from that baseline hits maxDailyLossPercent the bot is
  // stopped and will not trade again until manually resumed (no auto-resume).
  if (state.circuitBreaker.tripped) {
    logger.warn({ userId, reason: state.circuitBreaker.reason }, "Circuit breaker tripped — skipping trading cycle");
    return results;
  }
  if (state.running && account !== null && account.total !== null) {
    const cb = state.circuitBreaker;
    const equity = account.total;
    const now = new Date();
    const beforeRoll = { dayKey: cb.dayKey, weekKey: cb.weekKey, peak: cb.dayPeakEquity };

    // Roll the baselines first: a new high this cycle must raise the bar before
    // the drawdown check measures against it, and a new day or week must open
    // its baseline before anything is measured against the old one.
    Object.assign(cb, rollMarks(cb, equity, now));
    if (beforeRoll.dayKey !== cb.dayKey || beforeRoll.weekKey !== cb.weekKey || beforeRoll.peak !== cb.dayPeakEquity) {
      // Not awaited: this is bookkeeping, and a slow write must not delay an
      // order. persistEquityMarks never throws.
      void persistEquityMarks(userId, cb);
    }

    // The limits that are not day-scoped come first. An account under its floor
    // must stop whatever today's numbers say — that is what makes the floor the
    // only limit that means "never below this".
    const hard = hardLimitBreach(cb, equity, {
      equityFloor: cfg.equityFloor,
      maxWeeklyLossPercent: cfg.maxWeeklyLossPercent,
    });

    if (hard) {
      logger.error(
        { userId, code: hard.code, equity, floor: cfg.equityFloor, weekStart: cb.weekStartEquity },
        "Hard risk limit TRIPPED — stopping bot"
      );
      await haltTrading(userId, state, hard.reason, "Your trading bot was stopped by a risk limit");
      return results;
    }

    if (
      // Intraday drawdown: measured from the day's PEAK, not its open, so a
      // morning gain followed by a slide still halts. The day-start breaker
      // below cannot see that — an account up 5% then down 4% is still "up"
      // against the open while having given back most of the day. At scalping
      // frequency that is the loss pattern that actually happens.
      cfg.maxIntradayDrawdownPercent > 0 &&
      cb.dayPeakEquity !== null &&
      cb.dayPeakEquity > 0 &&
      ((cb.dayPeakEquity - equity) / cb.dayPeakEquity) * 100 >= cfg.maxIntradayDrawdownPercent
    ) {
      const ddPct = ((cb.dayPeakEquity - equity) / cb.dayPeakEquity) * 100;
      const reason = `Equity fell ${ddPct.toFixed(2)}% from today's peak, past the ${cfg.maxIntradayDrawdownPercent}% intraday limit. Trading is halted until you resume it.`;
      logger.error(
        { userId, ddPct, limit: cfg.maxIntradayDrawdownPercent, peak: cb.dayPeakEquity, total: equity },
        "Intraday drawdown limit TRIPPED — stopping bot"
      );
      await haltTrading(userId, state, reason, "Your trading bot was stopped by the intraday drawdown limit");
      return results;
    }

    if (cfg.maxDailyLossPercent > 0 && cb.dayStartEquity !== null && cb.dayStartEquity > 0) {
      const lossPct = ((cb.dayStartEquity - equity) / cb.dayStartEquity) * 100;
      if (lossPct >= cfg.maxDailyLossPercent) {
        const tripReason = `Daily loss of ${lossPct.toFixed(2)}% reached the ${cfg.maxDailyLossPercent}% limit. Trading is halted until you resume it.`;
        logger.error(
          { userId, lossPct, limit: cfg.maxDailyLossPercent, dayStartEquity: cb.dayStartEquity, total: equity },
          "Daily-loss circuit breaker TRIPPED — stopping bot"
        );
        await haltTrading(userId, state, tripReason, "Your trading bot was stopped by the daily-loss limit");
        return results;
      }
    }
  }

  // Losing-streak breaker. The equity limits above only notice a problem once
  // the money is gone; a run of losses is the earliest evidence that conditions
  // have turned against the strategy. Counted from the BROKER's history because
  // most closes are stop-losses that never pass through the bot, so our own
  // trades table would miss them.
  if (state.running && !dryRun && cfg.maxConsecutiveLosses > 0) {
    const streak = await consecutiveLossStreak(userId, credentials);
    // Both conditions, not either. A streak must be long AND have cost
    // something: on 24 Sep 2026 six losses averaging £0.23 halted trading for
    // the rest of the day over £1.38, because the breaker counted events and
    // ignored money. A cost floor of 0 restores counting alone.
    const equity = account?.total ?? null;
    const costFloor =
      cfg.minStreakLossPercent > 0 && equity !== null && equity > 0
        ? (equity * cfg.minStreakLossPercent) / 100
        : 0;
    if (streak !== null && streak.count >= cfg.maxConsecutiveLosses && streak.loss >= costFloor) {
      const reason =
        `${streak.count} trades in a row closed at a loss, costing ${formatMoney(streak.loss, account?.currency ?? null)} ` +
        `— your limit is ${cfg.maxConsecutiveLosses} losses in a row. Trading is halted until you resume it: a losing run ` +
        `this long usually means conditions have changed, not that the next trade is due to win.`;
      logger.error(
        { userId, streak: streak.count, loss: streak.loss, costFloor, limit: cfg.maxConsecutiveLosses },
        "Losing-streak breaker TRIPPED — stopping bot"
      );
      await haltTrading(userId, state, reason, "Your trading bot was stopped after a run of losing trades");
      return results;
    }
    if (streak !== null && streak.count >= cfg.maxConsecutiveLosses) {
      // Long enough to trip on count, cheap enough not to. Worth a log line:
      // this is the case that used to halt the day.
      logger.info(
        { userId, streak: streak.count, loss: streak.loss, costFloor },
        "Losing streak reached its count but not its cost floor — continuing"
      );
    }
  }

  // No new positions this close to a session end. The window is the close
  // window PLUS one cycle: open at 11 minutes to close with a 10-minute window
  // and the pre-close pass shuts it 5 minutes later, paying the spread twice for
  // a position that existed only to be closed.
  const noOpenWithinMinutes =
    cfg.closeBeforeSessionEndMinutes > 0 ? cfg.closeBeforeSessionEndMinutes + cfg.intervalMinutes : 0;
  const tooCloseToSessionEnd = (minutes: number | null): boolean =>
    noOpenWithinMinutes > 0 && minutes !== null && minutes <= noOpenWithinMinutes;

  // The mirror at the other end of the session. A 21-period average of
  // 5-minute bars is 105 minutes of history, so at an opening bell every bar
  // behind it is from yesterday: the averages walk yesterday's path while the
  // price gaps, and the crossover fires in the direction the price has just
  // left. Measured at the US open on 24 Sep 2026 — five signals in six minutes,
  // all five refused by the AI guard, SPCX's two moving averages 0.047% apart.
  const tooSoonAfterSessionOpen = (minutes: number | null): boolean =>
    cfg.noOpenAfterSessionStartMinutes > 0 && minutes !== null && minutes < cfg.noOpenAfterSessionStartMinutes;

  // Daily profit lock. Once equity is up by the target against the day's start,
  // no new positions for the rest of the UTC day; closes still go through, so
  // an open position can always be exited. Measured on the same baseline as the
  // daily-loss breaker, and like it, the baseline resets if the process
  // restarts mid-day — a deploy re-measures the day from the restart.
  let profitLocked = false;
  if (state.running && cfg.dailyProfitTarget > 0 && account !== null && account.total !== null) {
    const cb = state.circuitBreaker;
    const todayKey = utcDayKey(new Date());
    if (cb.profitLockedDayKey === todayKey) {
      profitLocked = true;
    } else if (cb.dayKey === todayKey && cb.dayStartEquity !== null && account.total - cb.dayStartEquity >= cfg.dailyProfitTarget) {
      cb.profitLockedDayKey = todayKey;
      profitLocked = true;
      const gain = formatMoney(account.total - cb.dayStartEquity, account.currency);
      logger.info({ userId, gain, target: cfg.dailyProfitTarget }, "Daily profit target reached — no new positions today");
      await notifyUser(userId, {
        type: "profit_target",
        title: `Today's profit target is reached: up ${gain}`,
        body: `No new positions will be opened for the rest of the day (UTC). Open positions keep their stop-loss and take-profit, and can still be closed. Trading resumes tomorrow.`,
        link: "/performance",
      });
    }
  }

  // Daily churn cap. Counted ONCE per cycle rather than per candidate: we place
  // the orders, so trades_table rows for the UTC day are an exact count, and at
  // one-minute cycles a per-candidate query would be a needless hammering of
  // the database. A cap reached mid-cycle simply blocks the rest of it.
  // When each instrument was last sent an order on each side, for the repeat
  // guard. Read from our own order log rather than the broker's positions,
  // because the positions list lags a fill by seconds — and every cycle sizes
  // its decision from that list.
  //
  // On 24 Sep 2026 this cost real money twice in fifteen minutes. GOLD and
  // US500 were each BOUGHT twice, 11 seconds apart, because the first fill was
  // not in the position list yet. Then GOLD was SOLD four times in six minutes:
  // each cycle read a long that was already closed and "closed" it again, which
  // on a broker that opens a new deal per order is how you end up short 0.4
  // units of gold having never decided to be short at all. The exposure caps
  // could not stop it, because a close is deliberately exempt from them.
  //
  // Keyed by ticker AND side on purpose: repeating an instruction is the bug,
  // so an entry followed by a genuine exit is not delayed.
  const lastOrderByTickerSide = new Map<string, Date>();
  const orderKey = (ticker: string, side: string) => `${ticker}|${side}`;
  if (cfg.reentryCooldownMinutes > 0) {
    try {
      const since = new Date(Date.now() - cfg.reentryCooldownMinutes * 60_000);
      const recent = await db
        .select({ ticker: tradesTable.ticker, side: tradesTable.side, executedAt: tradesTable.executedAt })
        .from(tradesTable)
        .where(
          and(
            eq(tradesTable.userId, userId),
            gte(tradesTable.executedAt, since),
            inArray(tradesTable.status, ["FILLED", "DRY_RUN"])
          )
        );
      for (const r of recent) {
        const key = orderKey(r.ticker, r.side);
        const prev = lastOrderByTickerSide.get(key);
        if (!prev || r.executedAt > prev) lastOrderByTickerSide.set(key, r.executedAt);
      }
    } catch (err) {
      // Fail OPEN deliberately: an unreadable order log must not stop the bot
      // closing positions. The pyramiding gate below needs no database and
      // still holds.
      logger.warn({ err, userId }, "Could not read recent orders — the repeat guard is not enforced this cycle");
    }
  }

  let tradesToday = 0;
  let atTradeCap = false;
  if (cfg.maxTradesPerDay > 0) {
    try {
      const dayStart = new Date(`${utcDayKey(new Date())}T00:00:00.000Z`);
      // Only orders that actually executed count. A FAILED row is a broker
      // rejection — nothing traded — and counting them let one overnight retry
      // storm eat most of the day's allowance before the market even opened
      // (32 rejected sells on 17-18 Sep, against a cap of 50). DRY_RUN counts,
      // so a dry run is capped exactly as the live bot would be.
      const todaysTrades = await db
        .select({ id: tradesTable.id })
        .from(tradesTable)
        .where(
          and(
            eq(tradesTable.userId, userId),
            gte(tradesTable.executedAt, dayStart),
            inArray(tradesTable.status, ["FILLED", "DRY_RUN"])
          )
        );
      tradesToday = todaysTrades.length;
      atTradeCap = tradesToday >= cfg.maxTradesPerDay;
      if (atTradeCap) {
        logger.info({ userId, tradesToday, limit: cfg.maxTradesPerDay }, "Daily trade cap reached — no new orders this cycle");
      }
    } catch (err) {
      // Fail CLOSED: if we cannot count today's trades we cannot honour the
      // cap, and an uncounted fast engine is exactly what the cap exists to
      // prevent. Opposite of the fail-open used for market-status checks.
      atTradeCap = true;
      logger.error({ userId, err }, "Could not count today's trades — blocking new orders this cycle (fail-closed)");
    }
  }

  // Open positions: fetched every cycle. Used to enforce maxConcurrentPositions
  // for all modes, give Claude exposure context in AI modes, and — before either
  // of those — to flatten (force-close) any position whose market has closed.
  let rawPositions: NormalizedPosition[] = [];
  let positionsFetchOk = true;
  try {
    rawPositions = await getBrokerPositions(userId, credentials);
  } catch (err) {
    positionsFetchOk = false;
    logger.warn({ userId, broker: credentials.broker, err }, "Could not fetch open positions");
  }

  // Flatten-by-close: a risk/session-integrity control, not a trading decision,
  // so it runs once here regardless of aiTradeMode (off/guard/autonomous) and
  // before the signal loop derives positions/liveTickers from the (now
  // post-flatten) position set below. Never blocks — only ever force-closes.
  for (const pos of [...rawPositions]) {
    const shouldFlatten = await isMarketClosedForFlatten(userId, credentials, pos.ticker);
    if (!shouldFlatten) continue;

    const closeSide: "BUY" | "SELL" = pos.direction === "BUY" ? "SELL" : "BUY";
    logger.info(
      { userId, ticker: pos.ticker, direction: pos.direction, quantity: pos.quantity },
      "Flatten-by-close: market closed for an open position, closing this cycle"
    );

    const closed = await placeAndRecord({
      userId,
      credentials,
      ticker: pos.ticker,
      side: closeSide,
      quantity: pos.quantity,
      positionValue: pos.quantity * pos.currentPrice,
      currentPrice: pos.currentPrice,
      cfg,
      dryRun,
      aiReason: "Flatten-by-close: market closed for this instrument.",
      isClose: true,
      closeDeals: [pos],
    });

    if (closed) {
      // Drop it from the working set so the signal loop below (which derives
      // positions/liveTickers from rawPositions) sees it as no longer held —
      // a fresh signal on the same ticker this cycle is then correctly
      // evaluated as opening a NEW position, not adding to one just closed.
      rawPositions = rawPositions.filter((p) => p.ticker !== pos.ticker);
    }
    // If the close failed, the position stays in rawPositions and this same
    // check will retry it next cycle — identical retry behavior to any other
    // trade failure, no bespoke handling needed.
  }

  // Close-before-session-end: an opt-in risk control, like flatten-by-close,
  // and for the same reason run once here regardless of aiTradeMode.
  //
  // What it protects against is the overnight (and weekend) gap. A stop-loss is
  // an order that fires at the next available price, and when a market reopens
  // that price can be far past the stop — a 2% stop can fill as a 6% loss. The
  // only way to be protected from a gap is not to be holding through it.
  //
  // Each deal is closed at its own size (never equity-sized — see planOrder).
  // One quote per ticker per cycle, shared by that ticker's deals.
  if (cfg.closeBeforeSessionEndMinutes > 0 && positionsFetchOk) {
    const minutesByTicker = new Map<string, number | null>();
    for (const pos of [...rawPositions]) {
      if (!minutesByTicker.has(pos.ticker)) {
        try {
          const q = await getBrokerQuote(userId, credentials, pos.ticker);
          minutesByTicker.set(pos.ticker, minutesUntilSessionEnd(q.openingHours));
        } catch (err) {
          // Unknown schedule means no action: a lookup failure must never be
          // mistaken for an imminent close.
          logger.warn({ userId, ticker: pos.ticker, err }, "Could not read market hours — not closing before session end");
          minutesByTicker.set(pos.ticker, null);
        }
      }
      const minutes = minutesByTicker.get(pos.ticker) ?? null;
      if (minutes === null || minutes > cfg.closeBeforeSessionEndMinutes) continue;

      const closeAt = formatSessionEnd(minutes);
      logger.info({ userId, ticker: pos.ticker, minutes, closeAt }, "Closing before the session ends");
      const closed = await placeAndRecord({
        userId,
        credentials,
        ticker: pos.ticker,
        side: pos.direction === "BUY" ? "SELL" : "BUY",
        quantity: pos.quantity,
        positionValue: pos.quantity * pos.currentPrice,
        currentPrice: pos.currentPrice,
        cfg,
        dryRun,
        aiReason: `Closed before the market closes at ${closeAt}, so it isn't held through the overnight gap.`,
        isClose: true,
        closeDeals: [pos],
      });
      if (closed) rawPositions = rawPositions.filter((p) => p !== pos);
    }
  }

  // Held size per ticker and direction, from the post-flatten set: what a close
  // this cycle can actually close. Kept current as orders execute below.
  const held = heldByTicker(rawPositions);

  // Exposure now, kept current as orders execute — so a cap can't be walked
  // past by several orders inside one cycle, which is exactly how the SMCI
  // short was built (0.36 units at a time, every cycle, for two days).
  const exposure = exposureByTicker(rawPositions);
  const exposureCap = (percent: number): number =>
    percent > 0 && accountBalance !== null && accountBalance > 0 ? (accountBalance * percent) / 100 : Infinity;
  const instrumentCap = exposureCap(cfg.maxInstrumentExposurePercent);
  const totalCap = exposureCap(cfg.maxTotalExposurePercent);
  const netCap = exposureCap(cfg.maxNetDirectionalPercent);

  const positions: PositionSnapshot[] = rawPositions.map((p) => ({
    ticker: p.ticker,
    quantity: p.quantity,
    averagePrice: p.averagePrice,
    currentPrice: p.currentPrice,
    pnlPercent: p.pnlPercent,
  }));

  // Fail-closed: if we can't read the data a limit depends on, block any
  // exposure-INCREASING order this cycle rather than trade blind. This covers
  // both new positions (either side — a SELL opens a short on Capital.com) AND
  // any BUY that adds to an already-held long, because without account equity
  // `sizePosition` falls back to a fixed amount and cannot enforce the
  // maxPositionSizePercent cap. The per-position size cap and the daily-loss
  // breaker both need account equity; the concurrent-position cap needs the
  // live positions list. Reducing trades (a SELL on a held long) stay allowed
  // since they only shrink exposure.
  const riskDataUnavailable =
    (account === null &&
      (cfg.maxPositionSizePercent > 0 ||
        cfg.maxDailyLossPercent > 0 ||
        cfg.maxInstrumentExposurePercent > 0 ||
        cfg.maxTotalExposurePercent > 0)) ||
    // Without the position list, exposure is unknown — and an exposure cap you
    // cannot measure is not a cap.
    (!positionsFetchOk &&
      (cfg.maxConcurrentPositions > 0 ||
        cfg.maxInstrumentExposurePercent > 0 ||
        cfg.maxTotalExposurePercent > 0));

  // Equity that cannot fund a position. Distinct from riskDataUnavailable —
  // there the balance is UNKNOWN; here it is known and unusable.
  //
  // A zero balance is not caught by the sizing maths: `sizePosition` returns a
  // position value of 0, and a quantity of 0 clears the min-deal-size gate
  // whenever the broker's minimum is unknown (`quantity < (minDealSize ?? 0)`
  // is `0 < 0`, false). Without this gate a zero-equity account sends the
  // broker a zero-quantity order to reject, once per instrument per cycle.
  //
  // Until now the only thing refusing those orders was the language model's
  // veto in guard/autonomous mode — a prose opinion, and one that disappears
  // entirely when aiTradeMode is "off". The risk layer has to refuse this on
  // its own, deterministically, in every mode.
  const equityUnusable = account !== null && account.total !== null && account.total <= 0;
  if (equityUnusable) {
    logger.warn(
      { userId, total: account?.total },
      "Account equity is zero or negative — blocking exposure-increasing orders this cycle"
    );
  }
  if (riskDataUnavailable) {
    logger.warn(
      { userId, accountAvailable: account !== null, positionsFetchOk },
      "Risk data unavailable — blocking new BUY entries this cycle (fail-safe)"
    );
  }

  // Gather price + MA context for every enabled instrument up front.
  interface InstrumentContext {
    ticker: string;
    currentPrice: number;
    signal: "BUY" | "SELL" | "HOLD";
    shortMa: number;
    longMa: number;
    strategy: StrategyName;
    /** Null in scalp mode — a regime reading over one-minute bars is noise, not a classification. */
    regime: Regime | null;
    /**
     * How far the strategy expects price to travel, as a fraction. Only the
     * scalp strategy produces one; null elsewhere, which the cost gate treats
     * as "not applicable" for non-scalp modes.
     */
    expectedMovePct: number | null;
  }
  const bars = requiredBars(longPeriod);
  const contexts: InstrumentContext[] = [];
  for (const instrument of instruments) {
    try {
      if (cfg.strategyMode === "scalp") {
        // Scalp needs true OHLC (ATR uses highs/lows), so it takes the candle
        // endpoint rather than the close-only series the other strategies use.
        const candles = await getBrokerCandles(userId, credentials, instrument.ticker, scalpRequiredBars(), cfg.barResolution);
        if (candles.length < scalpRequiredBars()) {
          logger.warn({ userId, ticker: instrument.ticker }, "Not enough candles for a scalp signal");
          continue;
        }
        const scalp = computeScalpSignal(candles);
        const lastClose = candles[candles.length - 1]!.close;
        contexts.push({
          ticker: instrument.ticker,
          currentPrice: lastClose,
          signal: scalp.signal,
          // The EMA anchor stands in for both MA fields so downstream logging
          // and the AI context keep a consistent shape across strategies.
          shortMa: scalp.ema ?? lastClose,
          longMa: scalp.ema ?? lastClose,
          strategy: "scalp",
          regime: null,
          expectedMovePct: scalp.expectedMovePct,
        });
        continue;
      }

      const prices = await getBrokerPriceHistory(userId, credentials, instrument.ticker, bars, cfg.barResolution);
      if (prices.length < longPeriod + 1) {
        logger.warn({ userId, ticker: instrument.ticker, broker: credentials.broker }, "Not enough price data for signal computation");
        continue;
      }
      const currentPrice = prices[prices.length - 1];
      // Regime filter routes to trend-following (MA) or mean-reversion (RSI +
      // Bollinger) automatically; deterministic, no LLM dependency.
      const routed = routeStrategy(prices, shortPeriod, longPeriod, cfg.regimeFilterEnabled);
      if (!routed) continue;
      contexts.push({
        ticker: instrument.ticker,
        currentPrice,
        signal: routed.signal,
        shortMa: routed.shortMa,
        longMa: routed.longMa,
        strategy: routed.strategy,
        regime: routed.regime,
        expectedMovePct: null,
      });
    } catch (err) {
      logger.error({ userId, ticker: instrument.ticker, broker: credentials.broker, err }, "Error processing instrument");
    }
  }

  if (aiTradeMode === "autonomous") {
    // Claude decides the action for every instrument from live context.
    const candidates: CandidateInstrument[] = contexts.map((c) => ({
      ticker: c.ticker,
      price: c.currentPrice,
      shortMa: c.shortMa,
      longMa: c.longMa,
    }));

    let decisions;
    try {
      decisions = await decideTrades(candidates, account, positions, logger);
    } catch (err) {
      logger.error({ userId, err }, "AI decision engine failed — holding all instruments this cycle");
      decisions = candidates.map((c) => ({
        ticker: c.ticker,
        action: "HOLD" as const,
        confidence: "low" as const,
        reason: "AI decision engine was unavailable, so no trade was made.",
      }));
    }
    const byTicker = new Map(decisions.map((d) => [d.ticker, d]));

    // Portfolio-level cap: Claude may return many BUYs in one cycle. Never let a
    // single cycle deploy more capital than the account's available cash, so
    // aggregate exposure can't multiply beyond what the account actually holds.
    const cashBudget = account?.cash ?? null;
    let deployedThisCycle = 0;
    // Distinct open positions (by ticker). Adding to an existing ticker does not
    // consume a new concurrent-position slot; only a brand-new ticker does.
    const liveTickers = new Set(positions.map((p) => p.ticker));

    for (const c of contexts) {
      const decision = byTicker.get(c.ticker) ?? {
        ticker: c.ticker,
        action: "HOLD" as const,
        confidence: "low" as const,
        reason: "No decision returned; holding.",
      };
      let tradeExecuted = false;
      let aiReason = decision.reason;
      // Recorded on the signal below whether or not anything is traded: the
      // spread is what decides which instruments can pay at all.
      let spreadPct: number | null = null;
      if (decision.action !== "HOLD") {
        const { closing, quantity, positionValue } = planOrder(
          decision.action, c.ticker, held, c.currentPrice, cfg, accountBalance
        );
        // Every risk gate below exists to limit NEW exposure. A close reduces
        // exposure, so none of them may block it — a churn cap, a cost hurdle or
        // a missing balance must never trap a position you are trying to exit.
        const exposureIncreasing = !closing;
        const isBuy = decision.action === "BUY";
        // A trade on a ticker we don't already hold opens a NEW distinct position
        // regardless of side — on Capital.com a SELL opens a short. The
        // concurrent-cap and fail-closed gates therefore apply to BUY and SELL
        // alike. A trade on an already-open ticker (net/close) consumes no new slot.
        const opensNewPosition = !liveTickers.has(c.ticker);
        const atPositionLimit =
          cfg.maxConcurrentPositions > 0 &&
          opensNewPosition &&
          liveTickers.size >= cfg.maxConcurrentPositions;
        // Checked unconditionally (not gated by opensNewPosition) since
        // minDealSize matters for every new order, including one that adds to
        // an already-open position — unlike marketClosed, which stays scoped
        // to brand-new entries only, per checkEntryQuote's own docs.
        const entryCheck = await checkEntryQuote(userId, credentials, c.ticker);
        spreadPct = entryCheck.spreadPct;
        const marketClosed = opensNewPosition && entryCheck.marketClosed;
        // null minDealSize (unknown) falls back to 0 — "no minimum known,
        // allow the trade" — consistent with checkEntryQuote's own fail-open
        // behavior on a lookup error, not a gap to later tighten into a block.
        const belowMinDealSize = quantity < (entryCheck.minDealSize ?? 0);
        if (entryCheck.unorderable) {
          // First, and for every order including closes: the broker will reject
          // anything placed now. Nothing is recorded as a trade — nothing was
          // attempted — and the same decision simply runs again next cycle.
          aiReason = `Waiting: ${c.ticker}'s market is closed, so no order can be placed until it reopens. ${decision.reason}`;
          logger.info({ userId, ticker: c.ticker, side: decision.action, closing }, "Order deferred — market closed to all orders");
        } else if (exposureIncreasing && profitLocked) {
          aiReason = `Skipped: today's profit target of ${formatMoney(cfg.dailyProfitTarget, account?.currency ?? null)} is reached, so no new positions until tomorrow (UTC). ${decision.reason}`;
        } else if (
          withinCooldown(lastOrderByTickerSide.get(orderKey(c.ticker, decision.action)) ?? null, new Date(), cfg.reentryCooldownMinutes)
        ) {
          aiReason = `Skipped: a ${decision.action} for ${c.ticker} was already placed in the last ${cfg.reentryCooldownMinutes} minutes, and the broker may not have reported it yet. ${decision.reason}`;
          logger.info(
            { userId, ticker: c.ticker, side: decision.action, closing, cooldown: cfg.reentryCooldownMinutes },
            "Order skipped — same instruction sent recently"
          );
        } else if (exposureIncreasing && cfg.onePositionPerInstrument && !opensNewPosition) {
          aiReason = `Skipped: there is already an open position in ${c.ticker}, and adding to it is off. ${decision.reason}`;
          logger.info({ userId, ticker: c.ticker, side: decision.action }, "Entry skipped — one position per instrument");
        } else if (exposureIncreasing && tooCloseToSessionEnd(entryCheck.minutesToSessionEnd)) {
          aiReason = `Skipped: ${c.ticker}'s market closes at ${formatSessionEnd(entryCheck.minutesToSessionEnd ?? 0)}, too soon to open a position that won't be held overnight. ${decision.reason}`;
        } else if (exposureIncreasing && tooSoonAfterSessionOpen(entryCheck.minutesSinceSessionOpen)) {
          aiReason =
            `Skipped: ${c.ticker}'s market opened ${Math.round(entryCheck.minutesSinceSessionOpen ?? 0)} minutes ago, ` +
            `inside your ${cfg.noOpenAfterSessionStartMinutes}-minute settling window — the averages are still made of ` +
            `yesterday's bars. ${decision.reason}`;
          logger.info(
            { userId, ticker: c.ticker, sinceOpen: entryCheck.minutesSinceSessionOpen, window: cfg.noOpenAfterSessionStartMinutes },
            "Entry skipped — inside the opening window"
          );
        } else if (exposureIncreasing && (exposure.byTicker.get(c.ticker) ?? 0) + positionValue > instrumentCap) {
          aiReason =
            `Skipped: this would take ${c.ticker} past your per-instrument exposure limit — ` +
            `${exposureWords(exposure.byTicker.get(c.ticker) ?? 0, positionValue, instrumentCap, account?.currency ?? null)}. ${decision.reason}`;
          logger.warn(
            { userId, ticker: c.ticker, current: exposure.byTicker.get(c.ticker) ?? 0, adding: positionValue, cap: instrumentCap },
            "Entry skipped — per-instrument exposure limit"
          );
        } else if (exposureIncreasing && exposure.total + positionValue > totalCap) {
          aiReason =
            `Skipped: this would take your total exposure past its limit — ` +
            `${exposureWords(exposure.total, positionValue, totalCap, account?.currency ?? null)}. ${decision.reason}`;
          logger.warn({ userId, ticker: c.ticker, total: exposure.total, adding: positionValue, cap: totalCap }, "Entry skipped — total exposure limit");
        } else if (exposureIncreasing && breachesNetDirectional(exposure.net, positionValue, isBuy, netCap)) {
          aiReason =
            `Skipped: the account is already ${directionWords(exposure.net, account?.currency ?? null)} and this would ` +
            `push it past your net direction limit of ${formatMoney(netCap, account?.currency ?? null)}. ${decision.reason}`;
          logger.warn({ userId, ticker: c.ticker, net: exposure.net, adding: positionValue, isBuy, cap: netCap }, "Entry skipped — net direction limit");
        } else if (exposureIncreasing && exitTooTightForBroker(cfg, entryCheck.minStopDistancePercent)) {
          const tight = exitTooTightForBroker(cfg, entryCheck.minStopDistancePercent)!;
          aiReason =
            `Skipped: ${c.ticker} needs a ${tight.which} at least ${tight.required.toFixed(2)}% away and yours is ` +
            `${tight.configured}%, so the broker would reject the order. ${decision.reason}`;
          logger.info(
            { userId, ticker: c.ticker, which: tight.which, configured: tight.configured, required: tight.required },
            "Entry skipped — exit distance below the broker's minimum"
          );
        } else if (exposureIncreasing && atTradeCap) {
          aiReason = `Skipped: you've reached your ${cfg.maxTradesPerDay}-trade daily limit. ${decision.reason}`;
        } else if (exposureIncreasing && !clearsCostHurdle(cfg, c.expectedMovePct, entryCheck.spreadPct)) {
          aiReason = costHurdleReason(cfg, c.expectedMovePct, entryCheck.spreadPct) + ` ${decision.reason}`;
        } else if (!meetsConfidenceFloor(decision.confidence, cfg.minAiConfidence)) {
          // The AI stated its own conviction; acting on a "low" it flagged
          // itself is the user overriding the model, not trusting it.
          aiReason = `Skipped: AI confidence was ${decision.confidence}, below your ${cfg.minAiConfidence} threshold. ${decision.reason}`;
          logger.info(
            { userId, ticker: c.ticker, side: decision.action, confidence: decision.confidence, floor: cfg.minAiConfidence },
            "Autonomous entry skipped — below AI confidence floor"
          );
        } else if (exposureIncreasing && equityUnusable) {
          aiReason = `Skipped: your account balance is ${account?.total ?? 0} ${account?.currency ?? ""}`.trim() +
            `, so there is nothing to open a position with. ${decision.reason}`;
          logger.warn(
            { userId, ticker: c.ticker, side: decision.action, total: account?.total },
            "Autonomous entry skipped — account equity is zero or negative"
          );
        } else if (exposureIncreasing && riskDataUnavailable) {
          aiReason = `Skipped: risk data was unavailable this cycle, so no exposure-increasing trade was placed for safety. ${decision.reason}`;
          logger.warn(
            { userId, ticker: c.ticker, side: decision.action },
            "Autonomous exposure-increasing trade skipped — risk data unavailable (fail-safe)"
          );
        } else if (atPositionLimit) {
          aiReason = `Skipped: already at the ${cfg.maxConcurrentPositions}-position limit. ${decision.reason}`;
          logger.warn(
            { userId, ticker: c.ticker, side: decision.action, openPositions: liveTickers.size, limit: cfg.maxConcurrentPositions },
            "Autonomous entry skipped — max concurrent positions reached"
          );
        } else if (marketClosed) {
          aiReason = `Skipped: the market for ${c.ticker} isn't currently open for trading. ${decision.reason}`;
          logger.info({ userId, ticker: c.ticker, side: decision.action }, "Autonomous entry skipped — market closed");
        } else if (belowMinDealSize) {
          aiReason = `Skipped: calculated size (${quantity} units) is below ${credentials.broker}'s minimum tradeable size (${entryCheck.minDealSize} units) for ${c.ticker}. ${decision.reason}`;
          logger.info(
            { userId, ticker: c.ticker, side: decision.action, quantity, minDealSize: entryCheck.minDealSize },
            "Autonomous entry skipped — below broker's minimum deal size"
          );
        } else if (exposureIncreasing && isBuy && cashBudget !== null && deployedThisCycle + positionValue > cashBudget) {
          aiReason = `Skipped: would exceed the account's available cash budget for this cycle. ${decision.reason}`;
          logger.warn(
            { userId, ticker: c.ticker, positionValue, deployedThisCycle, cashBudget },
            "Autonomous BUY skipped — per-cycle cash budget exceeded"
          );
        } else {
          tradeExecuted = await placeAndRecord({
            userId,
            credentials,
            ticker: c.ticker,
            side: decision.action,
            quantity,
            positionValue,
            currentPrice: c.currentPrice,
            cfg,
            dryRun,
            aiReason: decision.reason,
            aiConfidence: decision.confidence,
            // A close carries no new stop/take-profit: there is no resulting
            // position left for them to protect.
            isClose: closing,
            closeDeals: closing ? dealsToClose(rawPositions, c.ticker, decision.action) : undefined,
          });
          if (tradeExecuted) {
            if (exposureIncreasing && isBuy) deployedThisCycle += positionValue;
            if (opensNewPosition) liveTickers.add(c.ticker);
            recordExecution(held, liveTickers, c.ticker, decision.action, quantity, closing, exposure, positionValue);
          }
        }
      }
      await db.insert(signalsTable).values({
        userId,
        ticker: c.ticker,
        signal: decision.action,
        shortMa: String(c.shortMa),
        longMa: String(c.longMa),
        price: String(c.currentPrice),
        tradeExecuted,
        aiReason,
        strategy: c.strategy,
        regime: c.regime,
        spreadPct,
      });
      results.push({ ticker: c.ticker, signal: decision.action, tradeExecuted });
    }

    return results;
  }

  // "off" and "guard": the MA crossover produces the signal.
  // Same portfolio-level cap as autonomous mode: never deploy more than the
  // account's available cash across a single cycle.
  const cashBudget = account?.cash ?? null;
  let deployedThisCycle = 0;
  // Distinct open positions (by ticker); adding to an existing ticker does not
  // consume a new concurrent-position slot.
  const liveTickers = new Set(positions.map((p) => p.ticker));

  for (const c of contexts) {
    const { ticker, signal, shortMa, longMa, currentPrice, expectedMovePct } = c;
    let tradeExecuted = false;
    let aiReason: string | null = null;
    // Recorded on the signal below whether or not anything is traded.
    let spreadPct: number | null = null;

    if (signal !== "HOLD") {
      let proceed = true;
      let aiConfidence: string | undefined;

      if (aiTradeMode === "guard") {
        try {
          const review = await reviewSignal(
            {
              ticker,
              side: signal,
              price: currentPrice,
              shortMa,
              longMa,
              shortPeriod,
              longPeriod,
              account,
              positions,
            },
            logger
          );
          aiReason = review.reason;
          aiConfidence = review.confidence;
          proceed = review.approved;
          if (!proceed) {
            logger.info({ userId, ticker, signal, reason: review.reason }, "AI vetoed signal");
          } else if (!meetsConfidenceFloor(review.confidence, cfg.minAiConfidence)) {
            // Approved, but only weakly. Treated as a veto so the floor means
            // the same thing in both AI modes.
            proceed = false;
            aiReason = `Skipped: AI approved but with ${review.confidence} confidence, below your ${cfg.minAiConfidence} threshold. ${review.reason}`;
            logger.info(
              { userId, ticker, signal, confidence: review.confidence, floor: cfg.minAiConfidence },
              "Signal skipped — below AI confidence floor"
            );
          }
        } catch (err) {
          logger.error({ userId, ticker, signal, err }, "AI safety check failed — skipping trade for safety");
          aiReason = "AI safety check failed to respond, so the trade was skipped.";
          proceed = false;
        }
      }

      if (proceed) {
        const { closing, quantity, positionValue } = planOrder(
          signal, ticker, held, currentPrice, cfg, accountBalance
        );
        // Same rule as the autonomous branch: risk gates limit NEW exposure and
        // must never block a close.
        const exposureIncreasing = !closing;
        const isBuy = signal === "BUY";
        // Any order on a ticker we don't already hold opens a new distinct
        // position (a SELL opens a short on Capital.com), so the concurrent-cap
        // and fail-closed gates apply to both sides. A trade on an already-open
        // ticker (net/close) consumes no new slot.
        const opensNewPosition = !liveTickers.has(ticker);
        const atPositionLimit =
          cfg.maxConcurrentPositions > 0 &&
          opensNewPosition &&
          liveTickers.size >= cfg.maxConcurrentPositions;
        // Checked unconditionally (not gated by opensNewPosition) since
        // minDealSize matters for every new order, including one that adds to
        // an already-open position — unlike marketClosed, which stays scoped
        // to brand-new entries only, per checkEntryQuote's own docs.
        const entryCheck = await checkEntryQuote(userId, credentials, ticker);
        spreadPct = entryCheck.spreadPct;
        const marketClosed = opensNewPosition && entryCheck.marketClosed;
        // null minDealSize (unknown) falls back to 0 — "no minimum known,
        // allow the trade" — consistent with checkEntryQuote's own fail-open
        // behavior on a lookup error, not a gap to later tighten into a block.
        const belowMinDealSize = quantity < (entryCheck.minDealSize ?? 0);
        if (entryCheck.unorderable) {
          aiReason = `Waiting: ${ticker}'s market is closed, so no order can be placed until it reopens.`;
          logger.info({ userId, ticker, side: signal, closing }, "Order deferred — market closed to all orders");
        } else if (exposureIncreasing && profitLocked) {
          aiReason = `Trade skipped: today's profit target of ${formatMoney(cfg.dailyProfitTarget, account?.currency ?? null)} is reached, so no new positions until tomorrow (UTC).`;
        } else if (
          withinCooldown(lastOrderByTickerSide.get(orderKey(ticker, signal)) ?? null, new Date(), cfg.reentryCooldownMinutes)
        ) {
          aiReason = `Trade skipped: a ${signal} for ${ticker} was already placed in the last ${cfg.reentryCooldownMinutes} minutes, and the broker may not have reported it yet.`;
          logger.info(
            { userId, ticker, side: signal, closing, cooldown: cfg.reentryCooldownMinutes },
            "Order skipped — same instruction sent recently"
          );
        } else if (exposureIncreasing && cfg.onePositionPerInstrument && !opensNewPosition) {
          aiReason = `Trade skipped: there is already an open position in ${ticker}, and adding to it is off.`;
          logger.info({ userId, ticker, side: signal }, "Entry skipped — one position per instrument");
        } else if (exposureIncreasing && tooCloseToSessionEnd(entryCheck.minutesToSessionEnd)) {
          aiReason = `Trade skipped: ${ticker}'s market closes at ${formatSessionEnd(entryCheck.minutesToSessionEnd ?? 0)}, too soon to open a position that won't be held overnight.`;
        } else if (exposureIncreasing && tooSoonAfterSessionOpen(entryCheck.minutesSinceSessionOpen)) {
          aiReason =
            `Trade skipped: ${ticker}'s market opened ${Math.round(entryCheck.minutesSinceSessionOpen ?? 0)} minutes ago, ` +
            `inside your ${cfg.noOpenAfterSessionStartMinutes}-minute settling window — the averages are still made of yesterday's bars.`;
          logger.info(
            { userId, ticker, sinceOpen: entryCheck.minutesSinceSessionOpen, window: cfg.noOpenAfterSessionStartMinutes },
            "Entry skipped — inside the opening window"
          );
        } else if (exposureIncreasing && (exposure.byTicker.get(ticker) ?? 0) + positionValue > instrumentCap) {
          aiReason =
            `Trade skipped: this would take ${ticker} past your per-instrument exposure limit — ` +
            `${exposureWords(exposure.byTicker.get(ticker) ?? 0, positionValue, instrumentCap, account?.currency ?? null)}.`;
          logger.warn(
            { userId, ticker, current: exposure.byTicker.get(ticker) ?? 0, adding: positionValue, cap: instrumentCap },
            "Entry skipped — per-instrument exposure limit"
          );
        } else if (exposureIncreasing && exposure.total + positionValue > totalCap) {
          aiReason =
            `Trade skipped: this would take your total exposure past its limit — ` +
            `${exposureWords(exposure.total, positionValue, totalCap, account?.currency ?? null)}.`;
          logger.warn({ userId, ticker, total: exposure.total, adding: positionValue, cap: totalCap }, "Entry skipped — total exposure limit");
        } else if (exposureIncreasing && breachesNetDirectional(exposure.net, positionValue, isBuy, netCap)) {
          aiReason =
            `Trade skipped: the account is already ${directionWords(exposure.net, account?.currency ?? null)} and this ` +
            `would push it past your net direction limit of ${formatMoney(netCap, account?.currency ?? null)}.`;
          logger.warn({ userId, ticker, net: exposure.net, adding: positionValue, isBuy, cap: netCap }, "Entry skipped — net direction limit");
        } else if (exposureIncreasing && exitTooTightForBroker(cfg, entryCheck.minStopDistancePercent)) {
          const tight = exitTooTightForBroker(cfg, entryCheck.minStopDistancePercent)!;
          aiReason =
            `Trade skipped: ${ticker} needs a ${tight.which} at least ${tight.required.toFixed(2)}% away and yours is ` +
            `${tight.configured}%, so the broker would reject the order.`;
          logger.info(
            { userId, ticker, which: tight.which, configured: tight.configured, required: tight.required },
            "Entry skipped — exit distance below the broker's minimum"
          );
        } else if (exposureIncreasing && atTradeCap) {
          aiReason = `Trade skipped: you've reached your ${cfg.maxTradesPerDay}-trade daily limit.`;
          logger.info({ userId, ticker, limit: cfg.maxTradesPerDay }, "Entry skipped — daily trade cap");
        } else if (exposureIncreasing && !clearsCostHurdle(cfg, expectedMovePct, entryCheck.spreadPct)) {
          aiReason = costHurdleReason(cfg, expectedMovePct, entryCheck.spreadPct);
          logger.info(
            { userId, ticker, expectedMovePct, spreadPct: entryCheck.spreadPct, multiple: cfg.minEdgeVsSpread },
            "Entry skipped — expected move does not clear the spread hurdle"
          );
        } else if (exposureIncreasing && equityUnusable) {
          aiReason = `Trade skipped: your account balance is ${account?.total ?? 0} ${account?.currency ?? ""}`.trim() +
            ", so there is nothing to open a position with.";
          logger.warn(
            { userId, ticker, side: signal, total: account?.total },
            "Entry skipped — account equity is zero or negative"
          );
        } else if (exposureIncreasing && riskDataUnavailable) {
          aiReason = "Trade skipped: risk data was unavailable this cycle, so no exposure-increasing trade was placed for safety.";
          logger.warn({ userId, ticker, side: signal }, "Exposure-increasing trade skipped — risk data unavailable (fail-safe)");
        } else if (atPositionLimit) {
          aiReason = `Trade skipped: already at the ${cfg.maxConcurrentPositions}-position limit.`;
          logger.warn(
            { userId, ticker, side: signal, openPositions: liveTickers.size, limit: cfg.maxConcurrentPositions },
            "Entry skipped — max concurrent positions reached"
          );
        } else if (marketClosed) {
          aiReason = `Trade skipped: the market for ${ticker} isn't currently open for trading.`;
          logger.info({ userId, ticker, side: signal }, "Entry skipped — market closed");
        } else if (belowMinDealSize) {
          aiReason = `Trade skipped: calculated size (${quantity} units) is below ${credentials.broker}'s minimum tradeable size (${entryCheck.minDealSize} units) for ${ticker}.`;
          logger.info(
            { userId, ticker, side: signal, quantity, minDealSize: entryCheck.minDealSize },
            "Entry skipped — below broker's minimum deal size"
          );
        } else if (exposureIncreasing && isBuy && cashBudget !== null && deployedThisCycle + positionValue > cashBudget) {
          aiReason = "Trade skipped: it would exceed the account's available cash budget for this cycle.";
          logger.warn(
            { userId, ticker, positionValue, deployedThisCycle, cashBudget },
            "BUY skipped — per-cycle cash budget exceeded"
          );
        } else {
          logger.info({ userId, ticker, signal, positionValue, quantity }, "Signal detected");
          tradeExecuted = await placeAndRecord({
            userId,
            credentials,
            ticker,
            side: signal,
            quantity,
            positionValue,
            currentPrice,
            cfg,
            dryRun,
            aiReason: aiReason ?? undefined,
            aiConfidence,
            isClose: closing,
            closeDeals: closing ? dealsToClose(rawPositions, ticker, signal) : undefined,
          });
          if (tradeExecuted) {
            if (exposureIncreasing && isBuy) deployedThisCycle += positionValue;
            if (opensNewPosition) liveTickers.add(ticker);
            recordExecution(held, liveTickers, ticker, signal, quantity, closing, exposure, positionValue);
          }
        }
      }
    }

    await db.insert(signalsTable).values({
      userId,
      ticker,
      signal,
      shortMa: String(shortMa),
      longMa: String(longMa),
      price: String(currentPrice),
      tradeExecuted,
      aiReason,
      strategy: c.strategy,
      regime: c.regime,
      spreadPct,
    });
    results.push({ ticker, signal, tradeExecuted });
  }

  return results;
}

/** Position sizing: % of account balance if configured, else fixed amount. */
export function sizePosition(
  currentPrice: number,
  cfg: BotConfig,
  accountBalance: number | null
): { positionValue: number; quantity: number } {
  let positionValue =
    cfg.riskPerTradePercent > 0 && accountBalance !== null
      ? accountBalance * (cfg.riskPerTradePercent / 100)
      : cfg.tradeAmount;

  // Hard cap: a single position may never exceed maxPositionSizePercent of the
  // account balance. Clamp down regardless of how the base size was derived.
  if (cfg.maxPositionSizePercent > 0 && accountBalance !== null) {
    const cap = accountBalance * (cfg.maxPositionSizePercent / 100);
    if (positionValue > cap) positionValue = cap;
  }

  return { positionValue, quantity: positionValue / currentPrice };
}

/** Money terms for a skip message: "£500 of a £500 limit". */
function exposureWords(current: number, adding: number, cap: number, currency: string | null): string {
  const m = (n: number) => formatMoney(n, currency);
  return `${m(current)} already, ${m(adding)} more, against a ${m(cap)} limit`;
}

/**
 * Update this cycle's view of what is held after an order executes, so a later
 * decision in the same cycle sees the truth: a closed position is no longer
 * held (and frees its concurrent-position slot), and a new one is.
 */
function recordExecution(
  held: HeldPositions,
  liveTickers: Set<string>,
  ticker: string,
  side: "BUY" | "SELL",
  quantity: number,
  closing: boolean,
  exposure?: Exposure,
  positionValue?: number
): void {
  if (exposure && positionValue !== undefined) {
    const delta = closing ? -(exposure.byTicker.get(ticker) ?? 0) : positionValue;
    exposure.byTicker.set(ticker, Math.max(0, (exposure.byTicker.get(ticker) ?? 0) + delta));
    exposure.total = Math.max(0, exposure.total + delta);
    // The net moves by the signed amount: an opening BUY adds, an opening SELL
    // subtracts, and a close removes whatever this ticker was contributing.
    // Without this a cycle could open five same-direction positions and each
    // would measure against the net as it stood before any of them.
    const netDelta = closing
      ? -(exposure.netByTicker.get(ticker) ?? 0)
      : isBuySide(side)
        ? positionValue
        : -positionValue;
    exposure.netByTicker.set(ticker, (exposure.netByTicker.get(ticker) ?? 0) + netDelta);
    exposure.net += netDelta;
  }
  const h = held.get(ticker) ?? { long: 0, short: 0 };
  if (closing) {
    if (side === "SELL") h.long = 0;
    else h.short = 0;
  } else if (side === "BUY") {
    h.long += quantity;
  } else {
    h.short += quantity;
  }
  held.set(ticker, h);
  if (h.long === 0 && h.short === 0) liveTickers.delete(ticker);
}

/**
 * What each instrument is worth to the account right now, and the total.
 *
 * Exposure is the ABSOLUTE notional: a 39-unit short is 39 units of risk, the
 * same as a 39-unit long. Every deal on a ticker is summed, because the risk of
 * being wrong about SMCI does not care that it arrived as 108 small orders.
 */
export function exposureByTicker(positions: NormalizedPosition[]): Exposure {
  const byTicker = new Map<string, number>();
  const netByTicker = new Map<string, number>();
  let total = 0;
  let net = 0;
  for (const p of positions) {
    const notional = Math.abs(p.quantity * p.currentPrice);
    // Direction, not the sign of quantity: on Capital.com `size` is always a
    // positive magnitude and the direction is its own field.
    const signed = p.direction === "BUY" ? notional : -notional;
    byTicker.set(p.ticker, (byTicker.get(p.ticker) ?? 0) + notional);
    netByTicker.set(p.ticker, (netByTicker.get(p.ticker) ?? 0) + signed);
    total += notional;
    net += signed;
  }
  return { byTicker, netByTicker, total, net };
}

/**
 * Exposure two ways, because they answer different questions.
 *
 * `total` is gross: what is at risk in the market at all. `net` is directional:
 * longs positive, shorts negative. Three £250 shorts in gold and two US indices
 * — the position on 24 Sep 2026 — are £750 gross and −£750 net. The gross
 * figure sees three modest positions well inside every cap. The net figure sees
 * one £750 bet that everything falls together, which is what it actually is.
 */
export interface Exposure {
  /** Absolute notional per ticker. */
  byTicker: Map<string, number>;
  /** Signed notional per ticker: positive long, negative short. */
  netByTicker: Map<string, number>;
  total: number;
  net: number;
}

/**
 * Whether an order would push the account's net direction past its cap.
 *
 * Only refuses an order that makes the imbalance WORSE. An order that reduces
 * it is always allowed, even from over the cap — otherwise a breach would lock
 * the account out of the very trades that would correct it, which is the same
 * mistake as a risk gate that blocks a close.
 */
export function breachesNetDirectional(net: number, positionValue: number, isBuy: boolean, cap: number): boolean {
  if (!Number.isFinite(cap) || cap <= 0) return false;
  const after = net + (isBuy ? positionValue : -positionValue);
  return Math.abs(after) > cap && Math.abs(after) > Math.abs(net);
}

const isBuySide = (side: "BUY" | "SELL"): boolean => side === "BUY";

/**
 * The configured exit distance the broker would refuse, if any.
 *
 * Both the stop-loss and the take-profit are sent with an opening order, and
 * Capital.com applies one minimum distance to both. If either is closer than
 * that minimum the whole order is rejected — so the order is not worth sending.
 *
 * Widening the stop to fit was the alternative, and it is the wrong trade:
 * accepting a 0.6% stop on a strategy taking 0.3% profits inverts the risk and
 * reward of every trade on that instrument, quietly. Skipping trades an
 * instrument cannot support honestly is the smaller cost.
 *
 * Returns null when nothing is breached, or when the minimum is unknown — an
 * unreadable rule must not stop trading.
 */
export function exitTooTightForBroker(
  cfg: { stopLossPercent: number; takeProfitPercent: number },
  minStopDistancePercent: number | null
): { which: "stop-loss" | "take-profit"; configured: number; required: number } | null {
  if (minStopDistancePercent === null || !(minStopDistancePercent > 0)) return null;
  if (cfg.stopLossPercent > 0 && cfg.stopLossPercent < minStopDistancePercent) {
    return { which: "stop-loss", configured: cfg.stopLossPercent, required: minStopDistancePercent };
  }
  if (cfg.takeProfitPercent > 0 && cfg.takeProfitPercent < minStopDistancePercent) {
    return { which: "take-profit", configured: cfg.takeProfitPercent, required: minStopDistancePercent };
  }
  return null;
}

/** Held size per ticker, split by direction. */
export type HeldPositions = Map<string, { long: number; short: number }>;

/**
 * Collapse the broker's per-deal positions into held size per ticker.
 *
 * Capital.com returns each deal as its own position: buying PL twice gives two
 * rows, not one. Anything that asks "how much do we hold?" has to sum them.
 */
/**
 * The open deals that an order of this side would be closing.
 *
 * A SELL closes longs, a BUY closes shorts. Capital.com opens a separate deal
 * per order, so there can be several — each is closed by its own id, which is
 * the only way to actually close anything (see closeCapitalPosition).
 */
export function dealsToClose(
  positions: NormalizedPosition[],
  ticker: string,
  side: "BUY" | "SELL"
): NormalizedPosition[] {
  const closes = side === "SELL" ? "BUY" : "SELL";
  return positions.filter((p) => p.ticker === ticker && p.direction === closes);
}

export function heldByTicker(positions: NormalizedPosition[]): HeldPositions {
  const held: HeldPositions = new Map();
  for (const p of positions) {
    const h = held.get(p.ticker) ?? { long: 0, short: 0 };
    if (p.direction === "BUY") h.long += p.quantity;
    else h.short += p.quantity;
    held.set(p.ticker, h);
  }
  return held;
}

/**
 * What an order would actually do, and how big it has to be.
 *
 * An order against a position we already hold in the OPPOSITE direction is a
 * close, and a close must be sized from the position — never from the balance.
 * Sizing it from `balance × riskPerTradePercent` (what every order used to get)
 * is harmless only while the two happen to agree. They stop agreeing the moment
 * the balance moves or the user raises their risk setting: a £20 long opened at
 * 1% risk, "closed" after switching to 10%, sends a £200 sell. The £180 extra
 * becomes a short nobody asked for. In live data the gap was already visible at
 * 1%: a SELL of 1.177 units against a 1.165-unit holding.
 *
 * So a close takes exactly the held quantity, which also means it can never
 * overshoot into the opposite side. Anything else — a new position, or adding
 * to one in the same direction — increases exposure and is sized as before.
 */
export function planOrder(
  side: "BUY" | "SELL",
  ticker: string,
  held: HeldPositions,
  currentPrice: number,
  cfg: BotConfig,
  accountBalance: number | null
): { closing: boolean; quantity: number; positionValue: number } {
  const h = held.get(ticker);
  const opposite = side === "SELL" ? (h?.long ?? 0) : (h?.short ?? 0);
  if (opposite > 0) {
    return { closing: true, quantity: opposite, positionValue: opposite * currentPrice };
  }
  const { quantity, positionValue } = sizePosition(currentPrice, cfg, accountBalance);
  return { closing: false, quantity, positionValue };
}

/**
 * Places (or simulates, when dryRun) a single order and records the trade row,
 * carrying any AI reasoning/confidence. Returns whether a trade was executed
 * (true for dry-run + filled, false for broker rejection).
 */
async function placeAndRecord(args: {
  userId: number;
  credentials: UserBrokerCredentials;
  ticker: string;
  side: "BUY" | "SELL";
  quantity: number;
  positionValue: number;
  currentPrice: number;
  cfg: BotConfig;
  dryRun: boolean;
  aiReason?: string;
  aiConfidence?: string;
  /** True when this order is closing an existing position (e.g. flatten-by-close)
   * rather than opening/adding to one — a closing order never carries a new
   * stop-loss/take-profit, since there's no resulting position left to protect. */
  isClose?: boolean;
  /**
   * The open deals this close is closing, when they are known.
   *
   * Supplied, each is closed by its own id. Absent — or from a broker with no
   * per-deal id — the old opposite-order path runs, which is correct only where
   * positions net (Trading 212) and was catastrophic where they do not.
   */
  closeDeals?: NormalizedPosition[];
}): Promise<boolean> {
  const { userId, credentials, ticker, side, quantity, positionValue, currentPrice, cfg, dryRun, aiReason, aiConfidence, isClose, closeDeals } = args;
  const { stopLossPercent, takeProfitPercent } = cfg;

  // Last line of defence, covering every caller including future ones: an order
  // for nothing is never valid. Reached when equity is zero (sizing returns 0)
  // or a price is absurd. Refused here rather than sent for the broker to
  // reject, and not written as a dry-run row — a DRY_RUN row for a zero-size
  // order would be noise in the very log the forward test is meant to produce.
  if (!Number.isFinite(quantity) || quantity <= 0) {
    logger.warn({ userId, ticker, side, quantity, positionValue }, "Order refused — non-positive quantity");
    return false;
  }

  if (dryRun) {
    logger.info({ userId, ticker, side, broker: credentials.broker, dryRun: true }, "Dry-run signal");
    await db.insert(tradesTable).values({
      userId,
      ticker,
      side,
      quantity: String(quantity),
      price: String(currentPrice),
      total: String(positionValue),
      status: "DRY_RUN",
      aiReason: aiReason ?? null,
      aiConfidence: aiConfidence ?? null,
    });
    return true;
  }

  // Closing by deal id. This is the path that actually closes a position; the
  // opposite-order path below leaves the original open on a hedging account and
  // adds a second position facing the other way, which is how GOLD came to be
  // sold four times against a long it had bought once on 24 Sep 2026.
  if (isClose && closeDeals && closeDeals.length > 0 && closeDeals.every((d) => d.dealId)) {
    let closedAny = false;
    for (const deal of closeDeals) {
      try {
        await closeBrokerPosition(userId, credentials, deal.dealId!);
        await db.insert(tradesTable).values({
          userId,
          ticker,
          side,
          quantity: String(deal.quantity),
          price: String(currentPrice),
          total: String(deal.quantity * currentPrice),
          status: "FILLED",
          orderId: deal.dealId,
          aiReason: aiReason ?? null,
          aiConfidence: aiConfidence ?? null,
        });
        closedAny = true;
        logger.info({ userId, ticker, side, dealId: deal.dealId }, "Position closed by deal id");
      } catch (err) {
        // Recorded per deal: closing three and failing on the second must leave
        // a truthful record of which two closed.
        const msg = err instanceof Error ? err.message : String(err);
        await db.insert(tradesTable).values({
          userId,
          ticker,
          side,
          quantity: String(deal.quantity),
          price: String(currentPrice),
          total: String(deal.quantity * currentPrice),
          status: "FAILED",
          // errorMessage, not aiReason: every other failure in this file records
          // the broker's words here, and a failed close that hid them somewhere
          // else would be invisible to anyone looking for why a trade failed.
          errorMessage: msg,
          aiReason: aiReason ?? null,
          aiConfidence: aiConfidence ?? null,
        });
        logger.error({ userId, ticker, dealId: deal.dealId, err: msg }, "Could not close position by deal id");
      }
    }
    return closedAny;
  }

  try {
    const order = await placeBrokerOrder(
      userId,
      credentials,
      ticker,
      quantity,
      side,
      !isClose && stopLossPercent > 0 ? { stopLossPercent, entryPrice: currentPrice } : undefined,
      !isClose && takeProfitPercent > 0 ? { takeProfitPercent, entryPrice: currentPrice } : undefined
    );
    await db.insert(tradesTable).values({
      userId,
      ticker,
      side,
      quantity: String(quantity),
      price: String(currentPrice),
      total: String(positionValue),
      status: "FILLED",
      orderId: order.id,
      aiReason: aiReason ?? null,
      aiConfidence: aiConfidence ?? null,
    });
    logger.info({ userId, ticker, side, broker: credentials.broker, orderId: order.id }, "Trade executed");
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.insert(tradesTable).values({
      userId,
      ticker,
      side,
      quantity: String(quantity),
      price: String(currentPrice),
      total: String(positionValue),
      status: "FAILED",
      errorMessage: msg,
      aiReason: aiReason ?? null,
      aiConfidence: aiConfidence ?? null,
    });
    logger.error({ userId, ticker, side, broker: credentials.broker, err: msg }, "Trade failed");
    return false;
  }
}

/** Upstream/infrastructure failure (price fetch, broker unreachable) → 502. */
export class TradeExecutionError extends Error {}
/** Invalid business input (empty ticker, non-positive amount) → 400. */
export class TradeValidationError extends Error {}
/** A matching trade is already being placed → 429, prevents accidental double orders. */
export class DuplicateTradeError extends Error {}

export interface ManualTradeParams {
  ticker: string;
  side: "BUY" | "SELL";
  amount: number;
}

// In-flight guard: blocks concurrent duplicate submissions of the same
// user+ticker+side while an order is being placed (e.g. double-clicks / retries).
const inFlightTrades = new Set<string>();

/**
 * Execute a one-off manual trade through the broker connected for this user.
 * Mirrors runCycle's order + recording logic and respects the same Dry Run and
 * stop-loss settings, so manual and bot execution behave identically.
 * Returns the persisted trade row.
 */
export async function executeManualTrade(userId: number, params: ManualTradeParams) {
  const ticker = params.ticker.trim();
  const { side, amount } = params;

  if (!ticker) {
    throw new TradeValidationError("Ticker is required");
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new TradeValidationError("Trade amount must be a positive number");
  }

  const credentials = await getUserBrokerCredentials(userId);
  if (!credentials) {
    throw new BrokerNotConnectedError("Connect a broker account before placing trades");
  }

  const state = await getOrCreateBotState(userId);
  const { stopLossPercent, barResolution } = state.config;

  // Same paywall boundary as runCycle: a manual trade is still a real order,
  // so a plan without live trading is forced to simulate it.
  const limits = await getPlanLimits(userId);
  const dryRun = state.config.dryRun || !limits.liveTrading;
  if (state.config.dryRun === false && !limits.liveTrading) {
    logger.warn({ userId, ticker, side }, "Plan does not include live trading — manual trade forced to dry-run");
  }

  const lockKey = `${userId}:${credentials.broker}:${ticker}:${side}`;
  if (inFlightTrades.has(lockKey)) {
    throw new DuplicateTradeError(`A ${side} order for ${ticker} is already being placed`);
  }
  inFlightTrades.add(lockKey);

  try {
    return await placeManualTrade({ userId, credentials, ticker, side, amount, dryRun, stopLossPercent, barResolution });
  } finally {
    inFlightTrades.delete(lockKey);
  }
}

async function placeManualTrade(args: {
  userId: number;
  credentials: UserBrokerCredentials;
  ticker: string;
  side: "BUY" | "SELL";
  amount: number;
  dryRun: boolean;
  stopLossPercent: number;
  barResolution: BotConfig["barResolution"];
}) {
  const { userId, credentials, ticker, side, amount, dryRun, stopLossPercent, barResolution } = args;

  const prices = await getBrokerPriceHistory(userId, credentials, ticker, 5, barResolution);
  const currentPrice = prices[prices.length - 1];
  if (!currentPrice || !(currentPrice > 0)) {
    throw new TradeExecutionError(`Could not fetch a current price for ${ticker} from ${credentials.broker}`);
  }

  const positionValue = amount;
  const quantity = positionValue / currentPrice;

  if (dryRun) {
    logger.info({ userId, ticker, side, broker: credentials.broker, dryRun: true }, "Manual dry-run trade");
    const [row] = await db
      .insert(tradesTable)
      .values({
        userId,
        ticker,
        side,
        quantity: String(quantity),
        price: String(currentPrice),
        total: String(positionValue),
        status: "DRY_RUN",
      })
      .returning();
    return row;
  }

  try {
    const order = await placeBrokerOrder(
      userId,
      credentials,
      ticker,
      quantity,
      side,
      stopLossPercent > 0 ? { stopLossPercent, entryPrice: currentPrice } : undefined
    );
    const [row] = await db
      .insert(tradesTable)
      .values({
        userId,
        ticker,
        side,
        quantity: String(quantity),
        price: String(currentPrice),
        total: String(positionValue),
        status: "FILLED",
        orderId: order.id,
      })
      .returning();
    logger.info({ userId, ticker, side, broker: credentials.broker, orderId: order.id }, "Manual trade executed");
    return row;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const [row] = await db
      .insert(tradesTable)
      .values({
        userId,
        ticker,
        side,
        quantity: String(quantity),
        price: String(currentPrice),
        total: String(positionValue),
        status: "FAILED",
        errorMessage: msg,
      })
      .returning();
    logger.error({ userId, ticker, side, broker: credentials.broker, err: msg }, "Manual trade failed");
    return row;
  }
}
