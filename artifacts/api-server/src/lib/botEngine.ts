import { db, instrumentsTable, tradesTable, signalsTable, botConfigTable, type BotConfigRow } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "./logger";
import {
  placeBrokerOrder,
  getBrokerPriceHistory,
  getBrokerAccount,
  getBrokerPositions,
  getBrokerQuote,
  type NormalizedPosition,
} from "./broker";
import { getUserBrokerCredentials, type UserBrokerCredentials } from "./brokerCredentialsService";
import {
  routeStrategy,
  requiredBars,
  type StrategyName,
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
  regimeFilterEnabled: true,
  barResolution: "MINUTE_5",
};

/**
 * Daily-loss circuit breaker state. When `tripped`, the engine is stopped and
 * refuses to trade until a human explicitly resumes it (no auto-resume).
 * `dayKey` is the UTC calendar day the baseline was captured for; `dayStartEquity`
 * is the account total equity at the start of that day, used as the loss baseline.
 */
interface CircuitBreakerState {
  tripped: boolean;
  reason: string | null;
  trippedAt: Date | null;
  dayKey: string | null;
  dayStartEquity: number | null;
}

interface BotState {
  running: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  config: BotConfig;
  circuitBreaker: CircuitBreakerState;
  intervalHandle: ReturnType<typeof setInterval> | null;
}

