/**
 * Strategy router + regime filter (Phase 2).
 *
 * Two strategies only, per the product brief:
 *   - trend_following  → the existing MA crossover (best in trending markets)
 *   - mean_reversion   → RSI + Bollinger Band reversion (best in ranging markets)
 *
 * A regime filter classifies each instrument as "trending" or "ranging" using a
 * close-based ADX approximation and routes it to the matching strategy. The
 * classification is a plain deterministic threshold with NO LLM dependency, so
 * basic routing never relies on an AI call. When the regime filter is disabled,
 * everything falls back to trend-following (identical to the pre-Phase-2 bot).
 *
 * The tuning constants below are intentionally kept in code (not exposed in the
 * UI) so the app stays "two strategies + a regime toggle" for the user while
 * remaining easy to extend later.
 */
import { computeMASignal } from "./maStrategy";
import { rsi, bollingerBands, adx } from "./indicators";

// "atr_momentum" is backtest-only (see atrMomentumStrategy.ts) — routeStrategy()
// below never returns it; the live regime router only ever picks between the
// first two. Widened here purely so backtest.ts/routes/backtest.ts can use the
// literal, not to imply this is a third live-routed option.
export type StrategyName = "trend_following" | "mean_reversion" | "atr_momentum";
export type Regime = "trending" | "ranging";
export type SignalAction = "BUY" | "SELL" | "HOLD";

/** Regime-filter + mean-reversion tuning. Extensible in code, not in the UI. */
export const STRATEGY_PARAMS = {
  adxPeriod: 14,
  /** ADX at/above this reads as a trending market; below is ranging. */
  adxTrendThreshold: 25,
  rsiPeriod: 14,
  rsiOversold: 30,
  rsiOverbought: 70,
  bollingerPeriod: 20,
  bollingerMult: 2,
} as const;

/** Minimum close bars required for every indicator the router may compute. */
export function requiredBars(longPeriod: number): number {
  return (
    Math.max(
      longPeriod + 1,
      STRATEGY_PARAMS.adxPeriod * 2 + 1,
      STRATEGY_PARAMS.rsiPeriod + 1,
      STRATEGY_PARAMS.bollingerPeriod
    ) + 5
  );
}

export interface StrategyResult {
  signal: SignalAction;
  strategy: StrategyName;
  regime: Regime;
  shortMa: number;
  longMa: number;
  /** Close-based ADX used for the regime classification (null if incomputable). */
  adx: number | null;
  /** RSI at decision time when mean-reversion ran (null otherwise). */
  rsi: number | null;
}

/**
 * Mean-reversion signal: fade stretched moves in a range. BUY when price is
 * oversold (RSI low AND at/below the lower Bollinger band); SELL when overbought
 * (RSI high AND at/above the upper band). Requiring both conditions avoids firing
 * on a single noisy reading.
 */
export function computeMeanReversionSignal(prices: number[]): {
  signal: SignalAction;
  rsi: number | null;
} {
  const r = rsi(prices, STRATEGY_PARAMS.rsiPeriod);
  const bands = bollingerBands(prices, STRATEGY_PARAMS.bollingerPeriod, STRATEGY_PARAMS.bollingerMult);
  const price = prices[prices.length - 1];

  if (r == null || bands == null) return { signal: "HOLD", rsi: r };

  if (r <= STRATEGY_PARAMS.rsiOversold && price <= bands.lower) {
    return { signal: "BUY", rsi: r };
  }
  if (r >= STRATEGY_PARAMS.rsiOverbought && price >= bands.upper) {
    return { signal: "SELL", rsi: r };
  }
  return { signal: "HOLD", rsi: r };
}

/** Classify the market regime from a close-based ADX. Falls back to trending
 * (→ trend-following) when ADX can't be computed, so routing is never blocked. */
export function classifyRegime(prices: number[]): { regime: Regime; adx: number | null } {
  const value = adx(prices, STRATEGY_PARAMS.adxPeriod);
  if (value == null) return { regime: "trending", adx: null };
  return { regime: value >= STRATEGY_PARAMS.adxTrendThreshold ? "trending" : "ranging", adx: value };
}

/**
 * Route an instrument to the right strategy and return its signal plus the
 * regime/strategy metadata to persist. Always computes the MA values so signal
 * rows stay populated regardless of which strategy fired.
 *
 * @param regimeFilterEnabled when false, always uses trend-following (the
 *   pre-Phase-2 behaviour).
 */
export function routeStrategy(
  prices: number[],
  shortPeriod: number,
  longPeriod: number,
  regimeFilterEnabled: boolean
): StrategyResult | null {
  const ma = computeMASignal(prices, shortPeriod, longPeriod);
  if (!ma) return null;

  const { regime, adx: adxValue } = regimeFilterEnabled
    ? classifyRegime(prices)
    : { regime: "trending" as Regime, adx: null };

  if (regimeFilterEnabled && regime === "ranging") {
    const mr = computeMeanReversionSignal(prices);
    return {
      signal: mr.signal,
      strategy: "mean_reversion",
      regime,
      shortMa: ma.shortMa,
      longMa: ma.longMa,
      adx: adxValue,
      rsi: mr.rsi,
    };
  }

  return {
    signal: ma.signal,
    strategy: "trend_following",
    regime,
    shortMa: ma.shortMa,
    longMa: ma.longMa,
    adx: adxValue,
    rsi: null,
  };
}
