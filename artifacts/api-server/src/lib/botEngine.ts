import { db, instrumentsTable, tradesTable, signalsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { placeBrokerOrder, getBrokerPriceHistory, getBrokerAccount, type BrokerName } from "./broker";
import { computeMASignal } from "./maStrategy";

export interface BotConfig {
  shortPeriod: number;
  longPeriod: number;
  tradeAmount: number;
  intervalMinutes: number;
  dryRun: boolean;
  broker: BrokerName;
  stopLossPercent: number;
  riskPerTradePercent: number;
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
  const { broker, shortPeriod, longPeriod, tradeAmount, dryRun, stopLossPercent, riskPerTradePercent } = state.config;

  // Fetch account balance once per cycle for position sizing
  let accountBalance: number | null = null;
  if (riskPerTradePercent > 0) {
    try {
      const account = await getBrokerAccount(broker);
      accountBalance = account.total;
    } catch (err) {
      logger.warn({ broker, err }, "Could not fetch account balance for position sizing — falling back to fixed tradeAmount");
    }
  }

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

      const { signal, shortMa, longMa } = maResult;
      let tradeExecuted = false;

      if (signal !== "HOLD") {
        // Position sizing: % of account balance or fixed amount
        const positionValue =
          riskPerTradePercent > 0 && accountBalance !== null
            ? accountBalance * (riskPerTradePercent / 100)
            : tradeAmount;
        const quantity = positionValue / currentPrice;

        logger.info(
          { ticker: instrument.ticker, signal, positionValue, quantity, stopLossPercent, riskPerTradePercent },
          "Signal detected"
        );

        if (dryRun) {
          logger.info({ ticker: instrument.ticker, signal, broker, dryRun: true }, "Dry-run signal");
          await db.insert(tradesTable).values({
            ticker: instrument.ticker,
            side: signal,
            quantity: String(quantity),
            price: String(currentPrice),
            total: String(positionValue),
            status: "DRY_RUN",
          });
          tradeExecuted = true;
        } else {
          try {
            const order = await placeBrokerOrder(
              broker,
              instrument.ticker,
              quantity,
              signal,
              stopLossPercent > 0 ? { stopLossPercent, entryPrice: currentPrice } : undefined
            );
            await db.insert(tradesTable).values({
              ticker: instrument.ticker,
              side: signal,
              quantity: String(quantity),
              price: String(currentPrice),
              total: String(positionValue),
              status: "FILLED",
              orderId: order.id,
            });
            tradeExecuted = true;
            logger.info({ ticker: instrument.ticker, signal, broker, orderId: order.id }, "Trade executed");
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await db.insert(tradesTable).values({
              ticker: instrument.ticker,
              side: signal,
              quantity: String(quantity),
              price: String(currentPrice),
              total: String(positionValue),
              status: "FAILED",
              errorMessage: msg,
            });
            logger.error({ ticker: instrument.ticker, signal, broker, err: msg }, "Trade failed");
          }
        }
      }

      await db.insert(signalsTable).values({
        ticker: instrument.ticker,
        signal,
        shortMa: String(shortMa),
        longMa: String(longMa),
        price: String(currentPrice),
        tradeExecuted,
      });

      results.push({ ticker: instrument.ticker, signal, tradeExecuted });
    } catch (err) {
      logger.error({ ticker: instrument.ticker, broker, err }, "Error processing instrument");
    }
  }

  return results;
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
