import { Router, type IRouter } from "express";
import { db, instrumentsTable, backtestSweepsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { getBrokerPriceHistory, getBrokerQuote, getBrokerCandles } from "../lib/broker";
import { getBotStatus } from "../lib/botEngine";
import { getUserBrokerCredentials, type UserBrokerCredentials } from "../lib/brokerCredentialsService";
import { backtestStrategy, backtestAtrMomentum, backtestVwapReversion, type BacktestStrategyName } from "../lib/backtest";
import { requiredBars, type StrategyName } from "../lib/strategyRouter";
import { ATR_MOMENTUM_PARAMS, atrMomentumRequiredBars } from "../lib/atrMomentumStrategy";
import { VWAP_REVERSION_PARAMS, vwapReversionRequiredBars } from "../lib/vwapReversionStrategy";
import { runSweep, WATCHLIST_OPTIONS, UNIVERSE_OPTIONS } from "../lib/backtestSweep";
import { getBrokerUniverse } from "../lib/broker";

const router: IRouter = Router();

const STRATEGIES: StrategyName[] = ["trend_following", "mean_reversion"];
// 300 bars at a 5-min resolution is only ~25 trading hours — far too thin a
// sample to say anything about a strategy's edge (a tester correctly flagged
// that results were flipping sign run-to-run and a 6-trade "100% win rate"
// showing up, both classic small-sample noise). 1000 is Capital.com's
// documented per-request cap on the /prices endpoint's `max` parameter, so
// this is the most history a single backtest run can pull without paging.
// getBrokerPriceHistory/getBrokerCandles already fail soft (empty array) if
// the broker ever rejects this, so a wrong assumption here degrades to
// today's behavior rather than breaking the page.
const HISTORY_BARS = 1000;

/**
 * Round-trip cost for this instrument, auto-derived from its LIVE bid/offer
 * spread rather than a manually-typed setting — a strategy that looks
 * profitable frictionless and unprofitable with real costs isn't a strategy.
 * Fails open to 0 (frictionless) on a quote-fetch error: this is informational,
 * not a live risk control, so degrading gracefully beats dropping the
 * instrument from the report entirely. Trading 212 has no live-quote endpoint
 * (getBrokerQuote throws for it), so its backtests consistently show 0% here —
 * a known broker limitation, surfaced in the frontend copy, not a bug.
 */
async function liveSpreadCostPct(userId: number, credentials: UserBrokerCredentials, ticker: string): Promise<number> {
  try {
    const quote = await getBrokerQuote(userId, credentials, ticker);
    if (quote.price <= 0) return 0;
    const spread = (quote.offer - quote.bid) / quote.price;
    return Number.isFinite(spread) && spread > 0 ? spread : 0;
  } catch {
    return 0;
  }
}

router.get("/backtest", async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const credentials = await getUserBrokerCredentials(userId);
  if (!credentials) {
    res.status(400).json({ error: "Connect a broker account first" });
    return;
  }

  const { config } = await getBotStatus(userId);
  const { broker, shortPeriod, longPeriod, barResolution } = config;

  const instruments = await db
    .select()
    .from(instrumentsTable)
    .where(eq(instrumentsTable.userId, userId))
    .orderBy(instrumentsTable.addedAt);

  const enabled = instruments.filter((i) => i.enabled);

  const results: Array<{
    ticker: string;
    name: string;
    strategy: BacktestStrategyName;
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    avgWinPct: number;
    avgLossPct: number;
    maxDrawdownPct: number;
    totalReturnPct: number;
    expectancyPct: number;
    profitFactor: number | null;
    costPct: number;
    equityCurve: { i: number; equity: number }[];
    bars: number;
  }> = [];

  for (const inst of enabled) {
    let prices: number[];
    try {
      prices = await getBrokerPriceHistory(userId, credentials, inst.ticker, HISTORY_BARS, barResolution);
    } catch (err) {
      req.log.warn({ err, ticker: inst.ticker }, "Backtest: price history fetch failed");
      continue;
    }

    if (prices.length <= requiredBars(longPeriod) + 1) continue;

    const costPct = await liveSpreadCostPct(userId, credentials, inst.ticker);

    for (const strategy of STRATEGIES) {
      const r = backtestStrategy(prices, shortPeriod, longPeriod, strategy, costPct);
      if (!r) continue;
      results.push({
        ticker: inst.ticker,
        name: inst.name,
        strategy: r.strategy,
        totalTrades: r.totalTrades,
        wins: r.wins,
        losses: r.losses,
        winRate: r.winRate,
        avgWinPct: r.avgWinPct,
        avgLossPct: r.avgLossPct,
        maxDrawdownPct: r.maxDrawdownPct,
        totalReturnPct: r.totalReturnPct,
        expectancyPct: r.expectancyPct,
        profitFactor: r.profitFactor,
        costPct: r.costPct,
        equityCurve: r.equityCurve,
        bars: prices.length,
      });
    }

    // ATR momentum needs real OHLC, unavailable for Trading 212 (its price
    // history is already a fabricated series with no real high/low) — omit
    // the row rather than inventing a placeholder result, since there's no
    // honest non-null value to report when there's nothing to backtest over.
    // Logged (not silent) so the omission is still visible server-side.
    let candles: Awaited<ReturnType<typeof getBrokerCandles>> = [];
    try {
      candles = await getBrokerCandles(userId, credentials, inst.ticker, HISTORY_BARS, barResolution);
    } catch (err) {
      req.log.warn({ err, ticker: inst.ticker }, "Backtest: candle fetch failed for ATR momentum");
    }

    const atrWarmup = atrMomentumRequiredBars(ATR_MOMENTUM_PARAMS.emaPeriod, ATR_MOMENTUM_PARAMS.atrPeriod);
    if (candles.length > atrWarmup + 1) {
      // Reuse the same live-spread cost already fetched above for this
      // instrument — one fewer network round-trip, and a consistent cost
      // figure across all three strategies for the same instrument.
      const r = backtestAtrMomentum(
        candles,
        ATR_MOMENTUM_PARAMS.emaPeriod,
        ATR_MOMENTUM_PARAMS.atrPeriod,
        ATR_MOMENTUM_PARAMS.atrMultiplier,
        costPct
      );
      if (r) {
        results.push({
          ticker: inst.ticker,
          name: inst.name,
          strategy: r.strategy,
          totalTrades: r.totalTrades,
          wins: r.wins,
          losses: r.losses,
          winRate: r.winRate,
          avgWinPct: r.avgWinPct,
          avgLossPct: r.avgLossPct,
          maxDrawdownPct: r.maxDrawdownPct,
          totalReturnPct: r.totalReturnPct,
          expectancyPct: r.expectancyPct,
          profitFactor: r.profitFactor,
          costPct: r.costPct,
          equityCurve: r.equityCurve,
          bars: candles.length,
        });
      }
    } else {
      req.log.info(
        { ticker: inst.ticker, broker: credentials.broker, candles: candles.length },
        "Backtest: ATR momentum skipped — no OHLC candles available for this broker/instrument"
      );
    }

    // VWAP reversion additionally needs per-bar VOLUME, which ATR momentum
    // doesn't — so it gets its own check and its own omission, rather than
    // riding on the block above. An instrument can legitimately produce an
    // ATR momentum row while omitting this one (candles present, volume
    // absent). Reuses the same `candles` already fetched above — no second
    // network round-trip.
    const vwapWarmup = vwapReversionRequiredBars(VWAP_REVERSION_PARAMS.vwapPeriod, VWAP_REVERSION_PARAMS.atrPeriod);
    const hasVolume = candles.length > 0 && candles.every((c) => c.volume != null && Number.isFinite(c.volume));
    if (candles.length > vwapWarmup + 1 && hasVolume) {
      const r = backtestVwapReversion(
        candles,
        VWAP_REVERSION_PARAMS.vwapPeriod,
        VWAP_REVERSION_PARAMS.atrPeriod,
        VWAP_REVERSION_PARAMS.atrMultiplier,
        costPct
      );
      if (r) {
        results.push({
          ticker: inst.ticker,
          name: inst.name,
          strategy: r.strategy,
          totalTrades: r.totalTrades,
          wins: r.wins,
          losses: r.losses,
          winRate: r.winRate,
          avgWinPct: r.avgWinPct,
          avgLossPct: r.avgLossPct,
          maxDrawdownPct: r.maxDrawdownPct,
          totalReturnPct: r.totalReturnPct,
          expectancyPct: r.expectancyPct,
          profitFactor: r.profitFactor,
          costPct: r.costPct,
          equityCurve: r.equityCurve,
          bars: candles.length,
        });
      }
    } else {
      req.log.info(
        { ticker: inst.ticker, broker: credentials.broker, candles: candles.length, hasVolume },
        "Backtest: VWAP reversion skipped — no OHLC candles or no volume data for this broker/instrument"
      );
    }
  }

  res.json({
    broker,
    shortPeriod,
    longPeriod,
    historyBars: HISTORY_BARS,
    barResolution,
    generatedAt: new Date().toISOString(),
    results,
  });
});

