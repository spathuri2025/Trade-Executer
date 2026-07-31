import { describe, it, expect } from "vitest";
import { ema, atr, vwap } from "./indicators";

describe("ema", () => {
  it("seeds with an SMA of the first `period` values then rolls forward", () => {
    // Hand-verified: seed = mean(1,2,3) = 2; k = 2/4 = 0.5.
    // roll 4: 4*0.5 + 2*0.5 = 3; roll 5: 5*0.5 + 3*0.5 = 4.
    expect(ema([1, 2, 3, 4, 5], 3)).toBeCloseTo(4.0, 10);
  });

  it("returns null when there are fewer values than the period", () => {
    expect(ema([1, 2], 3)).toBeNull();
  });
});

describe("atr", () => {
  it("Wilder-smooths true range over OHLC arrays", () => {
    // Hand-verified in Python against this exact recurrence: true ranges for
    // i=1..4 are [3, 2, 3, 3]; seed (period=2) = mean(3,2) = 2.5; roll i=2
    // (tr=3): (2.5*1 + 3)/2 = 2.75; roll i=3 (tr=3): (2.75*1 + 3)/2 = 2.875.
    const high = [10, 12, 11, 13, 14];
    const low = [8, 9, 9, 10, 11];
    const close = [9, 11, 10, 12, 13];
    expect(atr(high, low, close, 2)).toBeCloseTo(2.875, 10);
  });

  it("returns null when the high/low/close arrays have mismatched lengths", () => {
    expect(atr([1, 2], [1], [1, 2], 1)).toBeNull();
  });

  it("returns null when there are not enough bars to seed and smooth", () => {
    expect(atr([1, 2], [1, 2], [1, 2], 5)).toBeNull();
  });
});

describe("vwap", () => {
  it("weights each bar's typical price by that bar's volume", () => {
    // Hand-verified in Python: typical prices are (11+9+10)/3=10,
    // (12+10+11)/3=11, (13+11+12)/3=12; weighted by 100/200/300 →
    // (10·100 + 11·200 + 12·300) / 600 = 11.333…
    const high = [11, 12, 13];
    const low = [9, 10, 11];
    const close = [10, 11, 12];
    const volume = [100, 200, 300];
    expect(vwap(high, low, close, volume, 3)).toBeCloseTo(11.333333333333334, 10);
  });

  it("only considers the last `period` bars (rolling window, not cumulative)", () => {
    // The leading bar has a huge price and volume; with period=2 it must be
    // excluded entirely, proving the window rolls rather than accumulating
    // from the start of the series (the session-VWAP behaviour we do NOT have).
    const high = [100, 11, 12, 13];
    const low = [100, 10, 11, 11];
    const close = [100, 11, 12, 12];
    const volume = [9999, 200, 300, 300];
    expect(vwap(high, low, close, volume, 2)).toBeCloseTo(11.833333333333334, 10);
  });

  it("returns null on mismatched array lengths", () => {
    expect(vwap([1, 2], [1], [1, 2], [1, 2], 2)).toBeNull();
  });

  it("returns null when there are fewer bars than the period", () => {
    expect(vwap([1, 2], [1, 2], [1, 2], [1, 2], 5)).toBeNull();
  });

  it("returns null when any volume in the window is missing", () => {
    // Candle.volume is optional (brokers other than Capital.com don't report
    // it), so this is the realistic "no volume data" path, not an edge case.
    expect(vwap([11, 12, 13], [9, 10, 11], [10, 11, 12], [100, undefined, 300], 3)).toBeNull();
  });

  it("returns null when total window volume is zero rather than dividing by zero", () => {
    expect(vwap([11, 12, 13], [9, 10, 11], [10, 11, 12], [0, 0, 0], 3)).toBeNull();
  });
});