function freshCircuitBreaker(): CircuitBreakerState {
  return { tripped: false, reason: null, trippedAt: null, dayKey: null, dayStartEquity: null };
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
 * Returns (creating if needed) a user's in-memory bot state. On first access
 * this cycle, loads persisted config from `bot_config` so settings survive a
 * server restart — falls back to defaults (and persists them) if the user has
 * never configured anything yet.
 */
async function getOrCreateBotState(userId: number): Promise<BotState> {
  const existing = botStates.get(userId);
  if (existing) return existing;

  const [row] = await db.select().from(botConfigTable).where(eq(botConfigTable.userId, userId));
  const config = row ? rowToConfig(row) : { ...DEFAULT_CONFIG };
  if (!row) await persistConfig(userId, config);

  const state: BotState = {
    running: false,
    lastRunAt: null,
    nextRunAt: null,
    config,
    circuitBreaker: freshCircuitBreaker(),
    intervalHandle: null,
  };
  botStates.set(userId, state);
  return state;
}

/** UTC calendar-day key (YYYY-MM-DD) used to reset the daily-loss baseline. */
function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * True when a NEW position should be blocked because the market is known to
 * be closed for this instrument right now. Only ever gates opening exposure —
 * callers must never use this to block a SELL that closes/reduces an existing
 * position. Fails open (returns false, i.e. "allow the trade") on a
 * quote-fetch error — this is a safety filter layered on top of the existing
 * risk gates, not itself a risk control, so a transient lookup failure should
 * not block trading entirely.
 */
async function isMarketClosedForEntry(
  userId: number,
  credentials: UserBrokerCredentials,
  ticker: string
): Promise<boolean> {
  try {
    const quote = await getBrokerQuote(userId, credentials, ticker);
    return quote.marketStatus !== null && quote.marketStatus !== "TRADEABLE";
  } catch (err) {
    logger.warn({ userId, ticker, err }, "Could not check market status — allowing trade (fail-open)");
    return false;
  }
}

/**
 * True when an OPEN position's instrument market is confirmed closed and the
 * position should be force-flattened this cycle. Deliberately the OPPOSITE
 * fail direction from isMarketClosedForEntry: on a quote-fetch error this
 * returns false ("leave it open, retry next cycle") rather than true, because
 * forcing a close based on incomplete information is a worse mistake than
 * delaying a confirmed one by one cycle — an unforced exit at a bad moment is
 * irreversible within the cycle, unlike a skipped entry which just waits for
 * the next signal. Same underlying quote check as isMarketClosedForEntry, but
 * kept as a separate named function (not a shared parameterized helper) since
 * the two gates' intent genuinely differs even though today's return values
 * happen to coincide.
 */
async function isMarketClosedForFlatten(
  userId: number,
  credentials: UserBrokerCredentials,
  ticker: string
): Promise<boolean> {
  try {
    const quote = await getBrokerQuote(userId, credentials, ticker);
    return quote.marketStatus !== null && quote.marketStatus !== "TRADEABLE";
  } catch (err) {
    logger.warn({ userId, ticker, err }, "Could not check market status for flatten-by-close — leaving position open (fail-closed)");
    return false;
  }
}

export class BrokerNotConnectedError extends Error {}

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
 * Clears a tripped daily-loss circuit breaker and restarts the bot. This is the
 * ONLY way to resume after the breaker trips — the engine never auto-resumes.
 * Resets the loss baseline so the breaker measures from the resume point onward.
 */
export async function resumeBot(userId: number) {
  const state = await getOrCreateBotState(userId);
  state.circuitBreaker = freshCircuitBreaker();
  logger.info({ userId }, "Circuit breaker cleared — resuming bot");
  return startBot(userId);
}

export async function updateConfig(userId: number, patch: Partial<BotConfig>) {
  const state = await getOrCreateBotState(userId);
  Object.assign(state.config, patch);
  await persistConfig(userId, state.config);

  if (state.running) {
    stopBot(userId);
    await startBot(userId);
  }

  return getBotStatus(userId);
}

export async function startBot(userId: number) {
  const state = await getOrCreateBotState(userId);
  if (state.running) return getBotStatus(userId);

  const credentials = await getUserBrokerCredentials(userId);
  if (!credentials) {
    throw new BrokerNotConnectedError("Connect a broker account before starting the bot");
  }

  state.running = true;
  void runCycle(userId);

  const ms = state.config.intervalMinutes * 60 * 1000;
  state.intervalHandle = setInterval(() => void runCycle(userId), ms);
  state.nextRunAt = new Date(Date.now() + ms);

  logger.info({ userId, config: state.config }, "Bot started");
  return getBotStatus(userId);
}

export function stopBot(userId: number) {
  const state = botStates.get(userId);
  if (!state) return;
  if (state.intervalHandle) {
    clearInterval(state.intervalHandle);
    state.intervalHandle = null;
  }
  state.running = false;
  state.nextRunAt = null;
  logger.info({ userId }, "Bot stopped");
}

export async function stopBotAndGetStatus(userId: number) {
  stopBot(userId);
  return getBotStatus(userId);
}

export async function runCycle(userId: number): Promise<Array<{ ticker: string; signal: string; tradeExecuted: boolean }>> {
  const results: Array<{ ticker: string; signal: string; tradeExecuted: boolean }> = [];

  const credentials = await getUserBrokerCredentials(userId);
  if (!credentials) {
    logger.warn({ userId }, "No broker connected — skipping trading cycle");
    return results;
  }

  const state = await getOrCreateBotState(userId);
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
  const { shortPeriod, longPeriod, aiTradeMode } = cfg;

  // Safety gate: real orders are only ever placed while the bot is actually
  // running (scheduled). A manual trigger (e.g. POST /signals/run) while the
  // bot is Stopped is forced to simulate, so it can never move real money.
  const dryRun = cfg.dryRun || !state.running;
  if (cfg.dryRun === false && !state.running) {
    logger.warn({ userId }, "Bot is stopped — forcing dry-run for this manual cycle (no real orders)");
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
    const todayKey = utcDayKey(new Date());
    if (cb.dayKey !== todayKey || cb.dayStartEquity === null) {
      cb.dayKey = todayKey;
      cb.dayStartEquity = account.total;
    } else if (cfg.maxDailyLossPercent > 0 && cb.dayStartEquity > 0) {
      const lossPct = ((cb.dayStartEquity - account.total) / cb.dayStartEquity) * 100;
      if (lossPct >= cfg.maxDailyLossPercent) {
        cb.tripped = true;
        cb.trippedAt = new Date();
        cb.reason = `Daily loss of ${lossPct.toFixed(2)}% reached the ${cfg.maxDailyLossPercent}% limit. Trading is halted until you resume it.`;
        logger.error(
          { userId, lossPct, limit: cfg.maxDailyLossPercent, dayStartEquity: cb.dayStartEquity, total: account.total },
          "Daily-loss circuit breaker TRIPPED — stopping bot"
        );
        stopBot(userId);
        return results;
      }
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
    (account === null && (cfg.maxPositionSizePercent > 0 || cfg.maxDailyLossPercent > 0)) ||
    (!positionsFetchOk && cfg.maxConcurrentPositions > 0);
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
    regime: Regime;
  }
  const bars = requiredBars(longPeriod);
  const contexts: InstrumentContext[] = [];
  for (const instrument of instruments) {
    try {
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
      if (decision.action !== "HOLD") {
        const { positionValue, quantity } = sizePosition(c.currentPrice, cfg, accountBalance);
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
        const marketClosed = opensNewPosition && (await isMarketClosedForEntry(userId, credentials, c.ticker));
        if ((opensNewPosition || isBuy) && riskDataUnavailable) {
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
        } else if (isBuy && cashBudget !== null && deployedThisCycle + positionValue > cashBudget) {
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
          });
          if (tradeExecuted) {
            if (isBuy) deployedThisCycle += positionValue;
            if (opensNewPosition) liveTickers.add(c.ticker);
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
    const { ticker, signal, shortMa, longMa, currentPrice } = c;
    let tradeExecuted = false;
    let aiReason: string | null = null;

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
          }
        } catch (err) {
          logger.error({ userId, ticker, signal, err }, "AI safety check failed — skipping trade for safety");
          aiReason = "AI safety check failed to respond, so the trade was skipped.";
          proceed = false;
        }
      }

      if (proceed) {
        const { positionValue, quantity } = sizePosition(currentPrice, cfg, accountBalance);
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
        const marketClosed = opensNewPosition && (await isMarketClosedForEntry(userId, credentials, ticker));
        if ((opensNewPosition || isBuy) && riskDataUnavailable) {
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
        } else if (isBuy && cashBudget !== null && deployedThisCycle + positionValue > cashBudget) {
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
          });
          if (tradeExecuted) {
            if (isBuy) deployedThisCycle += positionValue;
            if (opensNewPosition) liveTickers.add(ticker);
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
}): Promise<boolean> {
  const { userId, credentials, ticker, side, quantity, positionValue, currentPrice, cfg, dryRun, aiReason, aiConfidence, isClose } = args;
  const { stopLossPercent, takeProfitPercent } = cfg;

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
  const { dryRun, stopLossPercent, barResolution } = state.config;

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
