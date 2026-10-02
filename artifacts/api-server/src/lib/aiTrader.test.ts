import { describe, it, expect, vi } from "vitest";

// The Anthropic client throws at import time when its base URL is unset, which
// it is in tests. Stubbed because describeStrategy builds a string and calls
// nothing — the point of testing it separately from the request.
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: {} }));

const { describeStrategy } = await import("./aiTrader");
type SignalReviewInput = Parameters<typeof describeStrategy>[0];

/**
 * The guard's prompt used to say "a moving-average crossover strategy" for
 * every signal, whatever had actually produced it. Between 1 and 2 Oct 2026
 * that vetoed 35 of 35 mean-reversion entries — every one for "price is below
 * both moving averages", which is exactly what mean-reversion waits for — and
 * the engine placed no trade for a week.
 */
const input = (patch: Partial<SignalReviewInput> = {}): SignalReviewInput => ({
  ticker: "AAPL",
  side: "BUY",
  price: 330,
  shortMa: 330.92,
  longMa: 331.12,
  shortPeriod: 9,
  longPeriod: 21,
  account: null,
  positions: [],
  strategy: "trend_following",
  regime: "trending",
  adx: 30,
  rsi: null,
  ...patch,
});

describe("describeStrategy", () => {
  it("never calls a mean-reversion signal a crossover", () => {
    const text = describeStrategy(input({ strategy: "mean_reversion", regime: "ranging" }));
    expect(text).toMatch(/MEAN-REVERSION/);
    expect(text.toLowerCase()).not.toContain("crossover strategy");
  });

  it("tells the reviewer that price beyond the averages is the setup, not a fault", () => {
    const text = describeStrategy(input({ strategy: "mean_reversion" }));
    expect(text).toMatch(/SETUP for this strategy, not a contradiction/);
  });

  it("still states the crossover rule for a trend-following signal", () => {
    const text = describeStrategy(input({ strategy: "trend_following" }));
    expect(text).toMatch(/MOVING-AVERAGE CROSSOVER/);
    expect(text).toMatch(/short MA above the long MA/);
  });

  it("describes a scalp signal as fading a stretched move", () => {
    const text = describeStrategy(input({ strategy: "scalp", regime: null }));
    expect(text).toMatch(/scalp/i);
    expect(text).toMatch(/EMA/);
    expect(text.toLowerCase()).not.toContain("crossover strategy");
  });

  it("names the side and ticker it was actually given", () => {
    const text = describeStrategy(input({ strategy: "mean_reversion", side: "SELL", ticker: "GOLD" }));
    expect(text).toContain("SELL");
    expect(text).toContain("GOLD");
  });
});
