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
  riskPerTradePercent: number;
  aiTradeMode: AiTradeMode;
}

interface BotState {
  running: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  config: BotConfig;
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
    riskPerTradePercent: 1,
    aiTradeMode: "off",
  },
  intervalHandle: null,
};

export function getBotStatus() {
  return {
    running: state.running,
    lastRunAt: state.lastRunAt?.toISOString() ?? null,
    nextRunAt: state.nextRunAt?.toISOString() ?? null,
    config: state.config,
  };
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

  // Open positions provide Claude with exposure context (AI modes only).
  let positions: PositionSnapshot[] = [];
  if (aiTradeMode !== "off") {
    try {
      positions = (await getBrokerPositions(broker)).map((p) => ({
        ticker: p.ticker,
        quantity: p.quantity,
        averagePrice: p.averagePrice,
        currentPrice: p.currentPrice,
        pnlPercent: p.pnlPercent,
      }));
    } catch (err) {
      logger.warn({ broker, err }, "Could not fetch open positions for AI context");
    }
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
        if (isBuy && cashBudget !== null && deployedThisCycle + positionValue > cashBudget) {
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
          if (tradeExecuted && isBuy) deployedThisCycle += positionValue;
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
        if (isBuy && cashBudget !== null && deployedThisCycle + positionValue > cashBudget) {
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
          if (tradeExecuted && isBuy) deployedThisCycle += positionValue;
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
  const positionValue =
    cfg.riskPerTradePercent > 0 && accountBalance !== null
      ? accountBalance * (cfg.riskPerTradePercent / 100)
      : cfg.tradeAmount;
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
  const { broker, stopLossPercent } = cfg;

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
      stopLossPercent > 0 ? { stopLossPercent, entryPrice: currentPrice } : undefined
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
