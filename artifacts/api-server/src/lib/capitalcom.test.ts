import { describe, it, expect } from "vitest";
import { minStopDistancePercent, transactionWindows, mergeTransactionWindows } from "./capitalcom";
import type { BrokerTransaction } from "./livePerformance";

/**
 * Capital.com publishes the minimum stop/take-profit distance in the same
 * /markets response the engine already fetches, in one of two units.
 */
describe("minStopDistancePercent", () => {
  it("takes a percentage as it stands", () => {
    expect(minStopDistancePercent({ unit: "PERCENTAGE", value: 0.57 }, 140.67)).toBeCloseTo(0.57, 10);
  });

  it("converts points using the price", () => {
    // 0.80 points on a 140.67 price is 0.569%.
    expect(minStopDistancePercent({ unit: "POINTS", value: 0.8 }, 140.67)).toBeCloseTo(0.5687, 4);
  });

  it("cannot convert points without a price, and says so rather than guessing", () => {
    expect(minStopDistancePercent({ unit: "POINTS", value: 0.8 }, null)).toBeNull();
    expect(minStopDistancePercent({ unit: "POINTS", value: 0.8 }, 0)).toBeNull();
  });

  it("returns null for an unrecognised unit", () => {
    // Guessing wrong in one direction blocks trades that are fine, and in the
    // other lets through orders the broker rejects. Unknown is honest.
    expect(minStopDistancePercent({ unit: "BANANAS", value: 1 }, 100)).toBeNull();
  });

  it("returns null when the rule is missing or malformed", () => {
    expect(minStopDistancePercent(undefined, 100)).toBeNull();
    expect(minStopDistancePercent({}, 100)).toBeNull();
    expect(minStopDistancePercent({ unit: "PERCENTAGE" }, 100)).toBeNull();
    expect(minStopDistancePercent({ unit: "PERCENTAGE", value: -1 }, 100)).toBeNull();
  });
});

describe("transaction history in daily windows", () => {
  // 23 Oct 2026: one request for 30 days returned only the newest 38 closes
  // (back to 13 Oct). The morning report's month was a week and a half.
  const day = 24 * 60 * 60 * 1000;

  it("cuts a month into consecutive one-day windows that share their edges", () => {
    const from = new Date("2026-09-23T07:00:00Z");
    const to = new Date("2026-10-23T07:00:00Z");
    const w = transactionWindows(from, to);
    expect(w).toHaveLength(30);
    expect(w[0]![0]).toEqual(from);
    expect(w[29]![1]).toEqual(to);
    for (let i = 1; i < w.length; i++) expect(w[i]![0]).toEqual(w[i - 1]![1]);
    expect(w.every(([a, b]) => b.getTime() - a.getTime() <= day)).toBe(true);
  });

  it("ends the last window at `to`, not a whole day later", () => {
    const w = transactionWindows(new Date("2026-10-22T00:00:00Z"), new Date("2026-10-23T06:00:00Z"));
    expect(w).toHaveLength(2);
    expect(w[1]![1]).toEqual(new Date("2026-10-23T06:00:00Z"));
  });

  const tx = (dateUtc: string, size: string, reference = "r"): BrokerTransaction => ({
    dateUtc, instrumentName: "Crude Oil Spot", transactionType: "SWAP", note: "Overnight funding adjustment", size, currency: "GBP", reference,
  });

  it("drops a row returned twice at the shared edge", () => {
    const edge = new Date("2026-10-17T00:00:00Z");
    const merged = mergeTransactionWindows([
      { to: edge, rows: [tx("2026-10-16T21:00:00.000", "-1"), tx("2026-10-17T00:00:00.000", "-2", "x")] },
      { to: new Date("2026-10-18T00:00:00Z"), rows: [tx("2026-10-17T00:00:00.000", "-2", "x"), tx("2026-10-17T21:00:00.000", "-3")] },
    ]);
    expect(merged.map((r) => r.size)).toEqual(["-1", "-2", "-3"]);
  });

  it("keeps identical rows inside one window — four positions, four charges", () => {
    const four = [1, 2, 3, 4].map(() => tx("2026-10-16T21:00:00.000", "-15.54"));
    expect(mergeTransactionWindows([{ to: new Date("2026-10-17T00:00:00Z"), rows: four }])).toHaveLength(4);
  });

  it("keeps a same-looking row in the next window when it is not at the edge", () => {
    const merged = mergeTransactionWindows([
      { to: new Date("2026-10-17T00:00:00Z"), rows: [tx("2026-10-16T21:00:00.000", "-15.54")] },
      { to: new Date("2026-10-18T00:00:00Z"), rows: [tx("2026-10-16T21:00:00.000", "-15.54")] },
    ]);
    expect(merged).toHaveLength(2);
  });
});
