import { db, instrumentsTable, tradesTable, signalsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import {
  placeBrokerOrder,
  getBrokerPriceHistory,
  getBrokerAccount,
  getBrokerPositions,
  type BrokerName,
} from "./broker";
import { computeMASignal } from "./maStrategy";
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
  broker: BrokerName;
  stopLossPercent: number;
  takeProfitPercent: number;
  riskPerTradePercent: number;
  maxPositionSizePercent: number;
  maxDailyLossPercent: number;
  maxConcurrentPositions: number;
  aiTradeMode: AiTradeMode;
}

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

const state: BotState = {
  running: false,
  lastRunAt: null,
  nextRunAt: null,
  config: {
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
  },
  circuitBreaker: {
    tripped: false,
    reason: null,
    trippedAt: null,
    dayKey: null,
    dayStartEquity: null,
  },
  intervalHandle: null,
};

/** UTC calendar-day key (YYYY-MM-DD) used to reset the daily-loss baseline. */
function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function getBotStatus() {
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
 * Clears a tripped daily-loss circuit breaker and restarts the bot. This is the
 * ONLY way to resume after the breaker trips — the engine never auto-resumes.
 * Resets the loss baseline so the breaker measures from the resume point onward.
 */
export function resumeBot() {
  state.circuitBreaker.tripped = false;
  state.circuitBreaker.reason = null;
  state.circuitBreaker.trippedAt = null;
  state.circuitBreaker.dayKey = null;
  state.circuitBreaker.dayStartEquity = null;
  logger.info("Circuit breaker cleared — resuming bot");
  return startBot();
}

export function updateConfig(patch: Partial<BotConfig>) {
  Object.assign(state.config, patch);

  if (state.running) {
    stopBot();
    startBot();
  }

  return getBotStatus();
}

export function startBot() {
  if (state.running) return getBotStatus();

  state.running = true;
  runCycle();

  const ms = state.config.intervalMinutes * 60 * 1000;
  state.intervalHandle = setInterval(() => runCycle(), ms);
  state.nextRunAt = new Date(Date.now() + ms);

  logger.info({ config: state.config }, "Bot started");
  return getBotStatus();
}

export function stopBot() {
  if (state.intervalHandle) {
    clearInterval(state.intervalHandle);
    state.intervalHandle = null;
  }
  state.running = false;
  state.nextRunAt = null;
  logger.info("Bot stopped");
  return getBotStatus();
}

export async function runCycle(): Promise<Array<{ ticker: string; signal: string; tradeExecuted: boolean }>> {
  state.lastRunAt = new Date();
  if (state.running) {
    const ms = state.config.intervalMinutes * 60 * 1000;
    state.nextRunAt = new Date(Date.now() + ms);
  }

  const instruments = await db
    .select()
    .from(instrumentsTable)
    .where(eq(instrumentsTable.enabled, true));

  const results: Array<{ ticker: string; signal: string; tradeExecuted: boolean }> = [];
  const cfg = state.config;
  const { broker, shortPeriod, longPeriod, aiTradeMode } = cfg;

  // Safety gate: real orders are only ever placed while the bot is actually
  // running (scheduled). A manual trigger (e.g. POST /signals/run) while the
  // bot is Stopped is forced to simulate, so it can never move real money.
  const dryRun = cfg.dryRun || !state.running;
  if (cfg.dryRun === false && !state.running) {
    logger.warn("Bot is stopped — forcing dry-run for this manual cycle (no real orders)");
  }

  // Fetch account once per cycle — used for position sizing and (in AI modes) context.
  let account: AccountSnapshot | null = null;
  try {
    const a = await getBrokerAccount(broker);
    account = { cash: a.cash, total: a.total, currency: a.currency };
  } catch (err) {
    logger.warn({ broker, err }, "Could not fetch account balance — falling back to fixed tradeAmount");
  }
  const accountBalance = account?.total ?? null;

  // Daily-loss circuit breaker. Runs before any trading logic so a tripped
  // breaker halts the cycle entirely. Baseline is the first equity observed each
  // UTC day; once the loss from that baseline hits maxDailyLossPercent the bot is
  // stopped and will not trade again until manually resumed (no auto-resume).
  if (state.circuitBreaker.tripped) {
    logger.warn({ reason: state.circuitBreaker.reason }, "Circuit breaker tripped — skipping trading cycle");
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
          { lossPct, limit: cfg.maxDailyLossPercent, dayStartEquity: cb.dayStartEquity, total: account.total },
          "Daily-loss circuit breaker TRIPPED — stopping bot"
        );
        stopBot();
        return results;
      }
    }
  }

  // Open positions: fetched every cycle. Used to enforce maxConcurrentPositions
  // for all modes, and to give Claude exposure context in AI modes.
  let positions: PositionSnapshot[] = [];
  let positionsFetchOk = true;
  try {
    positions = (await getBrokerPositions(broker)).map((p) => ({
      ticker: p.ticker,
      quantity: p.quantity,
      averagePrice: p.averagePrice,
      currentPrice: p.currentPrice,
      pnlPercent: p.pnlPercent,
    }));
  } catch (err) {
    positionsFetchOk = false;
    logger.warn({ broker, err }, "Could not fetch open positions");
  }

  // Fail-closed: if we can't read the data a limit depends on, block NEW entries
  // this cycle rather than trade blind. The per-position size cap and the
  // daily-loss breaker both need account equity; the concurrent-position cap
  // needs the live positions list. Closing trades (SELL) are always allowed
  // since they only reduce exposure.
  const riskDataUnavailable =
    (account === null && (cfg.maxPositionSizePercent > 0 || cfg.maxDailyLossPercent > 0)) ||
    (!positionsFetchOk && cfg.maxConcurrentPositions > 0);
  if (riskDataUnavailable) {
    logger.warn(
      { accountAvailable: account !== null, positionsFetchOk },
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
  }
  const contexts: InstrumentContext[] = [];
  for (const instrument of instruments) {
    try {
      const prices = await getBrokerPriceHistory(broker, instrument.ticker, longPeriod + 5);
      if (prices.length < longPeriod + 1) {
        logger.warn({ ticker: instrument.ticker, broker }, "Not enough price data for MA computation");
        continue;
      }
      const currentPrice = prices[prices.length - 1];
      const maResult = computeMASignal(prices, shortPeriod, longPeriod);
      if (!maResult) continue;
      contexts.push({
        ticker: instrument.ticker,
        currentPrice,
        signal: maResult.signal,
        shortMa: maResult.shortMa,
        longMa: maResult.longMa,
      });
    } catch (err) {
      logger.error({ ticker: instrument.ticker, broker, err }, "Error processing instrument");
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
      logger.error({ err }, "AI decision engine failed — holding all instruments this cycle");
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
        const isNewPosition = !liveTickers.has(c.ticker);
        const atPositionLimit =
          cfg.maxConcurrentPositions > 0 &&
          isNewPosition &&
          liveTickers.size >= cfg.maxConcurrentPositions;
        if (isBuy && riskDataUnavailable) {
          aiReason = `Skipped: risk data was unavailable this cycle, so no new position was opened for safety. ${decision.reason}`;
          logger.warn({ ticker: c.ticker }, "Autonomous BUY skipped — risk data unavailable (fail-safe)");
        } else if (isBuy && atPositionLimit) {
          aiReason = `Skipped: already at the ${cfg.maxConcurrentPositions}-position limit. ${decision.reason}`;
          logger.warn(
            { ticker: c.ticker, openPositions: liveTickers.size, limit: cfg.maxConcurrentPositions },
            "Autonomous BUY skipped — max concurrent positions reached"
          );
        } else if (isBuy && cashBudget !== null && deployedThisCycle + positionValue > cashBudget) {
          aiReason = `Skipped: would exceed the account's available cash budget for this cycle. ${decision.reason}`;
          logger.warn(
            { ticker: c.ticker, positionValue, deployedThisCycle, cashBudget },
            "Autonomous BUY skipped — per-cycle cash budget exceeded"
          );
        } else {
          tradeExecuted = await placeAndRecord({
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
          if (tradeExecuted && isBuy) {
            deployedThisCycle += positionValue;
            liveTickers.add(c.ticker);
          }
        }
      }
      await db.insert(signalsTable).values({
        ticker: c.ticker,
        signal: decision.action,
        shortMa: String(c.shortMa),
        longMa: String(c.longMa),
        price: String(c.currentPrice),
        tradeExecuted,
        aiReason,
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
            logger.info({ ticker, signal, reason: review.reason }, "AI vetoed signal");
          }
        } catch (err) {
          logger.error({ ticker, signal, err }, "AI safety check failed — skipping trade for safety");
          aiReason = "AI safety check failed to respond, so the trade was skipped.";
          proceed = false;
        }
      }

      if (proceed) {
        const { positionValue, quantity } = sizePosition(currentPrice, cfg, accountBalance);
        const isBuy = signal === "BUY";
        const isNewPosition = !liveTickers.has(ticker);
        const atPositionLimit =
          cfg.maxConcurrentPositions > 0 &&
          isNewPosition &&
          liveTickers.size >= cfg.maxConcurrentPositions;
        if (isBuy && riskDataUnavailable) {
          aiReason = "Trade skipped: risk data was unavailable this cycle, so no new position was opened for safety.";
          logger.warn({ ticker }, "BUY skipped — risk data unavailable (fail-safe)");
        } else if (isBuy && atPositionLimit) {
          aiReason = `Trade skipped: already at the ${cfg.maxConcurrentPositions}-position limit.`;
          logger.warn(
            { ticker, openPositions: liveTickers.size, limit: cfg.maxConcurrentPositions },
            "BUY skipped — max concurrent positions reached"
          );
        } else if (isBuy && cashBudget !== null && deployedThisCycle + positionValue > cashBudget) {
          aiReason = "Trade skipped: it would exceed the account's available cash budget for this cycle.";
          logger.warn(
            { ticker, positionValue, deployedThisCycle, cashBudget },
            "BUY skipped — per-cycle cash budget exceeded"
          );
        } else {
          logger.info({ ticker, signal, positionValue, quantity }, "Signal detected");
          tradeExecuted = await placeAndRecord({
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
          if (tradeExecuted && isBuy) {
            deployedThisCycle += positionValue;
            liveTickers.add(ticker);
          }
        }
      }
    }

    await db.insert(signalsTable).values({
      ticker,
      signal,
      shortMa: String(shortMa),
      longMa: String(longMa),
      price: String(currentPrice),
      tradeExecuted,
      aiReason,
    });
    results.push({ ticker, signal, tradeExecuted });
  }

  return results;
}

/** Position sizing: % of account balance if configured, else fixed amount. */
function sizePosition(
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
  ticker: string;
  side: "BUY" | "SELL";
  quantity: number;
  positionValue: number;
  currentPrice: number;
  cfg: BotConfig;
  dryRun: boolean;
  aiReason?: string;
  aiConfidence?: string;
}): Promise<boolean> {
  const { ticker, side, quantity, positionValue, currentPrice, cfg, dryRun, aiReason, aiConfidence } = args;
  const { broker, stopLossPercent, takeProfitPercent } = cfg;

  if (dryRun) {
    logger.info({ ticker, side, broker, dryRun: true }, "Dry-run signal");
    await db.insert(tradesTable).values({
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
      broker,
      ticker,
      quantity,
      side,
      stopLossPercent > 0 ? { stopLossPercent, entryPrice: currentPrice } : undefined,
      takeProfitPercent > 0 ? { takeProfitPercent, entryPrice: currentPrice } : undefined
    );
    await db.insert(tradesTable).values({
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
    logger.info({ ticker, side, broker, orderId: order.id }, "Trade executed");
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.insert(tradesTable).values({
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
    logger.error({ ticker, side, broker, err: msg }, "Trade failed");
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
// ticker+side while an order is being placed (e.g. double-clicks / retries).
const inFlightTrades = new Set<string>();

/**
 * Execute a one-off manual trade through the broker selected in the bot config.
 * Mirrors runCycle's order + recording logic and respects the same Dry Run and
 * stop-loss settings, so manual and bot execution behave identically.
 * Returns the persisted trade row.
 */
export async function executeManualTrade(params: ManualTradeParams) {
  const ticker = params.ticker.trim();
  const { side, amount } = params;
  const { broker, dryRun, stopLossPercent } = state.config;

  if (!ticker) {
    throw new TradeValidationError("Ticker is required");
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new TradeValidationError("Trade amount must be a positive number");
  }

  const lockKey = `${broker}:${ticker}:${side}`;
  if (inFlightTrades.has(lockKey)) {
    throw new DuplicateTradeError(`A ${side} order for ${ticker} is already being placed`);
  }
  inFlightTrades.add(lockKey);

  try {
    return await placeManualTrade({ ticker, side, amount, broker, dryRun, stopLossPercent });
  } finally {
    inFlightTrades.delete(lockKey);
  }
}

async function placeManualTrade(args: {
  ticker: string;
  side: "BUY" | "SELL";
  amount: number;
  broker: BrokerName;
  dryRun: boolean;
  stopLossPercent: number;
}) {
  const { ticker, side, amount, broker, dryRun, stopLossPercent } = args;

  const prices = await getBrokerPriceHistory(broker, ticker, 5);
  const currentPrice = prices[prices.length - 1];
  if (!currentPrice || !(currentPrice > 0)) {
    throw new TradeExecutionError(`Could not fetch a current price for ${ticker} from ${broker}`);
  }

  const positionValue = amount;
  const quantity = positionValue / currentPrice;

  if (dryRun) {
    logger.info({ ticker, side, broker, dryRun: true }, "Manual dry-run trade");
    const [row] = await db
      .insert(tradesTable)
      .values({
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
      broker,
      ticker,
      quantity,
      side,
      stopLossPercent > 0 ? { stopLossPercent, entryPrice: currentPrice } : undefined
    );
    const [row] = await db
      .insert(tradesTable)
      .values({
        ticker,
        side,
        quantity: String(quantity),
        price: String(currentPrice),
        total: String(positionValue),
        status: "FILLED",
        orderId: order.id,
      })
      .returning();
    logger.info({ ticker, side, broker, orderId: order.id }, "Manual trade executed");
    return row;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const [row] = await db
      .insert(tradesTable)
      .values({
        ticker,
        side,
        quantity: String(quantity),
        price: String(currentPrice),
        total: String(positionValue),
        status: "FAILED",
        errorMessage: msg,
      })
      .returning();
    logger.error({ ticker, side, broker, err: msg }, "Manual trade failed");
    return row;
  }
}
