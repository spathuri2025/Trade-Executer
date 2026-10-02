import { describe, it, expect } from "vitest";
import { searchInstruments } from "./instrumentSearch";

/**
 * Deliberately ordered so that array order CONTRADICTS the ranking every test
 * asserts: the mini contract and Goldman Sachs come before the spot markets,
 * and Brent before WTI. Without this the tests passed with the sort deleted —
 * the fixture was doing the ranking's job.
 */
const universe = [
  { epic: "GS", instrumentName: "Goldman Sachs Group Inc", instrumentType: "SHARES" },
  { epic: "GOLD_MINI_JUN26", instrumentName: "Gold Spot Mini Jun 26", instrumentType: "COMMODITIES" },
  { epic: "OIL_BRENT", instrumentName: "Brent Crude Oil Spot", instrumentType: "COMMODITIES" },
  { epic: "OIL_CRUDE", instrumentName: "Crude Oil Spot", instrumentType: "COMMODITIES" },
  { epic: "GOLD", instrumentName: "Gold Spot", instrumentType: "COMMODITIES" },
  { epic: "AAPL", instrumentName: "Apple Inc", instrumentType: "SHARES" },
];

describe("searchInstruments", () => {
  it("finds crude oil by its name, which is the whole point", () => {
    // 2 Oct 2026: "Crude Oil Spot" could not be added because the field needs
    // the epic OIL_CRUDE, and nothing in the product said so.
    const hits = searchInstruments(universe, "crude oil");
    expect(hits[0]?.epic).toBe("OIL_CRUDE");
    expect(hits.map((h) => h.epic)).toContain("OIL_BRENT");
  });

  it("puts an exact epic match first", () => {
    expect(searchInstruments(universe, "GOLD")[0]?.epic).toBe("GOLD");
  });

  it("prefers the spot market over a dated contract", () => {
    // Shorter name wins the tie, so "Gold Spot" beats "Gold Spot Mini Jun 26".
    const hits = searchInstruments(universe, "gold spot");
    expect(hits[0]?.epic).toBe("GOLD");
  });

  it("does not let a share outrank the commodity someone asked for", () => {
    expect(searchInstruments(universe, "gold")[0]?.epic).toBe("GOLD");
  });

  it("ranks the shorter name first when two matches score the same", () => {
    // Searching "gold": both "Gold Spot Mini Jun 26" and "Goldman Sachs Group
    // Inc" are name-prefix matches, so only length separates them. Without the
    // tiebreak the catalogue's own order decides, which is arbitrary.
    const hits = searchInstruments(universe, "gold").map((h) => h.epic);
    expect(hits.indexOf("GOLD_MINI_JUN26")).toBeLessThan(hits.indexOf("GS"));
  });

  it("is case and whitespace insensitive", () => {
    expect(searchInstruments(universe, "  ApPlE  ")[0]?.epic).toBe("AAPL");
  });

  it("returns nothing for an empty query rather than the whole catalogue", () => {
    expect(searchInstruments(universe, "   ")).toEqual([]);
  });

  it("returns the asset class, so the class exposure cap can be explained up front", () => {
    expect(searchInstruments(universe, "crude oil")[0]?.instrumentType).toBe("COMMODITIES");
  });

  it("skips rows with no epic, which cannot be traded", () => {
    const hits = searchInstruments([{ epic: "", instrumentName: "Mystery", instrumentType: "X" }], "mystery");
    expect(hits).toEqual([]);
  });

  it("honours the limit", () => {
    expect(searchInstruments(universe, "o", 2)).toHaveLength(2);
  });
});
