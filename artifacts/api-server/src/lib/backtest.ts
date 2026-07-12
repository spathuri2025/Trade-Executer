/**
 * Deterministic strategy backtester (Phase 3).
 *
 * Re-uses the SAME price history pipe (`getBrokerPriceHistory`) and the SAME
 * signal logic (`computeMASignal` for trend-following, `computeMeanReversionSignal`
 * for mean-reversion) that the live bot uses, so the numbers shown are a faithful
 * dry-run of the strategy on recent bars. All maths here is plain code — no LLM is
 * involved in producing any number, per the product brief.
 *
 * `backtestAtrMomentum` is the exception to "same pipe as the live bot" — it's
 * backtest-only (see atrMomentumStrategy.ts), not wired into the live regime
 * router, and runs over full OHLC candles instead of the close-only series.
 * Both share the same underlying fill-timing engine (`runBacktestEngine`
 * below) so the correctness-critical mechanics described here apply to it too.
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
import { computeAtrMomentumSignal, atrMomentumRequiredBars } from "./atrMomentumStrategy";
import type { Candle } from "./capitalcom";

export interface BacktestPoint {
  /** Index into the price series (0-based bar number). */
  i: number;
  equity: number;
}

/**
 * Wider than the live-routed StrategyName — this ephemeral report (no DB
 * table backs it) can show "atr_momentum" even though the live regime router
 * never produces it. Keeping this separate from StrategyName is what lets
 * botEngine.ts/scannerEngine.ts's DB writes stay narrowly typed.
 */
export type BacktestStrategyName = StrategyName | "atr_momentum";

export interface BacktestResult {
  strategy: BacktestStrategyName;
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

interface EngineParams<B> {
  bars: B[];
  /** Index of the first bar with enough history to trade (already warmed up). */
  warmup: number;
  /** Already-clamped (>= 0) round-trip cost fraction. */
  costPct: number;
  /** Price used for mark-to-market and fills (e.g. a bar's close). */
  price: (bar: B) => number;
  /** Decide this bar's target side using bars[0..i] inclusive. */
  decideTarget: (window: B[], i: number) => 1 | -1 | 0;
}

/**
 * Generic fill-timing/equity engine shared by every strategy's backtest —
 * extracted so a new strategy (e.g. ATR momentum) inherits the same
 * carefully-debugged fill-timing mechanics instead of a second hand-copy of
 * them. Everything below is strategy-agnostic; the only strategy-specific
 * inputs are `price()` (how to read a bar's close-equivalent) and
 * `decideTarget()` (how to turn a windowed slice of bars into a signal).
 */
function runBacktestEngine<B>(params: EngineParams<B>): Omit<BacktestResult, "strategy"> {
  const { bars, warmup, costPct: cost, price, decideTarget } = params;

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

  // A signal decided at bar i fills at bar i+1's close, not bar i's own —
  // deciding and filling on the identical bar would let the strategy trade at
  // a price it could only have known the instant it appeared (look-ahead
  // bias). pendingTarget holds a flip decided last bar but not yet filled.
  //
  // Ordering matters here: a position queued for a flip is still the one
  // actually held through THIS bar's move (the fill happens at the END of
  // this bar's close, not the start of it), so mark-to-market must run
  // BEFORE the fill using the still-old `position` — flipping `position`
  // first and marking-to-market after would incorrectly apply this bar's
  // return to a position that was only entered at this exact close, i.e. had
  // zero elapsed exposure yet.
  let pendingTarget: 1 | -1 | 0 | null = null;

  for (let i = warmup + 1; i < bars.length; i++) {
    // 1) Mark the CURRENT (still pre-fill, if a flip is pending) position to
    //    market on this bar's move — correct because that position was held
    //    right up until this bar's close.
    if (position !== 0) {
      const barReturn = (price(bars[i]) - price(bars[i - 1])) / price(bars[i - 1]);
      equity *= 1 + position * barReturn;
    }

    // 2) If a flip was queued on a previous bar, execute the fill NOW at
    //    this bar's close — closes the old position (cost + win/loss stats
    //    via book()) and opens the new one, effective from the NEXT bar's
    //    mark-to-market onward, not this one.
    if (pendingTarget !== null && pendingTarget !== position) {
      book(price(bars[i]));
      position = pendingTarget;
      entryPrice = price(bars[i]);
    }
    pendingTarget = null;

    // 3) Decide this bar's signal from bars up to and including bar i — the
    //    strategy is still allowed to know bar i's own close when deciding,
    //    it just can't fill at that same close.
    const window = bars.slice(0, i + 1);
    const target = decideTarget(window, i);

    // 4) Queue the flip for next bar's fill instead of applying it now.
    if (target !== 0 && target !== position) {
      pendingTarget = target;
    }

    // 5) Record net equity and update drawdown once all of bar i's effects
    //    (mark-to-market + any fill) are applied, so the curve and
    //    maxDrawdownPct are genuinely net of trading friction.
    trackDrawdown();
    equityCurve.push({ i, equity });
  }

  // Close-out: fill any still-pending flip at the final close (there's no
  // next bar left to defer it to), then close any resulting open position at
  // that same final close so stats include it, reflecting the cost in both
  // the drawdown and the final equity curve point.
  const lastPrice = price(bars[bars.length - 1]);
  if (pendingTarget !== null && pendingTarget !== position) {
    book(lastPrice);
    position = pendingTarget;
    entryPrice = lastPrice;
  }
  book(lastPrice);
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

  const decideTarget = (window: number[]): 1 | -1 | 0 =>
    side(
      strategy === "trend_following"
        ? computeMASignal(window, shortPeriod, longPeriod)?.signal ?? "HOLD"
        : computeMeanReversionSignal(window).signal
    );

  const result = runBacktestEngine({
    bars: prices,
    warmup,
    costPct: cost,
    price: (p) => p,
    decideTarget,
  });

  return { strategy, ...result };
}

/**
 * Run ATR-normalized momentum over a full OHLC candle series. Backtest-only —
 * see atrMomentumStrategy.ts. Returns null when there are not enough candles
 * to warm up the EMA/ATR.
 */
export function backtestAtrMomentum(
  candles: Candle[],
  emaPeriod: number,
  atrPeriod: number,
  atrMultiplier: number,
  costPct = 0,
): BacktestResult | null {
  const warmup = atrMomentumRequiredBars(emaPeriod, atrPeriod);
  if (candles.length <= warmup + 1) return null;

  const cost = Number.isFinite(costPct) && costPct > 0 ? costPct : 0;

  const decideTarget = (window: Candle[]): 1 | -1 | 0 =>
    side(computeAtrMomentumSignal(window, emaPeriod, atrPeriod, atrMultiplier).signal);

  const result = runBacktestEngine({
    bars: candles,
    warmup,
    costPct: cost,
    price: (c) => c.close,
    decideTarget,
  });

  return { strategy: "atr_momentum", ...result };
}
