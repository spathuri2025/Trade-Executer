/**
 * Parameter sweep: backtests every enabled instrument across several
 * timeframes, strategies and parameter sets, then reports whether anything
 * survives honest scrutiny.
 *
 * The point is NOT to find the best-looking combination. Test enough
 * combinations and one will look excellent by chance alone — that is the
 * default outcome of any sweep, not a discovery. So this module is built
 * around three defences:
 *
 *  1. Out-of-sample validation. Each combination is scored separately on the
 *     first 70% of bars and the last 30%. Looking good on data you selected it
 *     with proves nothing; looking good on data you didn't is weak evidence.
 *  2. A minimum trade count per window. A 6-trade 100% win rate is noise, and
 *     the app has already been burned by exactly that (see HISTORY_BARS in
 *     routes/backtest.ts).
 *  3. Reporting the DISTRIBUTION, not the winner. If the median combination
 *     loses money and only the top few make money, that is a sweep finding
 *     noise. The summary always shows the median alongside the best.
 */
import { getBrokerCandlesPaged, getBrokerQuote } from "./broker";
import type { UserBrokerCredentials } from "./brokerCredentialsService";
import { backtestStrategy, backtestAtrMomentum, backtestVwapReversion, type BacktestStrategyName } from "./backtest";
import { ATR_MOMENTUM_PARAMS } from "./atrMomentumStrategy";
import { VWAP_REVERSION_PARAMS } from "./vwapReversionStrategy";
import { STRATEGY_PARAMS } from "./strategyRouter";
import { logger } from "./logger";

/**
 * Bars to gather per instrument/timeframe, fetched in 1000-bar pages.
 *
 * The first sweep used a single 1000-bar request and could only judge
 * trend-following: mean reversion averaged 2.4 trades in an out-of-sample
 * window and VWAP/ATR momentum 9.1 and 6.7, all far below the 15-trade floor,
 * so three of four strategies were never actually tested. More history is the
 * only fix that does not weaken the statistics.
 */
const HISTORY_BARS = 5000;

/** Fraction of the window used for fitting; the rest is held back for validation. */
export const IN_SAMPLE_FRACTION = 0.7;

/**
 * Minimum closed trades required IN EACH WINDOW before a combination's numbers
 * are allowed to count toward any conclusion. Below this, expectancy is
 * dominated by which few trades happened to land in the window.
 */
export const MIN_TRADES_PER_WINDOW = 15;

export const SWEEP_RESOLUTIONS = ["MINUTE_5", "MINUTE_15", "HOUR", "HOUR_4", "DAY"] as const;

/**
 * Warm-up length used for mean reversion. It takes no MA periods of its own, but
 * backtestStrategy derives its warm-up from the long period, so this sets a
 * warm-up comfortably above its RSI and Bollinger lookbacks.
 */
export const MEAN_REVERSION_WARMUP_PERIOD = 50;

/** MA pairs to try — trend-following is the only strategy that uses them. */
export const MA_PAIRS: Array<[number, number]> = [
  [5, 20],
  [9, 21],
  [12, 26],
  [20, 50],
];

export interface WindowStats {
  trades: number;
  winRate: number;
  expectancyPct: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
}

export interface SweepCombo {
  ticker: string;
  name: string;
  resolution: string;
  strategy: BacktestStrategyName;
  /** Human-readable parameter set, e.g. "MA 9/21" or "EMA 20 / ATR 14 x1.5". */
  params: string;
  costPct: number;
  bars: number;
  inSample: WindowStats;
  outOfSample: WindowStats;
  /** Enough trades in BOTH windows for the numbers to mean anything. */
  hasEnoughTrades: boolean;
  /** Positive expectancy in both windows, with enough trades. The only column worth acting on. */
  robust: boolean;
}

