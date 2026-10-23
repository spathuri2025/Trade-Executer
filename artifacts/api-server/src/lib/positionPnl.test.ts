import { describe, it, expect } from "vitest";
import { capitalPositionPnl } from "./positionPnl";

// 23 Oct 2026, from the user's Capital.com screen: OIL_CRUDE short, 200 units
// at 92.501, closing price 100.648, broker P&L −£1,217.68.
const short = { direction: "SELL" as const, level: 92.501, size: 200, contractSize: 1, currency: "USD" };
const market = { bid: 100.62, offer: 100.648 };

describe("capitalPositionPnl", () => {
  it("shows a losing short as a LOSS", () => {
    // The app showed this position as +£1,632.40 — a long's arithmetic.
    const r = capitalPositionPnl(short, market);
    expect(r.pnl).toBeCloseTo(-(100.648 - 92.501) * 200, 6);
    expect(r.pnlPercent).toBeLessThan(0);
  });

  it("prices a short at the offer and a long at the bid — what each would close at", () => {
    expect(capitalPositionPnl(short, market).currentPrice).toBe(100.648);
    expect(capitalPositionPnl({ ...short, direction: "BUY" }, market).currentPrice).toBe(100.62);
  });

  it("shows a winning short as a gain", () => {
    const r = capitalPositionPnl(short, { bid: 89.98, offer: 90 });
    expect(r.pnl).toBeCloseTo((92.501 - 90) * 200, 6);
    expect(r.pnlPercent).toBeGreaterThan(0);
  });

  it("uses the broker's own figure, in the account's currency, when it agrees in sign", () => {
    const r = capitalPositionPnl({ ...short, upl: -1217.68 }, market);
    expect(r.pnl).toBe(-1217.68);
    expect(r.pnlCurrency).toBeNull(); // account currency
  });

  it("refuses a broker figure that contradicts the price move, and labels the fallback in the instrument's currency", () => {
    // A positive figure on a short the price has run against cannot be right.
    const r = capitalPositionPnl({ ...short, upl: 1632.4 }, market);
    expect(r.pnl).toBeLessThan(0);
    expect(r.pnlCurrency).toBe("USD");
  });

  it("labels a computed figure in the instrument's currency, never the account's", () => {
    // Dollars printed with a £ sign was the second half of the bug.
    expect(capitalPositionPnl(short, market).pnlCurrency).toBe("USD");
  });

  it("applies the contract size", () => {
    const r = capitalPositionPnl({ direction: "BUY", level: 100, size: 2, contractSize: 10 }, { bid: 101, offer: 101.1 });
    expect(r.pnl).toBeCloseTo(20, 6);
  });
});
