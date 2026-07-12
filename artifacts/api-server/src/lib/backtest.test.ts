import { describe, it, expect } from "vitest";
import { backtestStrategy, backtestAtrMomentum } from "./backtest";
import type { Candle } from "./capitalcom";

describe("backtestStrategy — next-bar-fill (no look-ahead)", () => {
  // 36 flat bars at 100 (satisfies the 34-bar warmup with margin and keeps
  // both MAs flat/equal, so no spurious signal fires during warmup), then a
  // one-bar spike to 200 at index 36 — computeMASignal fires a clean BUY
  // exactly at i=36 (verified by hand: shortMa 133.33 > longMa 120.00, with
  // shortPrev==longPrev==100 the bar before). Index 37 jumps again to 300,
  // deliberately a DIFFERENT price than the signal bar, so a same-bar fill
  // (the bug) and a next-bar fill (the fix) produce numerically distinct,
  // easily distinguishable results. The remaining bars stay flat at 300 so
  // no further crossover fires and the position rides unchanged to the end.
  const prices = [...Array(36).fill(100), 200, 300, ...Array(12).fill(300)];

  it("fills the entry at the NEXT bar's close, not the signal bar's own close", () => {
    const result = backtestStrategy(prices, 3, 5, "trend_following", 0);
    expect(result).not.toBeNull();
    if (!result) return;

    // Old (buggy) same-bar-fill behavior would enter at index 36's price
    // (200) and ride the 200→300 jump as if it had been held the whole way,
    // producing totalReturnPct ≈ +50%. The fix enters at index 37's price
    // (300) instead — the position is opened exactly at 300 and everything
    // after is flat, so the correct return is ≈ 0%, not ≈ +50%.
    expect(result.totalTrades).toBe(1);
    expect(result.wins).toBe(1);
    expect(result.losses).toBe(0);
    expect(Math.abs(result.avgWinPct)).toBeLessThan(0.001);
    expect(Math.abs(result.totalReturnPct)).toBeLessThan(0.001);
  });

  it("still lets the strategy decide using the signal bar's own close (only the fill is deferred)", () => {
    // If the strategy couldn't see index 36's close when deciding, no BUY
    // would ever fire at all (the crossover is only visible once bar 36's
    // 200 print is included in the window) — asserting exactly one trade
    // happened (rather than zero) proves the decision still uses bar i's
    // data even though the fill itself waits for bar i+1.
    const result = backtestStrategy(prices, 3, 5, "trend_following", 0);
    expect(result?.totalTrades).toBe(1);
  });

  it("applies round-trip cost on the deferred fill exactly once", () => {
    const withCost = backtestStrategy(prices, 3, 5, "trend_following", 0.01);
    expect(withCost).not.toBeNull();
    if (!withCost) return;
    expect(withCost.totalTrades).toBe(1);
    // Entry and exit both land at 300 (flat after the jump), so the only
    // drag on return is the single round-trip cost deducted once in book().
    expect(withCost.totalReturnPct).toBeCloseTo(-0.01, 3);
  });
});

describe("backtestAtrMomentum — shares the same next-bar-fill engine", () => {
  // 20 flat candles (tight range, EMA/ATR params match atrMomentumStrategy.test.ts's
  // verified BUY case) so a clean breakout fires exactly once, then a further
  // jump to a DIFFERENT price on the very next candle — same technique as
  // backtestStrategy's spike-to-200-then-300 case above, adapted to OHLC. A
  // same-bar fill (the bug) would enter at the breakout candle's close (108)
  // and ride the 108→130→140 move; the fix enters at the NEXT candle's close
  // (130) instead, so the correct return is (140-130)/130 ≈ +7.69%, not the
  // much larger (140-108)/108 ≈ +29.6% a look-ahead bug would produce.
  const flat: Candle = { time: 0, open: 100, high: 100.5, low: 99.5, close: 100.0 };
  const candles: Candle[] = [
    ...Array.from({ length: 20 }, () => ({ ...flat })),
    { time: 20, open: 108, high: 108.5, low: 107.5, close: 108.0 },
    { time: 21, open: 130, high: 130.5, low: 129.5, close: 130.0 },
    ...Array.from({ length: 4 }, (_, i) => ({ time: 22 + i, open: 140, high: 140.5, low: 139.5, close: 140.0 })),
  ];
  const EMA_PERIOD = 5;
  const ATR_PERIOD = 10;
  const MULTIPLIER = 1.5;

  it("fills the entry at the NEXT candle's close, not the breakout candle's own close", () => {
    const result = backtestAtrMomentum(candles, EMA_PERIOD, ATR_PERIOD, MULTIPLIER, 0);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.strategy).toBe("atr_momentum");
    expect(result.totalTrades).toBe(1);
    expect(result.wins).toBe(1);
    expect(result.losses).toBe(0);
    expect(result.avgWinPct).toBeCloseTo(0.07692307692307693, 8);
    expect(result.totalReturnPct).toBeCloseTo(0.07692307692307693, 8);
    expect(result.maxDrawdownPct).toBe(0);
    expect(result.profitFactor).toBeNull();
  });

  it("applies round-trip cost on the deferred fill exactly once", () => {
    const withCost = backtestAtrMomentum(candles, EMA_PERIOD, ATR_PERIOD, MULTIPLIER, 0.01);
    expect(withCost).not.toBeNull();
    if (!withCost) return;
    expect(withCost.totalTrades).toBe(1);
    expect(withCost.totalReturnPct).toBeCloseTo(0.06615384615384601, 8);
  });

  it("returns null when there are not enough candles to warm up", () => {
    const result = backtestAtrMomentum(candles.slice(0, 10), EMA_PERIOD, ATR_PERIOD, MULTIPLIER, 0);
    expect(result).toBeNull();
  });
});
