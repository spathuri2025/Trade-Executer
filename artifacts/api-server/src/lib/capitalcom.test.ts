import { describe, it, expect } from "vitest";
import { minStopDistancePercent } from "./capitalcom";

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
