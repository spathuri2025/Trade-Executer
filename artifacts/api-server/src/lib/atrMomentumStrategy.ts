import type { Candle } from "./capitalcom";
import { ema, atr } from "./indicators";
import type { SignalAction } from "./strategyRouter";

/**
 * ATR-normalized momentum — backtest-only for now, not wired into the live
 * regime router (`strategyRouter.ts`). Needs real OHLC candles, unlike the
 * close-only trend-following/mean-reversion strategies, so it can only run
 * where `getBrokerCandles` returns data (Capital.com today, not Trading 212).
 */
export interface AtrMomentumParams {
  emaPeriod: number;
  atrPeriod: number;
  atrMultiplier: number;
}

/** Tuned defaults; kept in code like strategyRouter.ts's STRATEGY_PARAMS, not exposed in Settings this round. */
export const ATR_MOMENTUM_PARAMS: AtrMomentumParams = {
  emaPeriod: 20,
  atrPeriod: 14,
  atrMultiplier: 1.5,
};

export interface AtrMomentumSignal {
  signal: SignalAction;
  ema: number | null;
  atr: number | null;
}

/**
 * Minimum candles required for both the EMA and ATR to be computable, with
 * the same +5 stabilization margin style as strategyRouter.ts's
 * requiredBars() — kept as its own function rather than folded into that
 * shared one, since that one is used by the live bot path and shouldn't
 * absorb warmup math for a strategy that isn't live-wired.
 */
export function atrMomentumRequiredBars(emaPeriod: number, atrPeriod: number): number {
  return Math.max(emaPeriod, atrPeriod + 1) + 5;
}

/**
 * Volatility-adjusted breakout band: BUY when close breaks above
 * EMA + k·ATR, SELL when it breaks below EMA − k·ATR, else HOLD — i.e.
 * whether price has moved beyond what recent volatility would explain.
 */
export function computeAtrMomentumSignal(
  candles: Candle[],
  emaPeriod: number,
  atrPeriod: number,
  atrMultiplier: number
): AtrMomentumSignal {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  const emaVal = ema(closes, emaPeriod);
  const atrVal = atr(highs, lows, closes, atrPeriod);
  const price = closes[closes.length - 1];

  if (emaVal == null || atrVal == null) return { signal: "HOLD", ema: emaVal, atr: atrVal };

  const upper = emaVal + atrMultiplier * atrVal;
  const lower = emaVal - atrMultiplier * atrVal;

  if (price > upper) return { signal: "BUY", ema: emaVal, atr: atrVal };
  if (price < lower) return { signal: "SELL", ema: emaVal, atr: atrVal };
  return { signal: "HOLD", ema: emaVal, atr: atrVal };
}
