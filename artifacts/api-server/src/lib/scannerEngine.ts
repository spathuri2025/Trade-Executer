import { db, scannerResultsTable, scannerConfigTable, type ScannerConfigRow } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { logger } from "./logger";
import { placeBrokerOrder, getBrokerAccount } from "./broker";
import { capitalAuthFetch, getCapitalPriceHistory } from "./capitalcom";
import { routeStrategy, requiredBars } from "./strategyRouter";
import { getBotStatus } from "./botEngine";
import { getUserBrokerCredentials, type UserBrokerCredentials } from "./brokerCredentialsService";
import { getPlanLimits } from "./planService";
import {
  acquireLease,
  renewLease,
  holdsLease,
  releaseLease,
  EngineOwnedElsewhereError,
  LEASE_RENEW_MS,
} from "./engineLease";

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
  /**
   * Set only while a staggered first scan is pending, when restoring scanners at
   * boot. Cleared by stopScanner alongside intervalHandle — otherwise a
   * "stopped" scanner would still fire one scan.
   */
  pendingStartHandle: ReturnType<typeof setTimeout> | null;
  /** Keeps the ownership lease alive while this process runs the scanner. */
  leaseHandle: ReturnType<typeof setInterval> | null;
  /**
   * Claimed synchronously by startScanner before it awaits, so two concurrent
   * starts cannot both arm a timer. Same reasoning as botEngine's flag.
   */
  starting: boolean;
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

function rowToScannerConfig(row: ScannerConfigRow): ScannerConfig {
  return {
    scanEnabled: row.scanEnabled,
    autoTrade: row.autoTrade,
    minTrendStrength: row.minTrendStrength,
    scanIntervalMinutes: row.scanIntervalMinutes,
    instrumentTypes: row.instrumentTypes,
    maxInstrumentsPerScan: row.maxInstrumentsPerScan,
  };
}

async function persistScannerConfig(userId: number, config: ScannerConfig): Promise<void> {
  await db
    .insert(scannerConfigTable)
    .values({ userId, ...config })
    .onConflictDoUpdate({ target: scannerConfigTable.userId, set: { ...config, updatedAt: new Date() } });
}

/**
 * Records whether the user wants the scan loop running. Kept separate from
 * persistScannerConfig for the same reason as the bot's: `running` is state, not
 * settings, and a plain settings save must not be able to start or stop a loop.
 */
async function persistScannerRunning(userId: number, running: boolean): Promise<void> {
  await db
    .update(scannerConfigTable)
    .set({ running, updatedAt: new Date() })
    .where(eq(scannerConfigTable.userId, userId));
}

/** Per-user in-memory scanner state — mirrors botEngine.ts's per-user model. */
const scannerStates = new Map<number, ScannerState>();

/**
 * Returns (creating if needed) a user's scanner state, loading persisted config
 * from `scanner_config` on first access so settings survive a restart.
 *
 * As in botEngine, `running` deliberately starts false even when the row says
 * otherwise: only resumeRunningScanners() may flip it, because it is the only
 * path that also arms the timer.
 */
async function getOrCreateScannerState(userId: number): Promise<ScannerState> {
  const existing = scannerStates.get(userId);
  if (existing) return existing;

  const [row] = await db.select().from(scannerConfigTable).where(eq(scannerConfigTable.userId, userId));

  // Another caller may have created the state while this one awaited the read.
  const raced = scannerStates.get(userId);
  if (raced) return raced;

  const config = row ? rowToScannerConfig(row) : defaultScannerConfig();

  const state: ScannerState = {
    running: false,
    scanning: false,
    lastRunAt: null,
    nextRunAt: null,
    lastScanCount: 0,
    lastHitCount: 0,
    config,
    intervalHandle: null,
    pendingStartHandle: null,
    leaseHandle: null,
    starting: false,
  };
  // Published BEFORE any further await, so two concurrent callers cannot each
  // build a state and have the second orphan the first's timers — the same race
  // fixed in botEngine.getOrCreateBotState.
  scannerStates.set(userId, state);

  if (!row) await persistScannerConfig(userId, config);
  return state;
}

