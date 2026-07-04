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
 *
 * Costs: an optional round-trip cost (`costPct`, a fraction such as 0.001 = 0.1%)
 * is deducted from equity each time a position is closed, so the equity curve,
 * total return, and drawdown are all net of trading friction. The per-trade
 * `expectancyPct` implements the classic edge formula explicitly:
 *   (winRate × avgWin) − (lossRate × |avgLoss|) − costPct
 * where avgWin/avgLoss stay GROSS (pre-cost) so the formula's terms are legible,
 * and the cost is subtracted as its own term. A positive expectancy means the
 * strategy has a net edge on this window; <= 0 means it does not.
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
  /** Total compounded return over the window, as a fraction (net of costs). */
  totalReturnPct: number;
  /**
   * Per-trade expectancy (edge): (winRate·avgWin) − (lossRate·|avgLoss|) − costPct,
   * as a fraction. > 0 means a net positive edge on this window.
   */
  expectancyPct: number;
  /**
   * Profit factor: gross wins ÷ gross losses (both pre-cost, absolute). null when
   * there were no losing trades (an undefined / "infinite" ratio).
   */
  profitFactor: number | null;
  /** Round-trip cost fraction applied to each trade (echo of the input). */
  costPct: number;
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
  costPct = 0,
): BacktestResult | null {
  const warmup = requiredBars(longPeriod);
  if (prices.length <= warmup + 1) return null;

  const cost = Number.isFinite(costPct) && costPct > 0 ? costPct : 0;

  let equity = STARTING_EQUITY;
  let peak = equity;
  let maxDrawdownPct = 0;

  let position: 1 | -1 | 0 = 0;
  let entryPrice = 0;

  const wins: number[] = [];
  const losses: number[] = [];
  const equityCurve: BacktestPoint[] = [{ i: warmup, equity }];

  // Fold this bar's final (post-cost) equity into the peak/drawdown tracker.
  const trackDrawdown = () => {
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDrawdownPct) maxDrawdownPct = dd;
  };

  const book = (exitPrice: number) => {
    if (position === 0) return;
    // Gross round-trip return (pre-cost) drives the win/loss stats so the
    // expectancy formula's avgWin/avgLoss terms stay legible.
    const pnl = (position * (exitPrice - entryPrice)) / entryPrice;
    if (pnl >= 0) wins.push(pnl);
    else losses.push(pnl);
    // Deduct the round-trip cost from equity so the curve/return are net.
    if (cost > 0) equity *= 1 - cost;
    position = 0;
  };

  for (let i = warmup + 1; i < prices.length; i++) {
    // 1) Mark the open position to market on this bar's move.
    if (position !== 0) {
      const barReturn = (prices[i] - prices[i - 1]) / prices[i - 1];
      equity *= 1 + position * barReturn;
    }

    // 2) Decide this bar's signal from prices up to and including bar i.
    const window = prices.slice(0, i + 1);
    const sig =
      strategy === "trend_following"
        ? computeMASignal(window, shortPeriod, longPeriod)?.signal ?? "HOLD"
        : computeMeanReversionSignal(window).signal;

    const target = side(sig);

    // 3) Flip the position when the target side changes (books the round-trip
    //    cost into equity before this bar's point is recorded).
    if (target !== 0 && target !== position) {
      book(prices[i]);
      position = target;
      entryPrice = prices[i];
    }

    // 4) Record net equity and update drawdown once all of bar i's effects
    //    (mark-to-market + any close cost) are applied, so the curve and
    //    maxDrawdownPct are genuinely net of trading friction.
    trackDrawdown();
    equityCurve.push({ i, equity });
  }

  // Close any open position at the final bar so stats include it, then reflect
  // that closing cost in both the drawdown and the final equity curve point.
  book(prices[prices.length - 1]);
  trackDrawdown();
  if (equityCurve.length > 0) equityCurve[equityCurve.length - 1].equity = equity;

  const totalTrades = wins.length + losses.length;
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);

  const winRate = totalTrades ? wins.length / totalTrades : 0;
  const lossRate = totalTrades ? losses.length / totalTrades : 0;
  const avgWinPct = mean(wins);
  const avgLossPct = mean(losses);

  // Classic edge / expectancy: (winRate·avgWin) − (lossRate·|avgLoss|) − cost.
  const expectancyPct = totalTrades
    ? winRate * avgWinPct - lossRate * Math.abs(avgLossPct) - cost
    : 0;

  // Profit factor: gross wins ÷ gross losses. null when there were no losses.
  const grossWins = sum(wins);
  const grossLosses = Math.abs(sum(losses));
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : null;

  return {
    strategy,
    totalTrades,
    wins: wins.length,
    losses: losses.length,
    winRate,
    avgWinPct,
    avgLossPct,
    maxDrawdownPct,
    totalReturnPct: equity / STARTING_EQUITY - 1,
    expectancyPct,
    profitFactor,
    costPct: cost,
    equityCurve,
  };
}
