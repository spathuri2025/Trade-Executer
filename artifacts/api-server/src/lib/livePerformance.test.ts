import { describe, it, expect } from "vitest";
import { summariseTransactions, closeTypeFromNote, parseUtc, type BrokerTransaction } from "./livePerformance";

const row = (dateUtc: string, instrumentName: string, transactionType: string, note: string, size: string): BrokerTransaction => ({
  dateUtc,
  instrumentName,
  transactionType,
  note,
  size,
  currency: "GBP",
});

/** Monday 21 Sep 2026 as it appeared on the phone, plus the rows around it. */
const sept21 = [
  row("2026-09-21T15:40:10.000", "SpaceX", "TRADE", "Trade closed", "0.25"),
  row("2026-09-21T15:40:05.000", "Super Micro Computer, Inc.", "TRADE", "Trade closed", "0.14"),
  row("2026-09-21T13:32:00.000", "Planet Labs PBC", "TRADE", "Trade closed: take-profit", "0.46"),
  row("2026-09-21T09:07:26.000", "Super Micro Computer, Inc.", "TRADE", "Trade opened", "0"),
  row("2026-09-21T09:05:00.000", "Super Micro Computer, Inc.", "TRADE", "Trade closed: take-profit", "0.55"),
  row("2026-09-20T21:00:00.000", "Planet Labs PBC", "SWAP", "Overnight funding adjustment", "-0.03"),
  row("2026-09-18T19:10:00.000", "Planet Labs PBC", "TRADE", "Trade closed: stop-loss", "-0.40"),
  row("2026-09-17T10:00:00.000", "", "DEPOSIT", "Deposit", "2000"),
];

describe("summariseTransactions", () => {
  const s = summariseTransactions(sept21);

  it("counts closes only — an opening leg is not a trade", () => {
    expect(s.closedTrades).toBe(5);
    expect(s.wins).toBe(4);
    expect(s.losses).toBe(1);
    expect(s.winRate).toBe(0.8);
  });

  it("nets funding into the result, and leaves the deposit out entirely", () => {
    // 0.25 + 0.14 + 0.46 + 0.55 - 0.40 = 1.00, then -0.03 funding.
    expect(s.tradingResult).toBe(1);
    expect(s.funding).toBe(-0.03);
    expect(s.netResult).toBe(0.97);
  });

  it("reports average win against average loss — the numbers that decide whether size makes sense", () => {
    expect(s.averageWin).toBe(0.35);
    expect(s.averageLoss).toBe(-0.4);
    expect(s.profitFactor).toBe(3.5);
  });

  it("averages per trading day over days that actually had a close", () => {
    expect(s.tradingDays).toBe(2); // 21 Sep and 18 Sep
    expect(s.averagePerTradingDay).toBe(0.49);
  });

  it("totals each day, newest first, funding on the day it was charged", () => {
    expect(s.byDay[0]).toEqual({ date: "2026-09-21", net: 1.4, trades: 4 });
    expect(s.byDay.find((d) => d.date === "2026-09-20")).toEqual({ date: "2026-09-20", net: -0.03, trades: 0 });
  });

  it("ranks instruments worst first, so the problem shows at the top", () => {
    expect(s.byInstrument[0].instrumentName).toBe("Planet Labs PBC");
    expect(s.byInstrument[0].net).toBe(0.03); // 0.46 - 0.40 - 0.03
  });

  it("labels how each trade closed", () => {
    expect(s.recentTrades[0]).toMatchObject({ instrumentName: "SpaceX", closeType: "closed" });
    expect(s.recentTrades.find((t) => t.result === 0.46)?.closeType).toBe("take-profit");
    expect(s.recentTrades.find((t) => t.result === -0.4)?.closeType).toBe("stop-loss");
  });

  it("is empty and honest with no history", () => {
    const empty = summariseTransactions([]);
    expect(empty.closedTrades).toBe(0);
    expect(empty.winRate).toBeNull();
    expect(empty.averagePerTradingDay).toBeNull();
    expect(empty.netResult).toBe(0);
  });
});

describe("helpers", () => {
  it("reads Capital.com's zoneless dateUtc as UTC", () => {
    expect(parseUtc("2026-09-21T15:40:10.000").toISOString()).toBe("2026-09-21T15:40:10.000Z");
  });

  it("classifies close notes however the broker words them", () => {
    expect(closeTypeFromNote("Trade closed: take-profit")).toBe("take-profit");
    expect(closeTypeFromNote("Take Profit")).toBe("take-profit");
    expect(closeTypeFromNote("Trade closed: stop-loss")).toBe("stop-loss");
    expect(closeTypeFromNote("Trade closed")).toBe("closed");
  });
});
