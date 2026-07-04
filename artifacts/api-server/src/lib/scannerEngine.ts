import { db, scannerResultsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { logger } from "./logger";
import { placeBrokerOrder, getBrokerAccount, type BrokerName } from "./broker";
import { getCapitalPriceHistory } from "./capitalcom";
import { routeStrategy, requiredBars } from "./strategyRouter";
import { getBotStatus } from "./botEngine";

export interface ScannerConfig {
  scanEnabled: boolean;
  autoTrade: boolean;
  minTrendStrength: number;
  scanIntervalMinutes: number;
  instrumentTypes: string[];
  maxInstrumentsPerScan: number;
}

interface ScannerState {
  running: boolean;
  scanning: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  lastScanCount: number;
  lastHitCount: number;
  config: ScannerConfig;
  intervalHandle: ReturnType<typeof setInterval> | null;
}

const state: ScannerState = {
  running: false,
  scanning: false,
  lastRunAt: null,
  nextRunAt: null,
  lastScanCount: 0,
  lastHitCount: 0,
  config: {
    scanEnabled: false,
    autoTrade: false,
    minTrendStrength: 0.3,
    scanIntervalMinutes: 60,
    instrumentTypes: ["SHARES", "INDICES", "CURRENCIES", "COMMODITIES"],
    maxInstrumentsPerScan: 40,
  },
  intervalHandle: null,
};

export function getScannerStatus() {
  return {
    running: state.running,
    scanning: state.scanning,
    lastRunAt: state.lastRunAt?.toISOString() ?? null,
    nextRunAt: state.nextRunAt?.toISOString() ?? null,
    lastScanCount: state.lastScanCount,
    lastHitCount: state.lastHitCount,
    config: state.config,
  };
}

export function updateScannerConfig(patch: Partial<ScannerConfig>) {
  Object.assign(state.config, patch);

  if (state.running) {
    stopScanner();
    if (state.config.scanEnabled) startScanner();
  }

  return getScannerStatus();
}

export function startScanner() {
  if (state.running) return getScannerStatus();

  state.running = true;
  runScan();

  const ms = state.config.scanIntervalMinutes * 60 * 1000;
  state.intervalHandle = setInterval(() => runScan(), ms);
  state.nextRunAt = new Date(Date.now() + ms);

  logger.info({ config: state.config }, "Scanner started");
  return getScannerStatus();
}

export function stopScanner() {
  if (state.intervalHandle) {
    clearInterval(state.intervalHandle);
    state.intervalHandle = null;
  }
  state.running = false;
  state.nextRunAt = null;
  logger.info("Scanner stopped");
  return getScannerStatus();
}

interface CapitalMarket {
  epic: string;
  instrumentName: string;
  instrumentType: string;
  bid: number;
  offer: number;
}

async function fetchMarkets(instrumentType: string, limit: number): Promise<CapitalMarket[]> {
  const { CAPITALCOM_API_KEY, CAPITALCOM_IDENTIFIER, CAPITALCOM_PASSWORD } = process.env;
  if (!CAPITALCOM_API_KEY || !CAPITALCOM_IDENTIFIER || !CAPITALCOM_PASSWORD) return [];

  try {
    // Re-use the existing capitalFetch indirectly — fetch markets via a plain authenticated call
    // We piggyback on getCapitalPriceHistory which internally handles session auth.
    // Instead, call the markets endpoint directly with a session we borrow from the module.
    const { capitalAuthFetch } = await import("./capitalcom");
    const data = await capitalAuthFetch(
      `/markets?searchTerm=&instrumentTypes=${instrumentType}&limit=${limit}`
    ) as { markets?: CapitalMarket[] };
    return data?.markets ?? [];
  } catch (err) {
    logger.warn({ instrumentType, err }, "Failed to fetch markets for scanning");
    return [];
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runScan(): Promise<{ scanned: number; hits: number }> {
  if (state.scanning) {
    logger.warn("Scanner already running — skipping cycle");
    return { scanned: 0, hits: 0 };
  }

  state.scanning = true;
  state.lastRunAt = new Date();
  if (state.running) {
    const ms = state.config.scanIntervalMinutes * 60 * 1000;
    state.nextRunAt = new Date(Date.now() + ms);
  }

  const botStatus = getBotStatus();
  const { shortPeriod, longPeriod, dryRun, broker, stopLossPercent, riskPerTradePercent, tradeAmount, regimeFilterEnabled } = botStatus.config;
  const { autoTrade, minTrendStrength, instrumentTypes, maxInstrumentsPerScan } = state.config;
  const bars = requiredBars(longPeriod);

  let totalScanned = 0;
  let totalHits = 0;

  // Fetch account balance once for position sizing
  let accountBalance: number | null = null;
  if (autoTrade && riskPerTradePercent > 0) {
    try {
      const account = await getBrokerAccount(broker);
      accountBalance = account.total;
    } catch {
      logger.warn("Could not fetch account balance for scanner auto-trade sizing");
    }
  }

  // Gather instruments across requested types
  const perType = Math.ceil(maxInstrumentsPerScan / instrumentTypes.length);
  const allMarkets: CapitalMarket[] = [];

  for (const iType of instrumentTypes) {
    const markets = await fetchMarkets(iType, perType);
    allMarkets.push(...markets);
    await sleep(500);
  }

  logger.info({ total: allMarkets.length, instrumentTypes }, "Scanner fetched market universe");

  // Process in batches of 5 with a 1.5s pause between batches to respect rate limits
  const BATCH_SIZE = 5;
  for (let i = 0; i < allMarkets.length; i += BATCH_SIZE) {
    const batch = allMarkets.slice(i, i + BATCH_SIZE);

    await Promise.allSettled(
      batch.map(async (market) => {
        try {
          const prices = await getCapitalPriceHistory(market.epic, "HOUR", bars);
          totalScanned++;

          if (prices.length < longPeriod + 1) return;

          const currentPrice = prices[prices.length - 1];
          const routed = routeStrategy(prices, shortPeriod, longPeriod, regimeFilterEnabled);
          if (!routed || routed.signal === "HOLD") return;

          const { signal, shortMa, longMa, strategy, regime } = routed;
          const trendStrength = Math.abs((shortMa - longMa) / longMa) * 100;

          // The trend-strength floor only makes sense for trend-following hits;
          // mean-reversion fires in low-trend ranges by design, so it is exempt.
          if (strategy === "trend_following" && trendStrength < minTrendStrength) return;

          logger.info({ ticker: market.epic, signal, strategy, regime, trendStrength, price: currentPrice }, "Scanner hit");

          let autoTraded = false;
          let orderId: string | undefined;

          if (autoTrade && !dryRun) {
            try {
              const positionValue =
                riskPerTradePercent > 0 && accountBalance !== null
                  ? accountBalance * (riskPerTradePercent / 100)
                  : tradeAmount;
              const quantity = positionValue / currentPrice;
              const stopLoss = stopLossPercent > 0
                ? { stopLossPercent, entryPrice: currentPrice }
                : undefined;

              const order = await placeBrokerOrder(broker as BrokerName, market.epic, quantity, signal, stopLoss);
              orderId = order.id;
              autoTraded = true;
              logger.info({ ticker: market.epic, signal, orderId }, "Scanner auto-trade executed");
            } catch (err) {
              logger.error({ ticker: market.epic, err }, "Scanner auto-trade failed");
            }
          }

          await db.insert(scannerResultsTable).values({
            ticker: market.epic,
            name: market.instrumentName,
            signal,
            shortMa: String(shortMa),
            longMa: String(longMa),
            price: String(currentPrice),
            trendStrength: String(trendStrength.toFixed(4)),
            strategy,
            regime,
            autoTraded,
            orderId: orderId ?? null,
          });

          totalHits++;
        } catch (err) {
          logger.warn({ ticker: market.epic, err }, "Scanner error processing instrument");
        }
      })
    );

    // Rate-limit pause between batches
    if (i + BATCH_SIZE < allMarkets.length) await sleep(1500);
  }

  state.lastScanCount = totalScanned;
  state.lastHitCount = totalHits;
  state.scanning = false;

  logger.info({ scanned: totalScanned, hits: totalHits }, "Scanner cycle complete");
  return { scanned: totalScanned, hits: totalHits };
}

export async function getScannerResults(limit = 50) {
  return db
    .select()
    .from(scannerResultsTable)
    .orderBy(desc(scannerResultsTable.scannedAt))
    .limit(limit);
}
