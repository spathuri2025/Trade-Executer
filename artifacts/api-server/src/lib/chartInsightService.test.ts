import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: {} }));

const { volumeSummary } = await import("./chartInsightService");

const bars = (...volumes: Array<number | undefined>) => volumes.map((volume) => ({ volume }));

describe("volumeSummary", () => {
  it("compares the latest bar against the ones before it", () => {
    const v = volumeSummary(bars(100, 100, 100, 100, 200));
    expect(v).toEqual({ latest: 200, average: 100, ratio: 2 });
  });

  it("excludes the latest bar from the average, so a spike still reads as a spike", () => {
    // Including it would drag the average up and understate the move.
    const v = volumeSummary(bars(100, 100, 1000));
    expect(v?.average).toBe(100);
    expect(v?.ratio).toBe(10);
  });

  it("reports a quiet bar as below average", () => {
    const v = volumeSummary(bars(100, 100, 100, 60));
    expect(v?.ratio).toBeCloseTo(0.6, 10);
  });

  it("returns null when the broker reports no volume at all", () => {
    // Trading 212 supplies none. Null is "unknown", which is not zero.
    expect(volumeSummary(bars(undefined, undefined, undefined))).toBeNull();
  });

  it("returns null when only the latest bar lacks volume", () => {
    expect(volumeSummary(bars(100, 100, undefined))).toBeNull();
  });

  it("keeps a genuine zero-volume bar as an observation, not as missing data", () => {
    const v = volumeSummary(bars(100, 100, 0));
    expect(v).toEqual({ latest: 0, average: 100, ratio: 0 });
  });

  it("ignores gaps in the prior bars rather than treating them as zero", () => {
    const v = volumeSummary(bars(100, undefined, 100, 50));
    expect(v?.average).toBe(100);
  });

  it("returns null with nothing to compare against", () => {
    expect(volumeSummary(bars(100))).toBeNull();
    expect(volumeSummary([])).toBeNull();
  });
});
