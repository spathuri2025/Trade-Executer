import { describe, it, expect } from "vitest";
import { computeVwapReversionSignal, vwapReversionRequiredBars } from "./vwapReversionStrategy";
import type { Candle } from "./capitalcom";

// Same baseline technique as atrMomentumStrategy.test.ts: a long, tight flat
// stretch keeps ATR small so a moderate move clears the band, with all
// expected values hand-verified in Python against these exact recurrences.
const FLAT: Candle = { time: 0, open: 100, high: 100.5, low: 99.5, close: 100.0, volume: 1000 };
const baseline: Candle[] = Array.from({ length: 20 }, () => ({ ...FLAT }));

const VWAP_PERIOD = 5;
const ATR_PERIOD = 10;
const MULTIPLIER = 1.5;

describe("computeVwapReversionSignal", () => {
  it("returns BUY when close drops BELOW VWAP − k·ATR (fades the dip)", () => {
    // Direction check that matters most: this is mean-reversion, so a DROP
    // must produce BUY. ATR momentum's breakout logic would return SELL here.
    const dip: Candle = { time: 1, open: 92, high: 92.5, low: 91.5, close: 92.0, volume: 1000 };
    const result = computeVwapReversionSignal([...baseline, dip], VWAP_PERIOD, ATR_PERIOD, MULTIPLIER);
    expect(result.signal).toBe("BUY");
    expect(result.vwap).toBeCloseTo(98.4, 10);
    expect(result.atr).toBeCloseTo(1.75, 10);
  });

  it("returns SELL when close rises ABOVE VWAP + k·ATR (fades the spike)", () => {
    const spike: Candle = { time: 1, open: 108, high: 108.5, low: 107.5, close: 108.0, volume: 1000 };
    const result = computeVwapReversionSignal([...baseline, spike], VWAP_PERIOD, ATR_PERIOD, MULTIPLIER);
    expect(result.signal).toBe("SELL");
    expect(result.vwap).toBeCloseTo(101.6, 10);
    expect(result.atr).toBeCloseTo(1.75, 10);
  });

  it("returns HOLD when close stays inside the band", () => {
    const result = computeVwapReversionSignal([...baseline, { ...FLAT, time: 1 }], VWAP_PERIOD, ATR_PERIOD, MULTIPLIER);
    expect(result.signal).toBe("HOLD");
    expect(result.vwap).toBeCloseTo(100.0, 10);
    expect(result.atr).toBeCloseTo(1.0, 10);
  });

  it("returns HOLD with a null vwap when any candle in the window lacks volume", () => {
    // A broker that reports candles but no volume must not silently produce a
    // signal from a fabricated weighting — vwap() returns null and the
    // strategy holds. ATR is still computable, so it stays non-null.
    const noVolume: Candle = { time: 1, open: 92, high: 92.5, low: 91.5, close: 92.0 };
    const result = computeVwapReversionSignal([...baseline, noVolume], VWAP_PERIOD, ATR_PERIOD, MULTIPLIER);
    expect(result.signal).toBe("HOLD");
    expect(result.vwap).toBeNull();
    expect(result.atr).toBeCloseTo(1.75, 10);
  });

  it("returns HOLD with null indicators when there aren't enough candles to warm up", () => {
    const result = computeVwapReversionSignal(baseline.slice(0, 3), VWAP_PERIOD, ATR_PERIOD, MULTIPLIER);
    expect(result.signal).toBe("HOLD");
    expect(result.vwap).toBeNull();
    expect(result.atr).toBeNull();
  });
});

describe("vwapReversionRequiredBars", () => {
  it("takes the larger of vwapPeriod and atrPeriod+1, plus a 5-bar margin", () => {
    expect(vwapReversionRequiredBars(20, 14)).toBe(20 + 5);
    expect(vwapReversionRequiredBars(5, 14)).toBe(15 + 5);
  });
});
