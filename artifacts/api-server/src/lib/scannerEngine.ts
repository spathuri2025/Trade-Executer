import { db, scannerResultsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { logger } from "./logger";
import { placeBrokerOrder, getBrokerAccount } from "./broker";
import { capitalAuthFetch, getCapitalPriceHistory } from "./capitalcom";
import { routeStrategy, requiredBars } from "./strategyRouter";
import { getBotStatus } from "./botEngine";
import { getUserBrokerCredentials, type UserBrokerCredentials } from "./brokerCredentialsService";

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

function defaultScannerConfig(): ScannerConfig {
  return {
    scanEnabled: false,
    autoTrade: false,
    minTrendStrength: 0.3,
    scanIntervalMinutes: 60,
    instrumentTypes: ["SHARES", "INDICES", "CURRENCIES", "COMMODITIES"],
    maxInstrumentsPerScan: 40,
  };
}

/** Per-user in-memory scanner state — mirrors botEngine.ts's per-user model. */
const scannerStates = new Map<number, ScannerState>();

function getOrCreateScannerState(userId: number): ScannerState {
  let state = scannerStates.get(userId);
  if (!state) {
    state = {
      running: false,
      scanning: false,
      lastRunAt: null,
      nextRunAt: null,
      lastScanCount: 0,
      lastHitCount: 0,
      config: defaultScannerConfig(),
      intervalHandle: null,
    };
    scannerStates.set(userId, state);
  }
  return state;
}

export function getScannerStatus(userId: number) {
  const state = getOrCreateScannerState(userId);
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

export function updateScannerConfig(userId: number, patch: Partial<ScannerConfig>) {
  const state = getOrCreateScannerState(userId);
  Object.assign(state.config, patch);

  if (state.running) {
    stopScanner(userId);
    if (state.config.scanEnabled) startScanner(userId);
  }

  return getScannerStatus(userId);
}

export function startScanner(userId: number) {
  const state = getOrCreateScannerState(userId);
  if (state.running) return getScannerStatus(userId);

  state.running = true;
  void runScan(userId);

  const ms = state.config.scanIntervalMinutes * 60 * 1000;
  state.intervalHandle = setInterval(() => void runScan(userId), ms);
  state.nextRunAt = new Date(Date.now() + ms);

  logger.info({ userId, config: state.config }, "Scanner started");
  return getScannerStatus(userId);
}

export function stopScanner(userId: number) {
  const state = getOrCreateScannerState(userId);
  if (state.intervalHandle) {
    clearInterval(state.intervalHandle);
    state.intervalHandle = null;
  }
  state.running = false;
  state.nextRunAt = null;
  logger.info({ userId }, "Scanner stopped");
  return getScannerStatus(userId);
}

interface CapitalMarket {
  epic: string;
  instrumentName: string;
  instrumentType: string;
  bid: number;
  offer: number;
  marketStatus?: string;
}

/**
 * Capital.com's /markets endpoint only documents `searchTerm`/`epics` filters —
 * there is no `instrumentTypes` or `limit` query param. Passing an explicitly
 * empty `searchTerm=` (as this used to) gets treated as "match nothing", not
 * "no filter", which silently returned zero markets for every instrument type.
 * Per the docs, omitting all query params returns the full market list — so
 * fetch everything once and filter/cap client-side using the `instrumentType`
 * field each market already carries.
 */
async function fetchAllMarkets(userId: number, credentials: UserBrokerCredentials): Promise<CapitalMarket[]> {
  if (credentials.broker !== "capitalcom") return [];

  try {
    const data = (await capitalAuthFetch(userId, credentials.capital, "/markets")) as { markets?: CapitalMarket[] };
    return data?.markets ?? [];
  } catch (err) {
    logger.warn({ userId, err }, "Failed to fetch markets for scanning");
    return [];
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runScan(userId: number): Promise<{ scanned: number; hits: number }> {
  const state = getOrCreateScannerState(userId);
  if (state.scanning) {
    logger.warn({ userId }, "Scanner already running — skipping cycle");
    return { scanned: 0, hits: 0 };
  }

  const credentials = await getUserBrokerCredentials(userId);
  if (!credentials || credentials.broker !== "capitalcom") {
    logger.warn({ userId }, "No Capital.com broker connected — skipping scan (scanner is Capital.com-only)");
    return { scanned: 0, hits: 0 };
  }

  state.scanning = true;
  state.lastRunAt = new Date();
  if (state.running) {
    const ms = state.config.scanIntervalMinutes * 60 * 1000;
    state.nextRunAt = new Date(Date.now() + ms);
  }

  const botStatus = await getBotStatus(userId);
  const { shortPeriod, longPeriod, dryRun, stopLossPercent, riskPerTradePercent, tradeAmount, regimeFilterEnabled, barResolution } =
    botStatus.config;
  const { autoTrade, minTrendStrength, instrumentTypes, maxInstrumentsPerScan } = state.config;
  const bars = requiredBars(longPeriod);

  let totalScanned = 0;
  let totalHits = 0;

  // Fetch account balance once for position sizing
  let accountBalance: number | null = null;
  if (autoTrade && riskPerTradePercent > 0) {
    try {
      const account = await getBrokerAccount(userId, credentials);
      accountBalance = account.total;
    } catch {
      logger.warn({ userId }, "Could not fetch account balance for scanner auto-trade sizing");
    }
  }

  // Fetch the full market list once, then filter to the requested instrument
  // types and cap at maxInstrumentsPerScan client-side (see fetchAllMarkets).
  const wantedTypes = new Set(instrumentTypes);
  const fetched = await fetchAllMarkets(userId, credentials);
  const allMarkets = fetched.filter((m) => wantedTypes.has(m.instrumentType)).slice(0, maxInstrumentsPerScan);

  logger.info(
    { userId, fetched: fetched.length, matched: allMarkets.length, instrumentTypes },
    "Scanner fetched market universe"
  );

  // Process in batches of 5 with a 1.5s pause between batches to respect rate limits
  const BATCH_SIZE = 5;
  for (let i = 0; i < allMarkets.length; i += BATCH_SIZE) {
    const batch = allMarkets.slice(i, i + BATCH_SIZE);

    await Promise.allSettled(
      batch.map(async (market) => {
        try {
          const prices = await getCapitalPriceHistory(userId, credentials.capital, market.epic, barResolution, bars);
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

          logger.info({ userId, ticker: market.epic, signal, strategy, regime, trendStrength, price: currentPrice }, "Scanner hit");

          let autoTraded = false;
          let orderId: string | undefined;

          // Every scanner hit that reaches here is a brand-new entry (the scanner
          // doesn't track already-open positions the way the bot's runCycle does),
          // so this gate always applies — never blocks closing/managing an existing
          // position, since the scanner never does that. Read marketStatus off the
          // market data already fetched for this scan rather than firing an extra
          // quote request per candidate.
          const marketClosed = !!market.marketStatus && market.marketStatus !== "TRADEABLE";
          if (autoTrade && !dryRun && marketClosed) {
            logger.info({ userId, ticker: market.epic, marketStatus: market.marketStatus }, "Scanner auto-trade skipped — market closed");
          } else if (autoTrade && !dryRun) {
            try {
              const positionValue =
                riskPerTradePercent > 0 && accountBalance !== null
                  ? accountBalance * (riskPerTradePercent / 100)
                  : tradeAmount;
              const quantity = positionValue / currentPrice;
              const stopLoss = stopLossPercent > 0
                ? { stopLossPercent, entryPrice: currentPrice }
                : undefined;

              const order = await placeBrokerOrder(userId, credentials, market.epic, quantity, signal, stopLoss);
              orderId = order.id;
              autoTraded = true;
              logger.info({ userId, ticker: market.epic, signal, orderId }, "Scanner auto-trade executed");
            } catch (err) {
              logger.error({ userId, ticker: market.epic, err }, "Scanner auto-trade failed");
            }
          }

          await db.insert(scannerResultsTable).values({
            userId,
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
          logger.warn({ userId, ticker: market.epic, err }, "Scanner error processing instrument");
        }
      })
    );

    // Rate-limit pause between batches
    if (i + BATCH_SIZE < allMarkets.length) await sleep(1500);
  }

  state.lastScanCount = totalScanned;
  state.lastHitCount = totalHits;
  state.scanning = false;

  logger.info({ userId, scanned: totalScanned, hits: totalHits }, "Scanner cycle complete");
  return { scanned: totalScanned, hits: totalHits };
}

export async function getScannerResults(userId: number, limit = 50) {
  return db
    .select()
    .from(scannerResultsTable)
    .where(eq(scannerResultsTable.userId, userId))
    .orderBy(desc(scannerResultsTable.scannedAt))
    .limit(limit);
}
