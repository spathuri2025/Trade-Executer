import { Router, type IRouter } from "express";
import { db, instrumentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getBrokerPriceHistory, getBrokerQuote, getBrokerCandles } from "../lib/broker";
import { getBotStatus } from "../lib/botEngine";
import { getUserBrokerCredentials, type UserBrokerCredentials } from "../lib/brokerCredentialsService";
import { backtestStrategy, backtestAtrMomentum, type BacktestStrategyName } from "../lib/backtest";
import { requiredBars, type StrategyName } from "../lib/strategyRouter";
import { ATR_MOMENTUM_PARAMS, atrMomentumRequiredBars } from "../lib/atrMomentumStrategy";

const router: IRouter = Router();

const STRATEGIES: StrategyName[] = ["trend_following", "mean_reversion"];
const HISTORY_BARS = 300;

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

export default router;