export interface SweepSummary {
  combosTested: number;
  combosWithEnoughTrades: number;
  positiveInSample: number;
  positiveOutOfSample: number;
  robustCount: number;
  /** Share of well-sampled combinations that held up out of sample, 0..1. */
  outOfSamplePositiveRate: number;
  /** Median out-of-sample expectancy across well-sampled combos, as a fraction. */
  medianOutOfSampleExpectancy: number;
  verdict: "no-edge" | "weak" | "worth-forward-testing" | "insufficient-data";
  verdictText: string;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function toWindowStats(r: ReturnType<typeof backtestStrategy>): WindowStats | null {
  if (!r) return null;
  return {
    trades: r.totalTrades,
    winRate: r.winRate,
    expectancyPct: r.expectancyPct,
    totalReturnPct: r.totalReturnPct,
    maxDrawdownPct: r.maxDrawdownPct,
  };
}

/**
 * Turn scored combinations into a verdict.
 *
 * The reference point is a coin flip: if a strategy has no edge, roughly half
 * of well-sampled combinations should still show positive expectancy
 * out-of-sample, purely by chance. So an out-of-sample positive rate near 50%
 * is evidence of NOTHING, however good the best row looks. Only a rate clearly
 * above that, together with a positive median, suggests a real effect.
 */
export function summarise(combos: SweepCombo[]): SweepSummary {
  const wellSampled = combos.filter((c) => c.hasEnoughTrades);
  const positiveInSample = combos.filter((c) => c.hasEnoughTrades && c.inSample.expectancyPct > 0).length;
  const positiveOut = wellSampled.filter((c) => c.outOfSample.expectancyPct > 0).length;
  const robustCount = combos.filter((c) => c.robust).length;
  const rate = wellSampled.length > 0 ? positiveOut / wellSampled.length : 0;
  const medianOut = median(wellSampled.map((c) => c.outOfSample.expectancyPct));

  let verdict: SweepSummary["verdict"];
  let verdictText: string;

  if (wellSampled.length < 10) {
    verdict = "insufficient-data";
    verdictText =
      `Only ${wellSampled.length} combination${wellSampled.length === 1 ? "" : "s"} produced enough trades ` +
      `(${MIN_TRADES_PER_WINDOW}+ in each window) to judge. That is too few to conclude anything — ` +
      `try longer timeframes, more instruments, or more history.`;
  } else if (rate >= 0.6 && medianOut > 0) {
    verdict = "worth-forward-testing";
    verdictText =
      `${positiveOut} of ${wellSampled.length} well-sampled combinations (${Math.round(rate * 100)}%) stayed ` +
      `profitable on data they were not selected on, and the median combination is positive. ` +
      `That is more than chance would produce, so it is worth forward-testing in Dry Run before risking money.`;
  } else if (rate >= 0.5 || medianOut > 0) {
    verdict = "weak";
    verdictText =
      `${positiveOut} of ${wellSampled.length} well-sampled combinations (${Math.round(rate * 100)}%) held up ` +
      `out of sample — close to the ~50% a strategy with no edge would produce by chance. ` +
      `The best rows below are more likely luck than skill. Not enough to justify raising risk.`;
  } else {
    verdict = "no-edge";
    verdictText =
      `Only ${positiveOut} of ${wellSampled.length} well-sampled combinations (${Math.round(rate * 100)}%) were ` +
      `profitable out of sample, and the median combination loses ${(Math.abs(medianOut) * 100).toFixed(3)}% per trade ` +
      `after costs. On this evidence there is no edge here to scale.`;
  }

  return {
    combosTested: combos.length,
    combosWithEnoughTrades: wellSampled.length,
    positiveInSample,
    positiveOutOfSample: positiveOut,
    robustCount,
    outOfSamplePositiveRate: rate,
    medianOutOfSampleExpectancy: medianOut,
    verdict,
    verdictText,
  };
}

/** Score one combination across both windows. */
function scoreCombo(
  base: Omit<SweepCombo, "inSample" | "outOfSample" | "hasEnoughTrades" | "robust">,
  runWindow: (from: number, to: number) => ReturnType<typeof backtestStrategy>,
  total: number,
): SweepCombo | null {
  const split = Math.floor(total * IN_SAMPLE_FRACTION);
  const inSample = toWindowStats(runWindow(0, split));
  const outOfSample = toWindowStats(runWindow(split, total));
  if (!inSample || !outOfSample) return null;

  const hasEnoughTrades =
    inSample.trades >= MIN_TRADES_PER_WINDOW && outOfSample.trades >= MIN_TRADES_PER_WINDOW;

  return {
    ...base,
    inSample,
    outOfSample,
    hasEnoughTrades,
    robust: hasEnoughTrades && inSample.expectancyPct > 0 && outOfSample.expectancyPct > 0,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SweepInstrument {
  ticker: string;
  name: string;
}

/**
 * Run the full sweep. `onProgress` is called after each instrument/resolution
 * pair so the caller can persist progress for the UI.
 */
export async function runSweep(
  userId: number,
  credentials: UserBrokerCredentials,
  instruments: SweepInstrument[],
  onProgress: (done: number, total: number) => Promise<void>,
): Promise<{ combos: SweepCombo[]; summary: SweepSummary }> {
  const combos: SweepCombo[] = [];
  const fetchPairs = instruments.length * SWEEP_RESOLUTIONS.length;
  let pairsDone = 0;

  for (const inst of instruments) {
    // One live-spread lookup per instrument, reused across every timeframe and
    // strategy — the spread is a property of the instrument, not the window.
    let costPct = 0;
    try {
      const quote = await getBrokerQuote(userId, credentials, inst.ticker);
      const spread = quote.price > 0 ? (quote.offer - quote.bid) / quote.price : 0;
      costPct = Number.isFinite(spread) && spread > 0 ? spread : 0;
    } catch {
      // Fail open to frictionless, same as the single-instrument backtest route.
    }

    for (const resolution of SWEEP_RESOLUTIONS) {
      try {
        // ONE paged fetch serves both strategy families: the MA strategies need
        // closes, which are simply the candles' close field. Fetching prices and
        // candles separately (as the first version did) doubled the broker calls
        // for identical data.
        const candles = await getBrokerCandlesPaged(userId, credentials, inst.ticker, HISTORY_BARS, resolution);
        const prices = candles.map((c) => c.close);

        // Only trend-following actually consumes the MA periods. Mean reversion
        // is RSI + Bollinger with its own fixed parameters (see
        // computeMeanReversionSignal) and ignores them entirely — sweeping it
        // across MA pairs produced four near-identical rows per instrument that
        // differed only by warm-up offset, then counted them as four
        // independent tests. That inflated its sample fourfold and made seven
        // real observations look like twenty-eight.
        for (const [shortPeriod, longPeriod] of MA_PAIRS) {
          const combo = scoreCombo(
            {
              ticker: inst.ticker,
              name: inst.name,
              resolution,
              strategy: "trend_following",
              params: `MA ${shortPeriod}/${longPeriod}`,
              costPct,
              bars: prices.length,
            },
            (from, to) =>
              backtestStrategy(prices.slice(from, to), shortPeriod, longPeriod, "trend_following", costPct),
            prices.length,
          );
          if (combo) combos.push(combo);
        }

        // One row, its real parameters in the label.
        const meanRev = scoreCombo(
          {
            ticker: inst.ticker,
            name: inst.name,
            resolution,
            strategy: "mean_reversion",
            params: `RSI ${STRATEGY_PARAMS.rsiPeriod} / Bollinger ${STRATEGY_PARAMS.bollingerPeriod}x${STRATEGY_PARAMS.bollingerMult}`,
            costPct,
            bars: prices.length,
          },
          (from, to) =>
            backtestStrategy(prices.slice(from, to), MEAN_REVERSION_WARMUP_PERIOD, MEAN_REVERSION_WARMUP_PERIOD, "mean_reversion", costPct),
          prices.length,
        );
        if (meanRev) combos.push(meanRev);

        if (candles.length > 0) {
          const atr = scoreCombo(
            {
              ticker: inst.ticker,
              name: inst.name,
              resolution,
              strategy: "atr_momentum",
              params: `EMA ${ATR_MOMENTUM_PARAMS.emaPeriod} / ATR ${ATR_MOMENTUM_PARAMS.atrPeriod} x${ATR_MOMENTUM_PARAMS.atrMultiplier}`,
              costPct,
              bars: candles.length,
            },
            (from, to) =>
              backtestAtrMomentum(
                candles.slice(from, to),
                ATR_MOMENTUM_PARAMS.emaPeriod,
                ATR_MOMENTUM_PARAMS.atrPeriod,
                ATR_MOMENTUM_PARAMS.atrMultiplier,
                costPct,
              ),
            candles.length,
          );
          if (atr) combos.push(atr);

          const vwap = scoreCombo(
            {
              ticker: inst.ticker,
              name: inst.name,
              resolution,
              strategy: "vwap_reversion",
              params: `VWAP ${VWAP_REVERSION_PARAMS.vwapPeriod} / ATR ${VWAP_REVERSION_PARAMS.atrPeriod} x${VWAP_REVERSION_PARAMS.atrMultiplier}`,
              costPct,
              bars: candles.length,
            },
            (from, to) =>
              backtestVwapReversion(
                candles.slice(from, to),
                VWAP_REVERSION_PARAMS.vwapPeriod,
                VWAP_REVERSION_PARAMS.atrPeriod,
                VWAP_REVERSION_PARAMS.atrMultiplier,
                costPct,
              ),
            candles.length,
          );
          if (vwap) combos.push(vwap);
        }
      } catch (err) {
        // One bad instrument/timeframe must not abandon the whole sweep.
        logger.warn({ userId, ticker: inst.ticker, resolution, err }, "Sweep: skipped a timeframe");
      }

      pairsDone += 1;
      await onProgress(pairsDone, fetchPairs);
      // Paced so a sweep never looks like an attack on the broker's API.
      await sleep(250);
    }
  }

  // Best out-of-sample first — but the summary is what should be read first.
  combos.sort((a, b) => b.outOfSample.expectancyPct - a.outOfSample.expectancyPct);
  return { combos, summary: summarise(combos) };
}
