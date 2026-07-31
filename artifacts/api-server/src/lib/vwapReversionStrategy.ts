import type { Candle } from "./capitalcom";
import { vwap, atr } from "./indicators";
import type { SignalAction } from "./strategyRouter";

/**
 * VWAP reversion — backtest-only for now, not wired into the live regime
 * router (`strategyRouter.ts`). Inspired by the VWAP-reversion setup common in
 * day-trading literature: price that has stretched far from where volume
 * actually traded tends to snap back toward it.
 *
 * TWO data requirements beyond the close-only strategies, so it only runs
 * where BOTH are available (Capital.com today, not Trading 212):
 *   - real OHLC candles (same as ATR momentum), and
 *   - per-bar volume (`Candle.volume`), which only Capital.com reports.
 *
 * IMPORTANT — this uses a ROLLING-window volume-weighted price, not the
 * textbook session-anchored VWAP that resets at each trading session's open.
 * The codebase has no session-open detection (market status is only ever read
 * as an instantaneous tradeable/not gate), so true session VWAP isn't
 * computable here. See `vwap()` in indicators.ts. The UI must describe this as
 * an approximation rather than plain "VWAP".
 */
export interface VwapReversionParams {
  vwapPeriod: number;
  atrPeriod: number;
  atrMultiplier: number;
}

/** Tuned defaults; kept in code like ATR_MOMENTUM_PARAMS, not exposed in Settings this round. */
export const VWAP_REVERSION_PARAMS: VwapReversionParams = {
  vwapPeriod: 20,
  atrPeriod: 14,
  atrMultiplier: 1.5,
};

export interface VwapReversionSignal {
  signal: SignalAction;
  vwap: number | null;
  atr: number | null;
}

/**
 * Minimum candles required for both the rolling VWAP and the ATR to be
 * computable, with the same +5 stabilization margin as
 * atrMomentumRequiredBars() — kept separate from the live path's
 * requiredBars() for the same reason: that one feeds the live bot and
 * shouldn't absorb warmup math for a strategy that isn't live-wired.
 */
export function vwapReversionRequiredBars(vwapPeriod: number, atrPeriod: number): number {
  return Math.max(vwapPeriod, atrPeriod + 1) + 5;
}

/**
 * Mean-reversion band — deliberately the INVERSE of ATR momentum's breakout
 * band. Momentum buys strength (close ABOVE the upper band); this fades
 * extension instead:
 *   - BUY  when close < VWAP − k·ATR  (stretched BELOW where volume traded →
 *     expect a snap back UP)
 *   - SELL when close > VWAP + k·ATR  (stretched ABOVE → expect a fall back)
 *   - HOLD inside the band.
 * Do not "simplify" this by copying computeAtrMomentumSignal's comparisons —
 * doing so silently converts this into a second breakout strategy.
 */
export function computeVwapReversionSignal(
  candles: Candle[],
  vwapPeriod: number,
  atrPeriod: number,
  atrMultiplier: number
): VwapReversionSignal {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);

  const vwapVal = vwap(highs, lows, closes, volumes, vwapPeriod);
  const atrVal = atr(highs, lows, closes, atrPeriod);
  const price = closes[closes.length - 1];

  if (vwapVal == null || atrVal == null) return { signal: "HOLD", vwap: vwapVal, atr: atrVal };

  const upper = vwapVal + atrMultiplier * atrVal;
  const lower = vwapVal - atrMultiplier * atrVal;

  // Inverted vs. momentum on purpose — see the doc comment above.
  if (price < lower) return { signal: "BUY", vwap: vwapVal, atr: atrVal };
  if (price > upper) return { signal: "SELL", vwap: vwapVal, atr: atrVal };
  return { signal: "HOLD", vwap: vwapVal, atr: atrVal };
}
