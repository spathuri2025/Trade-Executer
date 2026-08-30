import { describe, it, expect } from "vitest";
import { computeScalpSignal, scalpRequiredBars, SCALP_PARAMS } from "./scalpStrategy";
import type { Candle } from "./capitalcom";

/** Flat series with a controllable final close and a fixed true range. */
function series(finalClose: number, base = 100, range = 1): Candle[] {
  const n = scalpRequiredBars() + 5;
  const candles: Candle[] = [];
  for (let i = 0; i < n - 1; i++) {
    candles.push({ time: i, open: base, high: base + range / 2, low: base - range / 2, close: base });
  }
  candles.push({
    time: n - 1,
    open: base,
    high: Math.max(base, finalClose) + range / 2,
    low: Math.min(base, finalClose) - range / 2,
    close: finalClose,
  });
  return candles;
}

describe("computeScalpSignal", () => {
  it("holds while price sits near the anchor", () => {
    expect(computeScalpSignal(series(100)).signal).toBe("HOLD");
  });

  it("buys a stretch below the anchor and sells a stretch above", () => {
    // A flat series has a small ATR, so a few points away is many ATRs out.
    expect(computeScalpSignal(series(95)).signal).toBe("BUY");
    expect(computeScalpSignal(series(105)).signal).toBe("SELL");
  });

  it("reports the expected move as a fraction of price — the number the cost gate needs", () => {
    // Without a move estimate there is nothing to weigh the spread against,
    // which is why this strategy exists rather than reusing mean_reversion.
    const s = computeScalpSignal(series(95));
    expect(s.signal).toBe("BUY");
    // Anchor sits near 100, price 95 → roughly 5% of price back to the anchor.
    expect(s.expectedMovePct).toBeGreaterThan(0.03);
    expect(s.expectedMovePct).toBeLessThan(0.07);
  });

  it("reports no expected move on HOLD", () => {
    expect(computeScalpSignal(series(100)).expectedMovePct).toBe(0);
  });

  it("returns no signal without enough candles to warm the indicators", () => {
    const short = series(95).slice(0, 5);
    expect(computeScalpSignal(short).signal).toBe("HOLD");
    expect(computeScalpSignal(short).ema).toBeNull();
  });

  it("refuses rather than fabricating an edge on bad data", () => {
    // A zero ATR would divide the distance by nothing; a non-positive price
    // makes the percentage meaningless. Both must produce no signal.
    const flatNoRange = series(100, 100, 0);
    expect(computeScalpSignal(flatNoRange).signal).toBe("HOLD");
    expect(computeScalpSignal(flatNoRange).expectedMovePct).toBe(0);
  });

  it("needs more bars than the longest indicator it uses", () => {
    expect(scalpRequiredBars()).toBeGreaterThan(Math.max(SCALP_PARAMS.emaPeriod, SCALP_PARAMS.atrPeriod));
  });
});
