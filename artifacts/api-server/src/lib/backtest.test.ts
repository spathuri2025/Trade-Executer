import { describe, it, expect } from "vitest";
import { backtestStrategy } from "./backtest";

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
