import { describe, it, expect } from "vitest";
import { computeAtrMomentumSignal, atrMomentumRequiredBars } from "./atrMomentumStrategy";
import type { Candle } from "./capitalcom";

// 20 flat candles (tight range, so ATR stays small) followed by one more
// candle — hand-verified in Python against this exact EMA/ATR recurrence.
// A short flat baseline plus a single huge jump does NOT reliably trigger a
// signal: that same breakout bar's own true range inflates the ATR band
// right when it's being tested against it. A longer, tighter baseline with a
// moderate (not extreme) breakout avoids that self-widening effect.
const FLAT: Candle = { time: 0, open: 100, high: 100.5, low: 99.5, close: 100.0 };
const baseline: Candle[] = Array.from({ length: 20 }, () => ({ ...FLAT }));

const EMA_PERIOD = 5;
const ATR_PERIOD = 10;
const MULTIPLIER = 1.5;

describe("computeAtrMomentumSignal", () => {
  it("returns BUY when close breaks above EMA + k·ATR", () => {
    const breakout: Candle = { time: 1, open: 108, high: 108.5, low: 107.5, close: 108.0 };
    const result = computeAtrMomentumSignal([...baseline, breakout], EMA_PERIOD, ATR_PERIOD, MULTIPLIER);
    expect(result.signal).toBe("BUY");
    expect(result.ema).toBeCloseTo(102.66666666666667, 10);
    expect(result.atr).toBeCloseTo(1.75, 10);
  });

  it("returns SELL when close breaks below EMA − k·ATR", () => {
    const breakdown: Candle = { time: 1, open: 92, high: 92.5, low: 91.5, close: 92.0 };
    const result = computeAtrMomentumSignal([...baseline, breakdown], EMA_PERIOD, ATR_PERIOD, MULTIPLIER);
    expect(result.signal).toBe("SELL");
    expect(result.ema).toBeCloseTo(97.33333333333334, 10);
    expect(result.atr).toBeCloseTo(1.75, 10);
  });

  it("returns HOLD when close stays within the band", () => {
    const result = computeAtrMomentumSignal([...baseline, { ...FLAT, time: 1 }], EMA_PERIOD, ATR_PERIOD, MULTIPLIER);
    expect(result.signal).toBe("HOLD");
    expect(result.ema).toBeCloseTo(100.0, 10);
    expect(result.atr).toBeCloseTo(1.0, 10);
  });

  it("returns HOLD with null ema/atr when there aren't enough candles to warm up", () => {
    const result = computeAtrMomentumSignal(baseline.slice(0, 3), EMA_PERIOD, ATR_PERIOD, MULTIPLIER);
    expect(result.signal).toBe("HOLD");
    expect(result.ema).toBeNull();
    expect(result.atr).toBeNull();
  });
});

describe("atrMomentumRequiredBars", () => {
  it("takes the larger of emaPeriod and atrPeriod+1, plus a 5-bar margin", () => {
    expect(atrMomentumRequiredBars(20, 14)).toBe(20 + 5);
    expect(atrMomentumRequiredBars(5, 14)).toBe(15 + 5);
  });
});
