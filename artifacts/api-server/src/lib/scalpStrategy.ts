import type { Candle } from "./capitalcom";
import { ema, atr } from "./indicators";
import type { SignalAction } from "./strategyRouter";

/**
 * Micro mean-reversion for the fast engine: fade stretched one-minute moves
 * back toward a short EMA.
 *
 * The distinguishing feature is not the signal — it is `expectedMovePct`. Every
 * other strategy here answers only "buy, sell or hold"; this one also states
 * how far it expects price to travel, because at scalping speed the trade is
 * only worth taking when that distance clears the spread by a margin. Without
 * a move estimate there is nothing to compare the cost against, which is why
 * mean_reversion could not simply be re-used at a faster interval.
 *
 * Evidence this is a hard problem, from the user's own sweep: at 5-minute bars
 * the existing strategies held up 17% of the time against a ~50% coin flip,
 * with median GROSS expectancy of -0.014% — no signal even before costs. Speed
 * shrinks the move you capture while the spread stays fixed. Hence the cost
 * gate in botEngine.ts is not an optimisation; it is the only thing that makes
 * this strategy defensible.
 */
export interface ScalpParams {
  /** Anchor the price reverts toward. Short, because the holding period is minutes. */
  emaPeriod: number;
  atrPeriod: number;
  /** How many ATRs from the EMA before a move counts as stretched enough to fade. */
  entryAtrMult: number;
}

/** Tuned defaults, kept in code like STRATEGY_PARAMS rather than exposed in Settings. */
export const SCALP_PARAMS: ScalpParams = {
  emaPeriod: 9,
  atrPeriod: 14,
  entryAtrMult: 1.2,
};

export interface ScalpSignal {
  signal: SignalAction;
  ema: number | null;
  atr: number | null;
  /**
   * Distance from the current close back to the EMA, as a fraction of price
   * (e.g. 0.0015 = 0.15%). This is the move the trade is trying to capture, and
   * the number the cost gate weighs against the live spread. Zero on HOLD.
   */
  expectedMovePct: number;
}

/** Bars needed before both indicators are warm. */
export function scalpRequiredBars(params: ScalpParams = SCALP_PARAMS): number {
  return Math.max(params.emaPeriod, params.atrPeriod) * 2 + 5;
}

const NO_SIGNAL: ScalpSignal = { signal: "HOLD", ema: null, atr: null, expectedMovePct: 0 };

export function computeScalpSignal(candles: Candle[], params: ScalpParams = SCALP_PARAMS): ScalpSignal {
  if (candles.length < scalpRequiredBars(params)) return NO_SIGNAL;

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const emaValue = ema(closes, params.emaPeriod);
  const atrValue = atr(highs, lows, closes, params.atrPeriod);
  const price = closes[closes.length - 1];

  if (emaValue == null || atrValue == null || price == null) return NO_SIGNAL;
  // A zero/negative price or a zero ATR makes the distance maths meaningless
  // (and would divide by zero below) — refuse rather than emit a fabricated edge.
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(atrValue) || atrValue <= 0) return NO_SIGNAL;

  const distance = price - emaValue;
  const threshold = atrValue * params.entryAtrMult;
  const expectedMovePct = Math.abs(distance) / price;

  // Stretched BELOW the anchor → expect a move up. Stretched ABOVE → expect a
  // move down. Anything inside the band is noise at this timeframe.
  if (distance <= -threshold) return { signal: "BUY", ema: emaValue, atr: atrValue, expectedMovePct };
  if (distance >= threshold) return { signal: "SELL", ema: emaValue, atr: atrValue, expectedMovePct };

  return { signal: "HOLD", ema: emaValue, atr: atrValue, expectedMovePct: 0 };
}
