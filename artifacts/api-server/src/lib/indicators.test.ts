import { describe, it, expect } from "vitest";
import { ema, atr } from "./indicators";

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
