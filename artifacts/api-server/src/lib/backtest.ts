/**
 * Deterministic strategy backtester (Phase 3).
 *
 * Re-uses the SAME price history pipe (`getBrokerPriceHistory`) and the SAME
 * signal logic (`computeMASignal` for trend-following, `computeMeanReversionSignal`
 * for mean-reversion) that the live bot uses, so the numbers shown are a faithful
 * dry-run of the strategy on recent bars. All maths here is plain code — no LLM is
 * involved in producing any number, per the product brief.
 *
 * Model: a single always-in-market position after the first entry. Each strategy
 * signal sets a target side (BUY → long, SELL → short, HOLD → keep). When the
 * target side flips, the open round-trip is closed (and booked) and a new one is
 * opened at that bar's close. Equity is marked-to-market bar by bar so the equity
 * curve and max drawdown reflect open-position risk, not just closed trades.
 */
import { computeMASignal } from "./maStrategy";
import { computeMeanReversionSignal, requiredBars, type StrategyName } from "./strategyRouter";

export interface BacktestPoint {
  /** Index into the price series (0-based bar number). */
  i: number;
  equity: number;
}

export interface BacktestResult {
  strategy: StrategyName;
  totalTrades: number;
  wins: number;
  losses: number;
  /** Fraction 0..1 of closed trades that were profitable. */
  winRate: number;
  /** Mean return of winning trades, as a fraction (e.g. 0.012 = +1.2%). */
  avgWinPct: number;
  /** Mean return of losing trades, as a fraction (negative). */
  avgLossPct: number;
  /** Largest peak-to-trough equity decline, as a fraction (0..1). */
  maxDrawdownPct: number;
  /** Total compounded return over the window, as a fraction. */
  totalReturnPct: number;
  equityCurve: BacktestPoint[];
}

const STARTING_EQUITY = 10_000;

function side(signal: "BUY" | "SELL" | "HOLD"): 1 | -1 | 0 {
  return signal === "BUY" ? 1 : signal === "SELL" ? -1 : 0;
}

/**
 * Run one strategy over a close-price series and return deterministic metrics.
 * Returns null when there are not enough bars to warm up the indicators.
 */
export function backtestStrategy(
  prices: number[],
  shortPeriod: number,
  longPeriod: number,
  strategy: StrategyName,
): BacktestResult | null {
  const warmup = requiredBars(longPeriod);
  if (prices.length <= warmup + 1) return null;

  let equity = STARTING_EQUITY;
  let peak = equity;
  let maxDrawdownPct = 0;

  let position: 1 | -1 | 0 = 0;
  let entryPrice = 0;

  const wins: number[] = [];
  const losses: number[] = [];
  const equityCurve: BacktestPoint[] = [{ i: warmup, equity }];

  const book = (exitPrice: number) => {
    if (position === 0) return;
    const pnl = (position * (exitPrice - entryPrice)) / entryPrice;
    if (pnl >= 0) wins.push(pnl);
    else losses.push(pnl);
    position = 0;
  };

  for (let i = warmup + 1; i < prices.length; i++) {
    // 1) Mark the open position to market on this bar's move.
    if (position !== 0) {
      const barReturn = (prices[i] - prices[i - 1]) / prices[i - 1];
      equity *= 1 + position * barReturn;
      if (equity > peak) peak = equity;
      const dd = (peak - equity) / peak;
      if (dd > maxDrawdownPct) maxDrawdownPct = dd;
    }
    equityCurve.push({ i, equity });

    // 2) Decide this bar's signal from prices up to and including bar i.
    const window = prices.slice(0, i + 1);
    const sig =
      strategy === "trend_following"
        ? computeMASignal(window, shortPeriod, longPeriod)?.signal ?? "HOLD"
        : computeMeanReversionSignal(window).signal;

    const target = side(sig);

    // 3) Flip the position when the target side changes.
    if (target !== 0 && target !== position) {
      book(prices[i]);
      position = target;
      entryPrice = prices[i];
    }
  }

  // Close any open position at the final bar so stats include it.
  book(prices[prices.length - 1]);

  const totalTrades = wins.length + losses.length;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

  return {
    strategy,
    totalTrades,
    wins: wins.length,
    losses: losses.length,
    winRate: totalTrades ? wins.length / totalTrades : 0,
    avgWinPct: mean(wins),
    avgLossPct: mean(losses),
    maxDrawdownPct,
    totalReturnPct: equity / STARTING_EQUITY - 1,
    equityCurve,
  };
}
