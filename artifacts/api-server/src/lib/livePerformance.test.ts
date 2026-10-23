import { describe, it, expect } from "vitest";
import { summariseTransactions, closeTypeFromNote, parseUtc, cashFlowSince, transactionLabels, unitemisedSince, snapshotConsistent, pickSnapshotBaselines, type BrokerTransaction } from "./livePerformance";

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

  it("counts how trades ended, which is what says whether the exit levels do anything", () => {
    // Two take-profits, one stop-loss, two closed some other way.
    expect(s.exits).toEqual({ takeProfit: 2, stopLoss: 1, closedEarly: 2 });
    expect(s.exits.takeProfit + s.exits.stopLoss + s.exits.closedEarly).toBe(s.closedTrades);
  });

  it("reports the wording it could not classify, rather than silently bucketing it", () => {
    // 25 Sep 2026: the report said "0 stop-loss in 95 trades" while the broker
    // screen showed Silver closing at its stop price to the cent. The parser
    // was wrong, not the trading, and nothing in the output admitted it.
    const unknownWording = summariseTransactions([
      row("2026-09-21T15:00:00.000", "Silver", "TRADE", "Position closed by SL", "-0.58"),
      row("2026-09-21T15:10:00.000", "Silver", "TRADE", "Position closed by SL", "-0.60"),
      row("2026-09-21T15:20:00.000", "GOLD", "TRADE", "", "0.31"),
    ]);
    expect(unknownWording.exits).toEqual({ takeProfit: 0, stopLoss: 0, closedEarly: 3 });
    expect(unknownWording.unrecognisedCloseLabels).toEqual(["Position closed by SL", "(no label)"]);
  });

  it("reports nothing unrecognised when every label is understood", () => {
    expect(s.unrecognisedCloseLabels).toEqual(["Trade closed"]);
    const allKnown = summariseTransactions([
      row("2026-09-21T15:00:00.000", "GOLD", "TRADE", "Trade closed: stop-loss", "-0.5"),
      row("2026-09-21T15:10:00.000", "GOLD", "TRADE", "Trade closed: take-profit", "0.7"),
    ]);
    expect(allKnown.unrecognisedCloseLabels).toEqual([]);
  });

  it("records a withdrawal so the account can be reconciled, without counting it as performance", () => {
    // The week to 5 Oct 2026: +£243.61 realised against an account £537 lower.
    // A withdrawal explains it, and nothing in the report could show one.
    const withCash = summariseTransactions([
      row("2026-09-29T10:00:00.000", "GOLD", "TRADE", "Trade closed", "243.61"),
      row("2026-09-30T10:00:00.000", "", "WITHDRAWAL", "Withdrawal to bank", "-780.70"),
    ]);
    expect(withCash.otherMovements).toEqual([{ type: "WITHDRAWAL", total: -780.7 }]);
    // Money you moved is not trading performance, so it stays out of the result.
    expect(withCash.netResult).toBeCloseTo(243.61, 2);
    expect(withCash.closedTrades).toBe(1);
  });

  it("names a movement type it has never seen rather than dropping it", () => {
    const odd = summariseTransactions([
      row("2026-09-29T10:00:00.000", "", "CHARGEBACK_ADJUSTMENT", "Who knows", "-12.5"),
    ]);
    expect(odd.otherMovements).toEqual([{ type: "CHARGEBACK_ADJUSTMENT", total: -12.5 }]);
  });

  it("sums repeats of one type and orders by size", () => {
    const many = summariseTransactions([
      row("2026-09-29T10:00:00.000", "", "WITHDRAWAL", "x", "-100"),
      row("2026-09-29T11:00:00.000", "", "WITHDRAWAL", "x", "-50"),
      row("2026-09-29T12:00:00.000", "", "DEPOSIT", "x", "500"),
    ]);
    expect(many.otherMovements).toEqual([
      { type: "DEPOSIT", total: 500 },
      { type: "WITHDRAWAL", total: -150 },
    ]);
  });

  it("has no other movements when every row is a trade", () => {
    expect(s.otherMovements.some((m) => m.type === "DEPOSIT")).toBe(true); // the fixture has one
  });

  it("counts every close as early when none carries a label", () => {
    const plain = summariseTransactions([
      row("2026-09-21T15:00:00.000", "GOLD", "TRADE", "Trade closed", "0.10"),
      row("2026-09-21T15:05:00.000", "GOLD", "TRADE", "Trade closed", "-0.10"),
    ]);
    expect(plain.exits).toEqual({ takeProfit: 0, stopLoss: 0, closedEarly: 2 });
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

describe("cashFlowSince", () => {
  const at = (iso: string) => new Date(`${iso}Z`);

  it("counts a withdrawal as money out, not as a loss", () => {
    // 5 Oct 2026: a £1,000 withdrawal read as a £1,000 trading loss and halted
    // the bot, with the breaker reporting a daily loss that never happened.
    const rows = [row("2026-10-05T09:00:00.000", "", "WITHDRAWAL", "To bank", "-1000")];
    expect(cashFlowSince(rows, at("2026-10-05T00:00:00.000"))).toBe(-1000);
  });

  it("counts a deposit as money in", () => {
    const rows = [row("2026-10-05T09:00:00.000", "", "DEPOSIT", "From bank", "3500")];
    expect(cashFlowSince(rows, at("2026-10-05T00:00:00.000"))).toBe(3500);
  });

  it("ignores trades, funding and fees — those ARE performance", () => {
    const rows = [
      row("2026-10-05T09:00:00.000", "GOLD", "TRADE", "Trade closed", "250"),
      row("2026-10-05T09:30:00.000", "GOLD", "SWAP", "Overnight funding", "-9.91"),
      row("2026-10-05T09:40:00.000", "GOLD", "TRADE_COMMISSION", "Commission", "-2"),
    ];
    expect(cashFlowSince(rows, at("2026-10-05T00:00:00.000"))).toBe(0);
  });

  it("ignores movements before the baseline it is measuring from", () => {
    const rows = [
      row("2026-10-04T09:00:00.000", "", "WITHDRAWAL", "Yesterday", "-500"),
      row("2026-10-05T09:00:00.000", "", "WITHDRAWAL", "Today", "-1000"),
    ];
    expect(cashFlowSince(rows, at("2026-10-05T00:00:00.000"))).toBe(-1000);
  });

  it("nets a deposit against a withdrawal", () => {
    const rows = [
      row("2026-10-05T09:00:00.000", "", "DEPOSIT", "In", "3500"),
      row("2026-10-05T10:00:00.000", "", "WITHDRAWAL", "Out", "-1000"),
    ];
    expect(cashFlowSince(rows, at("2026-10-05T00:00:00.000"))).toBe(2500);
  });

  it("is zero when nothing moved", () => {
    expect(cashFlowSince([], at("2026-10-05T00:00:00.000"))).toBe(0);
  });
});

describe("money on open positions", () => {
  // A safeguard, not the oil adjustments: Capital.com's feed turned out not to
  // send those at all (checked 23 Oct 2026). The rule is that a row about an
  // open position which carries money is never discarded as an opening leg.
  const oct16 = [
    row("2026-10-16T20:59:00.000", "Crude Oil Spot", "TRADE", "Trade opened", "0"),
    row("2026-10-16T20:59:00.000", "Crude Oil Spot", "TRADE", "Price adjustment on open position", "-162.25"),
    row("2026-10-16T20:59:00.000", "Crude Oil Spot", "TRADE", "Price adjustment on open position", "-162.25"),
    row("2026-10-16T15:50:00.000", "Crude Oil Spot", "TRADE", "Trade closed", "42.00"),
    row("2026-10-16T21:00:00.000", "Crude Oil Spot", "SWAP", "Overnight funding adjustment", "-7.79"),
  ];
  const s = summariseTransactions(oct16);

  it("counts them as adjustments, not as trades and not as nothing", () => {
    expect(s.adjustments).toBeCloseTo(-324.5, 2);
    expect(s.closedTrades).toBe(1);
  });

  it("includes them in what the account actually made", () => {
    expect(s.netResult).toBeCloseTo(42 - 7.79 - 324.5, 2);
    expect(s.tradingResult).toBeCloseTo(42, 2); // trading itself unchanged
  });

  it("charges them to the day and the instrument", () => {
    expect(s.byDay[0]).toMatchObject({ date: "2026-10-16", trades: 1 });
    expect(s.byDay[0]!.net).toBeCloseTo(42 - 7.79 - 324.5, 2);
    expect(s.byInstrument.find((i) => i.instrumentName === "Crude Oil Spot")!.net).toBeCloseTo(42 - 7.79 - 324.5, 2);
  });

  it("still skips an empty opening leg", () => {
    expect(summariseTransactions([row("2026-10-16T09:00:00.000", "Gold", "TRADE", "Trade opened", "0")]).adjustments).toBe(0);
  });
});

describe("transactionLabels", () => {
  it("groups the feed by type and note, largest money first, and names blanks", () => {
    const labels = transactionLabels([
      row("2026-10-16T21:00:00.000", "Oil", "SWAP", "Overnight funding adjustment", "-7.79"),
      row("2026-10-16T21:00:00.000", "Oil", "SWAP", "Overnight funding adjustment", "-2.21"),
      row("2026-10-16T20:59:00.000", "Oil", "TRADE", "Price adjustment on open position", "-649"),
      row("2026-10-16T10:00:00.000", "", "", "", "5"),
    ]);
    expect(labels[0]).toEqual({ transactionType: "TRADE", note: "Price adjustment on open position", count: 1, total: -649 });
    expect(labels[1]).toEqual({ transactionType: "SWAP", note: "Overnight funding adjustment", count: 2, total: -10 });
    expect(labels[2]).toMatchObject({ transactionType: "(unlabelled)", note: "(no note)" });
  });
});

describe("unitemised balance movements", () => {
  // Week to 23 Oct 2026: the feed itemised closes and funding exactly, and the
  // export held −£696.32 of oil price adjustments the feed never sent. Only
  // the cash balance shows them.
  const then = { takenAt: new Date("2026-10-16T12:32:00Z"), cashBalance: 5000 };
  const feed = [
    row("2026-10-20T10:00:00.000", "Crude Oil Spot", "TRADE", "Trade closed", "2340.81"),
    row("2026-10-20T21:00:00.000", "Crude Oil Spot", "SWAP", "Overnight fee", "-52.55"),
    row("2026-10-21T09:00:00.000", "", "DEPOSIT", "Deposit", "1500"),
    row("2026-10-15T10:00:00.000", "Crude Oil Spot", "TRADE", "Trade closed", "999"), // before the snapshot
  ];

  it("is the change in cash minus everything the feed itemised since the snapshot", () => {
    const nowCash = 5000 + 2340.81 - 52.55 + 1500 - 696.32;
    expect(unitemisedSince(then, nowCash, feed)).toBeCloseTo(-696.32, 2);
  });

  it("is zero when the feed explains every pound", () => {
    expect(unitemisedSince(then, 5000 + 2340.81 - 52.55 + 1500, feed)).toBeCloseTo(0, 2);
  });

  it("trusts a snapshot only when equity = cash + open P&L", () => {
    expect(snapshotConsistent({ cashBalance: 4900, equity: 4300, openPnl: -600 })).toBe(true);
    // If `deposit` were not the cash balance, the three would not add up — and a
    // wrong reading must not become a confident wrong number.
    expect(snapshotConsistent({ cashBalance: 1500, equity: 4300, openPnl: -600 })).toBe(false);
  });
});

describe("pickSnapshotBaselines", () => {
  const now = new Date("2026-10-30T07:00:00Z");
  const snap = (id: number, hoursAgo: number, ok = true) => ({
    id, takenAt: new Date(now.getTime() - hoursAgo * 3600_000), cashBalance: 5000, equity: ok ? 4400 : 9999, openPnl: -600,
  });

  it("measures from the previous report and from about a week ago", () => {
    const picked = pickSnapshotBaselines([snap(1, 24 * 7), snap(2, 24 * 3), snap(3, 24)], now);
    expect(picked.map((s) => s.id)).toEqual([3, 1]);
  });

  it("skips a snapshot from a send-now an hour ago — too close to say anything", () => {
    expect(pickSnapshotBaselines([snap(1, 1), snap(2, 24)], now).map((s) => s.id)).toEqual([2]);
  });

  it("never measures from a snapshot whose figures did not add up", () => {
    expect(pickSnapshotBaselines([snap(1, 24, false), snap(2, 30)], now).map((s) => s.id)).toEqual([2]);
  });

  it("has nothing to measure from on the first day", () => {
    expect(pickSnapshotBaselines([snap(1, 2)], now)).toEqual([]);
  });

  it("does not list the same snapshot twice", () => {
    expect(pickSnapshotBaselines([snap(1, 24 * 8)], now).map((s) => s.id)).toEqual([1]);
  });
});