export async function getScannerStatus(userId: number) {
  const state = await getOrCreateScannerState(userId);
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

export async function updateScannerConfig(userId: number, patch: Partial<ScannerConfig>) {
  const state = await getOrCreateScannerState(userId);
  Object.assign(state.config, patch);
  await persistScannerConfig(userId, state.config);

  if (state.running) {
    await stopScanner(userId);
    if (state.config.scanEnabled) await startScanner(userId);
  }

  return getScannerStatus(userId);
}

/** Arms the scan timers. `delayMs > 0` holds the first scan back when restoring at boot. */
function armScanTimers(userId: number, state: ScannerState, delayMs: number): void {
  const ms = state.config.scanIntervalMinutes * 60 * 1000;

  if (delayMs <= 0) {
    void runScan(userId);
    state.intervalHandle = setInterval(() => void runScan(userId), ms);
    state.nextRunAt = new Date(Date.now() + ms);
    return;
  }

  state.nextRunAt = new Date(Date.now() + delayMs);
  state.pendingStartHandle = setTimeout(() => {
    state.pendingStartHandle = null;
    if (!state.running) return; // stopped while waiting
    void runScan(userId);
    state.intervalHandle = setInterval(() => void runScan(userId), ms);
    state.nextRunAt = new Date(Date.now() + ms);
  }, delayMs);
}

export async function startScanner(userId: number, opts: { firstScanDelayMs?: number } = {}) {
  const state = await getOrCreateScannerState(userId);
  // Check and claim with no await between them — atomic on one event loop.
  if (state.running || state.starting) return getScannerStatus(userId);
  state.starting = true;

  try {
    // The scanner places real orders when auto-trade is on, so it needs the same
    // one-process-per-engine guarantee as the bot. Its own lease, since a user
    // may legitimately have the bot here and the scanner elsewhere.
    if (!(await acquireLease(userId, "scanner"))) {
      logger.warn({ userId }, "Scanner not started — another process holds the lease for it");
      throw new EngineOwnedElsewhereError(
        "This scanner is already running in another process. It will move here automatically within 90 seconds if that process has stopped."
      );
    }

    state.running = true;
    await persistScannerRunning(userId, true);
    armScannerLeaseRenewal(userId, state);
    armScanTimers(userId, state, opts.firstScanDelayMs ?? 0);

    logger.info({ userId, config: state.config }, "Scanner started");
    return getScannerStatus(userId);
  } finally {
    state.starting = false;
  }
}

/**
 * Renew the scanner's lease, and stand down the moment it is lost — another
 * process has taken over and two scanners on one account would double every
 * auto-traded hit.
 */
function armScannerLeaseRenewal(userId: number, state: ScannerState): void {
  if (state.leaseHandle) clearInterval(state.leaseHandle);
  state.leaseHandle = setInterval(() => {
    void (async () => {
      if (!state.running) return;
      if (!(await renewLease(userId, "scanner"))) {
        logger.error({ userId }, "Lost the scanner's ownership lease — standing down here");
        await stopScanner(userId, { keepRunningFlag: true });
      }
    })();
  }, LEASE_RENEW_MS);
}

export async function stopScanner(
  userId: number,
  /** See botEngine.stopBot — stands down locally without clearing the user's intent. */
  opts: { keepRunningFlag?: boolean } = {}
) {
  const state = await getOrCreateScannerState(userId);
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

  if (opts.keepRunningFlag) {
    // Ownership moved; the new owner holds the lease and the user still wants
    // the scanner running. Releasing here would delete their row.
    logger.info({ userId }, "Scanner stood down locally — ownership moved to another process");
    return getScannerStatus(userId);
  }

  await releaseLease(userId, "scanner");
  await persistScannerRunning(userId, false).catch((err: unknown) =>
    logger.error({ err, userId }, "Failed to persist stopped scanner state"),
  );
  logger.info({ userId }, "Scanner stopped");
  return getScannerStatus(userId);
}

/** Spacing between restored scanners' first scans. Longer than the bot's: a scan
 * walks the whole Capital.com market list, so it is far heavier than one cycle. */
const RESUME_STAGGER_MS = 60_000;

/**
 * Re-arms every scanner that was running before this process started — the
 * scanner half of `resumeRunningBots()`. Called once from index.ts, never
 * app.ts, so importing the app in tests never starts scanning.
 */
export async function resumeRunningScanners(): Promise<{ resumed: number; skipped: number }> {
  let resumed = 0;
  let skipped = 0;

  let rows: ScannerConfigRow[];
  try {
    rows = await db.select().from(scannerConfigTable).where(eq(scannerConfigTable.running, true));
  } catch (err) {
    logger.error({ err }, "Could not read scanners to resume — all scanners remain stopped");
    return { resumed: 0, skipped: 0 };
  }

  if (rows.length === 0) {
    logger.info("No scanners to resume");
    return { resumed: 0, skipped: 0 };
  }

  for (const [index, row] of rows.entries()) {
    try {
      await startScanner(row.userId, { firstScanDelayMs: (index + 1) * RESUME_STAGGER_MS });
      resumed += 1;
    } catch (err) {
      skipped += 1;
      if (err instanceof EngineOwnedElsewhereError) {
        // Normal during a deploy: the outgoing instance still owns it. Leave the
        // running flag alone — the adoption sweep picks it up once that process
        // releases.
        logger.info({ userId: row.userId }, "Scanner owned by another process — not resuming here");
        continue;
      }
      logger.error({ err, userId: row.userId }, "Could not resume scanner — leaving it stopped");
      await persistScannerRunning(row.userId, false).catch((persistErr: unknown) =>
        logger.error({ err: persistErr, userId: row.userId }, "Failed to clear scanner running flag"),
      );
    }
  }

  logger.info({ resumed, skipped }, "Finished resuming scanners after restart");
  return { resumed, skipped };
}

/**
 * Adopt scanners that should be running but that this process is not running.
 * Called from botEngine's adoption sweep — see startAdoptionSweep for why this
 * exists: without it a deploy leaves every scanner stopped, because the incoming
 * instance correctly declines while the outgoing one still holds the lease and
 * nothing ever tries again.
 */
export async function adoptOwnerlessScanners(): Promise<void> {
  let rows: ScannerConfigRow[];
  try {
    rows = await db.select().from(scannerConfigTable).where(eq(scannerConfigTable.running, true));
  } catch (err) {
    logger.warn({ err }, "Scanner adoption sweep could not read running scanners");
    return;
  }
  for (const row of rows) {
    if (scannerStates.get(row.userId)?.running) continue; // already ours
    try {
      await startScanner(row.userId);
      logger.info({ userId: row.userId }, "Adopted a scanner whose previous owner released it");
    } catch (err) {
      if (!(err instanceof EngineOwnedElsewhereError)) {
        logger.debug({ userId: row.userId, err }, "Scanner adoption sweep could not start a scanner");
      }
    }
  }
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
  const state = await getOrCreateScannerState(userId);
  if (state.scanning) {
    logger.warn({ userId }, "Scanner already running — skipping cycle");
    return { scanned: 0, hits: 0 };
  }

  // Ownership, before anything else touches the broker. A manual scan on a
  // stopped scanner needs no lease — it is gated by autoTrade and dryRun and
  // places nothing on its own account.
  if (state.running && !(await holdsLease(userId, "scanner"))) {
    logger.error({ userId }, "Scan aborted — this process no longer owns the scanner");
    await stopScanner(userId, { keepRunningFlag: true });
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

  let totalScanned = 0;
  let totalHits = 0;

  // Everything below can throw (DB reads, broker calls) — wrapped in
  // try/finally so `state.scanning` is *always* released. Without this, one
  // failed scan (e.g. a transient DB error in getBotStatus) leaves the lock
  // stuck true forever: every future call — manual or scheduled — hits the
  // `state.scanning` guard above and silently short-circuits to {scanned: 0,
  // hits: 0} without ever updating lastRunAt again, which looks exactly like
  // "scanner does nothing" with no error surfaced anywhere.
  try {
    const botStatus = await getBotStatus(userId);
    const { shortPeriod, longPeriod, stopLossPercent, riskPerTradePercent, tradeAmount, regimeFilterEnabled, barResolution } =
      botStatus.config;
    const { autoTrade, minTrendStrength, instrumentTypes, maxInstrumentsPerScan } = state.config;

    // Scanner auto-trade places real orders, so it sits behind the same
    // live-trading entitlement as the bot's own cycle (see botEngine.runCycle).
    const limits = await getPlanLimits(userId);
    const dryRun = botStatus.config.dryRun || !limits.liveTrading;
    if (botStatus.config.dryRun === false && !limits.liveTrading) {
      logger.warn({ userId }, "Plan does not include live trading — scanner auto-trade forced to dry-run");
    }
    const bars = requiredBars(longPeriod);

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
  } catch (err) {
    logger.error({ userId, err }, "Scanner cycle failed");
  } finally {
    state.lastScanCount = totalScanned;
    state.lastHitCount = totalHits;
    state.scanning = false;
  }

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
