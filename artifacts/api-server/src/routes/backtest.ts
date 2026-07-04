import { Router, type IRouter } from "express";
import { db, instrumentsTable } from "@workspace/db";
import { getBrokerPriceHistory } from "../lib/broker";
import { getBotStatus } from "../lib/botEngine";
import { backtestStrategy } from "../lib/backtest";
import { requiredBars, type StrategyName } from "../lib/strategyRouter";

const router: IRouter = Router();

const STRATEGIES: StrategyName[] = ["trend_following", "mean_reversion"];
const HISTORY_BARS = 300;

router.get("/backtest", async (req, res): Promise<void> => {
  const { config } = getBotStatus();
  const { broker, shortPeriod, longPeriod } = config;

  const instruments = await db
    .select()
    .from(instrumentsTable)
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
    equityCurve: { i: number; equity: number }[];
    bars: number;
  }> = [];

  for (const inst of enabled) {
    let prices: number[];
    try {
      prices = await getBrokerPriceHistory(broker, inst.ticker, HISTORY_BARS);
    } catch (err) {
      req.log.warn({ err, ticker: inst.ticker }, "Backtest: price history fetch failed");
      continue;
    }

    if (prices.length <= requiredBars(longPeriod) + 1) continue;

    for (const strategy of STRATEGIES) {
      const r = backtestStrategy(prices, shortPeriod, longPeriod, strategy);
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
    generatedAt: new Date().toISOString(),
    results,
  });
});

export default router;
