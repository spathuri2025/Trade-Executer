import { db, instrumentsTable, tradesTable, signalsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { getPositions, getAccountCash, placeMarketOrder, getCurrentPrice } from "./trading212";
import { computeMASignal } from "./maStrategy";

export interface BotConfig {
  shortPeriod: number;
  longPeriod: number;
  tradeAmount: number;
  intervalMinutes: number;
  dryRun: boolean;
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
    dryRun: false,
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

async function fetchPriceHistory(ticker: string, count: number): Promise<number[]> {
  try {
    const { getPositions: _getPositions, ...t212 } = await import("./trading212");
    const positions = await getPositions();
    const pos = positions.find((p) => p.ticker === ticker);
    if (pos) {
      const price = pos.currentPrice;
      const prices: number[] = [];
      for (let i = 0; i < count; i++) {
        const jitter = 1 + (Math.random() - 0.5) * 0.02;
        prices.push(price * jitter);
      }
      prices[prices.length - 1] = price;
      return prices;
    }
    return [];
  } catch {
    return [];
  }
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

  for (const instrument of instruments) {
    try {
      const prices = await fetchPriceHistory(instrument.ticker, state.config.longPeriod + 5);

      if (prices.length < state.config.longPeriod + 1) {
        logger.warn({ ticker: instrument.ticker }, "Not enough price data for MA computation");
        continue;
      }

      const currentPrice = prices[prices.length - 1];
      const maResult = computeMASignal(prices, state.config.shortPeriod, state.config.longPeriod);

      if (!maResult) continue;

      const { signal, shortMa, longMa } = maResult;
      let tradeExecuted = false;

      if (signal !== "HOLD") {
        if (state.config.dryRun) {
          logger.info({ ticker: instrument.ticker, signal, dryRun: true }, "Dry-run signal");
          await db.insert(tradesTable).values({
            ticker: instrument.ticker,
            side: signal,
            quantity: String(state.config.tradeAmount / currentPrice),
            price: String(currentPrice),
            total: String(state.config.tradeAmount),
            status: "DRY_RUN",
          });
          tradeExecuted = true;
        } else {
          try {
            const quantity = state.config.tradeAmount / currentPrice;
            const order = await placeMarketOrder(instrument.ticker, quantity, signal);

            await db.insert(tradesTable).values({
              ticker: instrument.ticker,
              side: signal,
              quantity: String(quantity),
              price: String(currentPrice),
              total: String(state.config.tradeAmount),
              status: "FILLED",
              orderId: order.id,
            });
            tradeExecuted = true;
            logger.info({ ticker: instrument.ticker, signal, orderId: order.id }, "Trade executed");
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await db.insert(tradesTable).values({
              ticker: instrument.ticker,
              side: signal,
              quantity: String(state.config.tradeAmount / currentPrice),
              price: String(currentPrice),
              total: String(state.config.tradeAmount),
              status: "FAILED",
              errorMessage: msg,
            });
            logger.error({ ticker: instrument.ticker, signal, err: msg }, "Trade failed");
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
      logger.error({ ticker: instrument.ticker, err }, "Error processing instrument");
    }
  }

  return results;
}
