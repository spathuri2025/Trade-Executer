import { describe, it, expect, vi } from "vitest";

vi.mock("./broker", () => ({
  getBrokerPriceHistory: vi.fn(),
  getBrokerCandles: vi.fn(),
  getBrokerQuote: vi.fn(),
}));
vi.mock("./logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { summarise, MIN_TRADES_PER_WINDOW } = await import("./backtestSweep");
import type { SweepCombo } from "./backtestSweep";

/** A combo with the trade counts and expectancies the test cares about. */
function combo(inExp: number, outExp: number, trades = MIN_TRADES_PER_WINDOW): SweepCombo {
  const w = (expectancyPct: number) => ({
    trades,
    winRate: 0.5,
    expectancyPct,
    totalReturnPct: expectancyPct * trades,
    maxDrawdownPct: 0.1,
  });
  const hasEnoughTrades = trades >= MIN_TRADES_PER_WINDOW;
  return {
    ticker: "AAA",
    name: "Test",
    resolution: "HOUR",
    strategy: "trend_following",
    params: "MA 9/21",
    costPct: 0.0005,
    bars: 1000,
    inSample: w(inExp),
    outOfSample: w(outExp),
    hasEnoughTrades,
    robust: hasEnoughTrades && inExp > 0 && outExp > 0,
  };
}

describe("summarise — the verdict must not mistake noise for an edge", () => {
  it("calls a coin-flip result no better than chance", () => {
    // Half the combos hold up out of sample — exactly what a strategy with no
    // edge produces. The best row will still look good; that is the trap.
    const combos = [
      ...Array.from({ length: 10 }, () => combo(0.002, 0.002)),
      ...Array.from({ length: 10 }, () => combo(0.002, -0.002)),
    ];
    const s = summarise(combos);
    expect(s.outOfSamplePositiveRate).toBeCloseTo(0.5, 2);
    expect(s.verdict).toBe("weak");
    expect(s.verdictText).toMatch(/chance/i);
  });

  it("reports no edge when most combinations lose out of sample", () => {
    const combos = [
      ...Array.from({ length: 3 }, () => combo(0.003, 0.001)),
      ...Array.from({ length: 17 }, () => combo(0.003, -0.001)),
    ];
    const s = summarise(combos);
    expect(s.verdict).toBe("no-edge");
    expect(s.medianOutOfSampleExpectancy).toBeLessThan(0);
  });

  it("only says 'worth forward-testing' when the rate beats chance AND the median is positive", () => {
    const combos = [
      ...Array.from({ length: 16 }, () => combo(0.003, 0.002)),
      ...Array.from({ length: 4 }, () => combo(0.003, -0.001)),
    ];
    const s = summarise(combos);
    expect(s.outOfSamplePositiveRate).toBeGreaterThanOrEqual(0.6);
    expect(s.medianOutOfSampleExpectancy).toBeGreaterThan(0);
    expect(s.verdict).toBe("worth-forward-testing");
  });

  it("refuses to judge on too few well-sampled combinations", () => {
    // A handful of thin-sample combos is how a sweep flatters itself.
    const combos = Array.from({ length: 5 }, () => combo(0.01, 0.01));
    const s = summarise(combos);
    expect(s.verdict).toBe("insufficient-data");
  });

  it("excludes under-traded combinations from every conclusion", () => {
    // 40 combos, but only 4 have enough trades — the verdict must be based on
    // those 4 (and therefore refuse), not on the flattering 36.
    const combos = [
      ...Array.from({ length: 36 }, () => combo(0.05, 0.05, 3)),
      ...Array.from({ length: 4 }, () => combo(0.001, -0.001)),
    ];
    const s = summarise(combos);
    expect(s.combosTested).toBe(40);
    expect(s.combosWithEnoughTrades).toBe(4);
    expect(s.verdict).toBe("insufficient-data");
    expect(s.robustCount).toBe(0);
  });

  it("counts a combination robust only when it is positive in BOTH windows", () => {
    const combos = [combo(0.002, 0.002), combo(0.002, -0.002), combo(-0.002, 0.002)];
    expect(summarise(combos).robustCount).toBe(1);
  });

  it("reports the median, so a few spectacular rows cannot hide a losing distribution", () => {
    const combos = [
      combo(0.05, 0.05), // two outstanding rows...
      combo(0.05, 0.05),
      ...Array.from({ length: 18 }, () => combo(-0.001, -0.001)), // ...and a losing body
    ];
    const s = summarise(combos);
    expect(s.medianOutOfSampleExpectancy).toBeLessThan(0);
    expect(s.verdict).toBe("no-edge");
  });
});

describe("history depth — the first sweep's blind spot", () => {
  it("fetches candles once per instrument/timeframe instead of prices and candles separately", async () => {
    // The MA strategies need closes and the candle strategies need OHLC, but
    // closes ARE the candles' close field — two requests fetched identical
    // data. This pins the single-fetch shape.
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(new URL("./backtestSweep.ts", import.meta.url), "utf8");
    expect(src).toMatch(/getBrokerCandlesPaged/);
    expect(src).not.toMatch(/getBrokerPriceHistory/);
  });

  it("targets enough history for low-frequency strategies to reach the sample floor", async () => {
    // On 1000 bars, mean reversion averaged 2.4 out-of-sample trades against a
    // 15-trade floor — it could never be judged at all. The target must be far
    // above the depth that made three of four strategies untestable.
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(new URL("./backtestSweep.ts", import.meta.url), "utf8");
    const match = src.match(/const HISTORY_BARS = (\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(5000);
  });
});

describe("combination independence — non-independent rows must not inflate the sample", () => {
  it("sweeps MA pairs for trend-following only, since mean reversion ignores them", async () => {
    // computeMeanReversionSignal(prices) takes no MA periods — it is RSI +
    // Bollinger with fixed parameters. Running it once per MA pair produced
    // four near-identical rows per instrument (differing only by warm-up
    // offset) and counted them as four independent tests, turning seven real
    // observations into twenty-eight. Verified live: mean reversion returned
    // 136 rows but only 46 distinct outcomes, while trend-following returned
    // 136 rows and 136 distinct outcomes.
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(new URL("./backtestSweep.ts", import.meta.url), "utf8");

    // The MA loop must no longer iterate strategies.
    expect(src).not.toMatch(/for \(const strategy of \["trend_following", "mean_reversion"\]/);
    // Mean reversion is scored exactly once, outside the MA loop.
    const meanRevScores = src.match(/strategy: "mean_reversion"/g) ?? [];
    expect(meanRevScores).toHaveLength(1);
    // ...and labelled with the parameters it actually uses.
    expect(src).toMatch(/RSI \$\{STRATEGY_PARAMS\.rsiPeriod\}/);
  });
});

describe("chance baseline — more instruments means more false winners", () => {
  it("reports how many combinations luck alone would leave profitable", async () => {
    // Sweeping hundreds of instruments guarantees impressive-looking winners.
    // Showing the count next to "half of them" is what stops 84 winners from
    // reading as a discovery when 99 were expected by chance.
    const combos = [
      ...Array.from({ length: 30 }, () => combo(0.002, 0.002)),
      ...Array.from({ length: 70 }, () => combo(0.002, -0.002)),
    ];
    const s = summarise(combos);
    expect(s.combosWithEnoughTrades).toBe(100);
    expect(s.expectedPositiveByChance).toBe(50);
    expect(s.positiveOutOfSample).toBe(30); // well BELOW chance
    expect(s.verdict).toBe("no-edge");
  });

  it("counts only well-sampled combinations toward the baseline", async () => {
    const combos = [
      ...Array.from({ length: 40 }, () => combo(0.01, 0.01, 2)), // too few trades
      ...Array.from({ length: 20 }, () => combo(0.001, 0.001)),
    ];
    const s = summarise(combos);
    expect(s.expectedPositiveByChance).toBe(10);
  });
});

describe("sweep scopes", () => {
  it("trades depth for breadth on a market-wide run", async () => {
    // A universe sweep touches hundreds of instruments, so it must use fewer
    // timeframes, less history and slower pacing — otherwise it is thousands of
    // broker calls and a rate-limit ban.
    const { WATCHLIST_OPTIONS, UNIVERSE_OPTIONS } = await import("./backtestSweep");
    expect(UNIVERSE_OPTIONS.resolutions.length).toBeLessThan(WATCHLIST_OPTIONS.resolutions.length);
    expect(UNIVERSE_OPTIONS.historyBars).toBeLessThan(WATCHLIST_OPTIONS.historyBars);
    expect(UNIVERSE_OPTIONS.paceMs).toBeGreaterThan(WATCHLIST_OPTIONS.paceMs);
    // Still far above the 1000 bars that made three strategies untestable.
    expect(UNIVERSE_OPTIONS.historyBars).toBeGreaterThan(1000);
  });
});

describe("universe breadth — a shortfall must be visible, not inferred", () => {
  it("reports how many distinct instruments were actually scored", async () => {
    // A "whole market (150)" run once swept 2 instruments and reported "28
    // combinations", which reads like a small sweep rather than a broken one.
    // The instrument count makes the shortfall obvious at a glance.
    const mk = (ticker: string): SweepCombo => ({ ...combo(0.001, 0.001), ticker });
    const s = summarise([mk("EURUSD"), mk("EURUSD"), mk("USDJPY")]);
    expect(s.instrumentsTested).toBe(2);
    expect(s.combosTested).toBe(3);
  });

  it("does not filter the catalogue by whether a market is open right now", async () => {
    // marketStatus TRADEABLE means "open this second" and says nothing about
    // whether an instrument can be backtested — history is what a backtest
    // needs. Filtering on it deleted every stock market outside its session.
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(new URL("./capitalcom.ts", import.meta.url), "utf8");
    const universeFn = src.slice(src.indexOf("export async function getCapitalMarketUniverse"));
    const body = universeFn.slice(0, universeFn.indexOf("\n}"));
    expect(body).not.toMatch(/marketStatus === "TRADEABLE"/);
  });
});