/**
 * Start a parameter sweep. Returns immediately with the row id: a full sweep
 * makes dozens of paced broker calls and runs for minutes, far longer than an
 * HTTP request should live. The UI polls GET /backtest/sweep for progress.
 *
 * One running sweep per user at a time — they are broker-API-heavy, and a
 * second concurrent run would both slow the first and risk rate limits.
 */
router.post("/backtest/sweep", async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const credentials = await getUserBrokerCredentials(userId);
  if (!credentials) {
    res.status(400).json({ error: "Connect a broker account first" });
    return;
  }

  const [existing] = await db
    .select({ id: backtestSweepsTable.id })
    .from(backtestSweepsTable)
    .where(and(eq(backtestSweepsTable.userId, userId), eq(backtestSweepsTable.status, "running")));
  if (existing) {
    res.status(409).json({ error: "A sweep is already running", sweepId: existing.id });
    return;
  }

  // "universe" sweeps the broker's whole tradeable catalogue rather than the
  // user's watchlist. That is the honest way to use hundreds of instruments:
  // search them for an edge BEFORE trading them, since adding instruments to a
  // negative-expectancy system only makes the losses more consistent.
  const scope = (req.body ?? {})["scope"] === "universe" ? "universe" : "watchlist";
  const requestedMax = Number((req.body ?? {})["maxInstruments"]);
  const maxInstruments =
    Number.isFinite(requestedMax) && requestedMax > 0 ? Math.min(Math.floor(requestedMax), 400) : 150;

  let enabled: Array<{ ticker: string; name: string }>;
  if (scope === "universe") {
    let universe;
    try {
      universe = await getBrokerUniverse(userId, credentials);
    } catch (err) {
      req.log.error({ err }, "Could not fetch the broker's instrument universe");
      res.status(502).json({ error: "Could not fetch the instrument list from your broker" });
      return;
    }
    if (universe.length === 0) {
      res.status(400).json({ error: "Your broker did not return any tradeable instruments" });
      return;
    }
    // Capped: every extra instrument is more broker calls AND one more chance
    // for a false winner to appear, so breadth is deliberately bounded.
    enabled = universe.slice(0, maxInstruments).map((m) => ({ ticker: m.epic, name: m.instrumentName }));
  } else {
    const instruments = await db
      .select()
      .from(instrumentsTable)
      .where(eq(instrumentsTable.userId, userId));
    enabled = instruments.filter((i) => i.enabled).map((i) => ({ ticker: i.ticker, name: i.name }));
    if (enabled.length === 0) {
      res.status(400).json({ error: "Enable at least one instrument first" });
      return;
    }
  }

  const [row] = await db
    .insert(backtestSweepsTable)
    .values({ userId, status: "running", combosTotal: 0, combosDone: 0 })
    .returning();
  if (!row) {
    res.status(500).json({ error: "Could not start the sweep" });
    return;
  }

  // Deliberately NOT awaited: the response goes back now and the work
  // continues. Every failure path inside writes its own terminal row status,
  // so a crash cannot leave the sweep "running" forever.
  void (async () => {
    try {
      const { combos, summary } = await runSweep(
        userId,
        credentials,
        enabled,
        async (done, total) => {
          await db
            .update(backtestSweepsTable)
            .set({ combosDone: done, combosTotal: total })
            .where(eq(backtestSweepsTable.id, row.id));
        },
        scope === "universe" ? UNIVERSE_OPTIONS : WATCHLIST_OPTIONS,
      );

      await db
        .update(backtestSweepsTable)
        .set({
          status: "complete",
          summary: JSON.stringify(summary),
          results: JSON.stringify(combos),
          completedAt: new Date(),
        })
        .where(eq(backtestSweepsTable.id, row.id));
      req.log.info({ userId, sweepId: row.id, combos: combos.length, verdict: summary.verdict }, "Sweep complete");
    } catch (err) {
      req.log.error({ err, userId, sweepId: row.id }, "Sweep failed");
      await db
        .update(backtestSweepsTable)
        .set({
          status: "failed",
          error: err instanceof Error ? err.message : "Unknown error",
          completedAt: new Date(),
        })
        .where(eq(backtestSweepsTable.id, row.id))
        .catch(() => {});
    }
  })();

  res.status(202).json({ sweepId: row.id, status: "running", scope, instruments: enabled.length });
});

/** The caller's most recent sweep — progress while running, results when done. */
router.get("/backtest/sweep", async (req, res): Promise<void> => {
  const [row] = await db
    .select()
    .from(backtestSweepsTable)
    .where(eq(backtestSweepsTable.userId, req.user!.id))
    .orderBy(desc(backtestSweepsTable.startedAt))
    .limit(1);

  if (!row) {
    res.json({ sweep: null });
    return;
  }

  res.set("Cache-Control", "no-store");
  res.json({
    sweep: {
      id: row.id,
      status: row.status,
      combosDone: row.combosDone,
      combosTotal: row.combosTotal,
      summary: row.summary ? JSON.parse(row.summary) : null,
      results: row.results ? JSON.parse(row.results) : null,
      error: row.error,
      startedAt: row.startedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    },
  });
});

export default router;
