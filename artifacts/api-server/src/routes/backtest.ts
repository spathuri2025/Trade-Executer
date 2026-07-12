import { Router, type IRouter } from "express";
import { db, instrumentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getBrokerPriceHistory, getBrokerQuote } from "../lib/broker";
import { getBotStatus } from "../lib/botEngine";
import { getUserBrokerCredentials, type UserBrokerCredentials } from "../lib/brokerCredentialsService";
import { backtestStrategy } from "../lib/backtest";
import { requiredBars, type StrategyName } from "../lib/strategyRouter";

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
    strategy: StrategyName;
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
