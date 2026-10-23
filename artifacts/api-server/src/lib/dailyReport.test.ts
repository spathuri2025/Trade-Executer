import { describe, it, expect } from "vitest";
import { buildDailyReport, breakEvenWinRate, spreadSection, paperSection, openPositionsSection, unitemisedSection } from "./dailyReport";
import type { BrokerTransaction } from "./livePerformance";

const row = (dateUtc: string, instrumentName: string, size: string, note = "Trade closed", transactionType = "TRADE"): BrokerTransaction => ({
  dateUtc,
  instrumentName,
  transactionType,
  note,
  size,
  currency: "GBP",
});

const NOW = new Date("2026-09-24T07:00:00Z"); // report written on the 24th, about the 23rd
const CONTEXT = { botRunning: true, dryRun: false, dailyTarget: 100 };

describe("daily report", () => {
  const rows = [
    // Yesterday: +15.00 − 3.75 = +11.25 across 3 trades
    row("2026-09-23T14:05:00.000", "SMCI", "7.50"),
    row("2026-09-23T15:20:00.000", "GOLD", "7.50", "Trade closed: take-profit"),
    row("2026-09-23T16:40:00.000", "SMCI", "-3.75", "Trade closed: stop-loss"),
    // Earlier in the week
    row("2026-09-21T12:00:00.000", "SMCI", "-5.00", "Trade closed: stop-loss"),
    row("2026-09-20T12:00:00.000", "GOLD", "2.00"),
    row("2026-09-20T22:00:00.000", "GOLD", "-0.40", "Overnight funding adjustment", "SWAP"),
    // Today — must be excluded, the report covers completed days
    row("2026-09-24T06:00:00.000", "SMCI", "99.00"),
  ];

  const report = buildDailyReport(rows, NOW, CONTEXT);

  it("headlines yesterday, not today", () => {
    expect(report.subject).toBe("TradeBuzz daily: +£11.25 on 3 trades");
    expect(report.yesterdayNet).toBe(11.25);
    expect(report.yesterdayTrades).toBe(3);
    expect(report.text).not.toContain("99.00"); // today's trade is not counted yet
  });

  it("says how far short of the target the day fell", () => {
    expect(report.text).toMatch(/Target:\s+£100\.00 — short by £88\.75/);
  });

  it("reports win rate, average win and average loss — the numbers that decide whether size makes sense", () => {
    expect(report.text).toMatch(/Last 7 days/);
    expect(report.text).toMatch(/win rate 60%/); // 3 wins, 2 losses over the week
    expect(report.text).toMatch(/Average win:\s+\+£5\.67/);
    expect(report.text).toMatch(/Average loss:\s+−£4\.37/);
  });

  it("counts funding as a cost, not a trade", () => {
    expect(report.text).toMatch(/funding −£0\.40/);
  });

  it("warns while the sample is too small to mean anything", () => {
    expect(report.text).toMatch(/5 closed trades in 30 days.*before a win rate separates/s);
  });

  it("names the mode that produced the day, and says when it was a mixture", () => {
    // A week of results from two different strategies, reported as one number,
    // would be unattributable — which is the whole reason modes are recorded.
    const one = buildDailyReport(rows, NOW, { ...CONTEXT, modes: ["Scalping"] });
    expect(one.text).toContain("Mode: Scalping");

    const mixed = buildDailyReport(rows, NOW, { ...CONTEXT, modes: ["Intraday", "Scalping"] });
    expect(mixed.text).toContain("Modes yesterday: Intraday then Scalping — results are a mixture");
  });

  it("says plainly when the bot is stopped", () => {
    const stopped = buildDailyReport(rows, NOW, { ...CONTEXT, botRunning: false });
    expect(stopped.text).toContain("Bot: STOPPED");
  });

  it("handles a day with nothing closed without pretending otherwise", () => {
    const quiet = buildDailyReport([], NOW, CONTEXT);
    expect(quiet.subject).toBe("TradeBuzz daily: no trades closed");
    expect(quiet.text).toContain("No trades closed.");
  });

  it("names the best and worst instrument of the month", () => {
    expect(report.text).toMatch(/Best:\s+GOLD/);
    expect(report.text).toMatch(/Worst:\s+SMCI/);
  });

  it("accounts for a withdrawal that trading figures alone cannot explain", () => {
    // The week to 5 Oct 2026: +£243.61 realised while the account fell £537.
    const withCash = buildDailyReport(
      [
        row("2026-09-21T10:00:00.000", "GOLD", "243.61"),
        row("2026-09-21T12:00:00.000", "", "-780.70", "Withdrawal to bank", "WITHDRAWAL"),
      ],
      NOW,
      CONTEXT,
    );
    expect(withCash.text).toContain("What moved your balance");
    expect(withCash.text).toMatch(/closed trades\s+\+£243\.61/i);
    expect(withCash.text).toMatch(/withdrawal\s+−£780\.70/i);
    expect(withCash.text).toMatch(/Net movement\s+−£537\.09/);
  });

  it("warns that open positions are outside the reconciliation", () => {
    const withCash = buildDailyReport(
      [row("2026-09-21T10:00:00.000", "GOLD", "10.00")],
      NOW,
      CONTEXT,
    );
    expect(withCash.text).toContain("Open positions are not in these figures");
  });

  it("says nothing about movement when nothing moved", () => {
    const quiet = buildDailyReport([], NOW, CONTEXT);
    expect(quiet.text).not.toContain("What moved your balance");
  });

  it("says how trades ended, so an exit level that never fires is visible", () => {
    // Yesterday's three closes: one take-profit, one stop-loss, one plain.
    expect(report.text).toMatch(/Exits:\s+1 take-profit, 1 stop-loss, 1 closed early/);
  });

  it("counts exits once the broker labels any of them", () => {
    // The counting is only meaningful where a label is actually understood; a
    // mixture proves it distinguishes rather than bucketing everything.
    const mixed = buildDailyReport(
      [
        row("2026-09-23T14:00:00.000", "GOLD", "0.21", "Trade closed: take-profit"),
        row("2026-09-23T14:30:00.000", "GOLD", "-0.23"),
        row("2026-09-23T15:00:00.000", "US500", "0.19"),
      ],
      NOW,
      CONTEXT,
    );
    expect(mixed.text).toMatch(/Exits:\s+1 take-profit, 0 stop-loss, 2 closed early/);
  });

  it("says exits are not reported, rather than reporting zeros as a finding", () => {
    // Capital.com labels every close "Trade closed" and says nothing about what
    // triggered it. Printing "0 stop-loss" from that reads as a fact about the
    // trading when it is a fact about the data.
    const unknown = buildDailyReport(
      [
        row("2026-09-23T14:00:00.000", "Silver", "-0.58", "Trade closed"),
        row("2026-09-23T14:30:00.000", "Silver", "-0.60", "Trade closed"),
      ],
      NOW,
      CONTEXT,
    );
    expect(unknown.text).toContain('Exits:        not reported — every close is labelled "Trade closed"');
    expect(unknown.text).not.toMatch(/0 stop-loss/);
  });

  it("stays quiet about labels once some are recognised", () => {
    // Recognising any means the parser is working; listing the rest would be
    // noise in a report read every morning.
    expect(report.text).not.toContain("unrecognised labels");
  });

  it("does not call the only instrument traded the best one", () => {
    // 24 Sep 2026: the real report read "Best: SMCI −£2.17". SMCI was the only
    // instrument traded, so it was also the worst, and the label framed the
    // entire week's loss as the good news.
    const onlySmci = buildDailyReport(
      [row("2026-09-23T14:05:00.000", "SMCI", "-2.17", "Trade closed: stop-loss")],
      NOW,
      CONTEXT,
    );
    expect(onlySmci.text).toMatch(/Instrument:\s+SMCI −£2\.17/);
    expect(onlySmci.text).not.toContain("Best:");
  });

  it("says 'least bad' rather than 'best' when every instrument lost", () => {
    const allLosing = buildDailyReport(
      [
        row("2026-09-23T14:05:00.000", "SMCI", "-5.00", "Trade closed: stop-loss"),
        row("2026-09-23T15:20:00.000", "GOLD", "-1.00", "Trade closed: stop-loss"),
      ],
      NOW,
      CONTEXT,
    );
    expect(allLosing.text).toMatch(/Least bad:\s+GOLD −£1\.00/);
    expect(allLosing.text).toMatch(/Worst:\s+SMCI −£5\.00/);
    expect(allLosing.text).not.toContain("Best:");
  });
});

describe("breakEvenWinRate", () => {
  it("is the point where expectancy is exactly zero", () => {
    // Symmetric 0.3% exits, no spread: a coin flip breaks even.
    expect(breakEvenWinRate(0, 0.3, 0.3)).toBeCloseTo(0.5, 10);
  });

  it("shows scalp mode cannot survive a wide spread", () => {
    // SMCI's measured 0.468% against 0.3% exits: more than 100%, so no win
    // rate makes it profitable — the round trip costs more than the target.
    expect(breakEvenWinRate(0.468, 0.3, 0.3)).toBeGreaterThan(1);
  });

  it("shows the same instrument becomes viable on a 2:1 payoff", () => {
    // 3% target against a 1.5% stop: 43.7%, below what the account achieves.
    expect(breakEvenWinRate(0.468, 1.5, 3)).toBeCloseTo(0.437, 3);
  });

  it("is null when no exits are set, since there is nothing to solve", () => {
    expect(breakEvenWinRate(0.1, 0, 0)).toBeNull();
  });
});

describe("spreadSection", () => {
  const spreads = [
    { ticker: "GOLD", spreadPct: 0.045, samples: 30 },
    { ticker: "SMCI", spreadPct: 0.468, samples: 50 },
    { ticker: "AAPL", spreadPct: 0.116, samples: 41 },
  ];

  it("puts the most expensive instrument first — that is the one to act on", () => {
    const lines = spreadSection(spreads, 0.3, 0.3);
    const tickers = lines.filter((l) => l.startsWith("  ")).map((l) => l.trim().split(/\s+/)[0]);
    expect(tickers).toEqual(["SMCI", "AAPL", "GOLD"]);
  });

  it("names an impossible instrument as impossible rather than leaving it to be noticed", () => {
    expect(spreadSection(spreads, 0.3, 0.3).join("\n")).toMatch(/SMCI.*needs \d+% — impossible/);
  });

  it("drops the impossible label once the payoff makes it viable", () => {
    const text = spreadSection(spreads, 1.5, 3).join("\n");
    expect(text).toMatch(/SMCI.*needs 44%/);
    expect(text).not.toContain("impossible");
  });

  it("says nothing at all when no spread has been measured", () => {
    expect(spreadSection([], 0.3, 0.3)).toEqual([]);
  });
});

describe("paperSection", () => {
  const paper = {
    closed: 10, wins: 6, losses: 4, winRate: 0.6, netPnl: 42.5,
    averageWin: 19.5, averageLoss: -12.6, byReason: { stopLoss: 4, takeProfit: 6 },
  };

  it("reports dry-run results separately from the account's own", () => {
    const text = paperSection(paper, 2, "GBP").join("\n");
    expect(text).toContain("Dry run — what the strategy would have done (no money at risk)");
    expect(text).toMatch(/Result:\s+\+£42\.50/);
    expect(text).toMatch(/win rate 60%/);
    expect(text).toMatch(/Still open:\s+2/);
  });

  it("warns that paper results are gross of spread", () => {
    // Entries and exits come from mid-price bars, so live is worse on every
    // trade — between 0.085% and 0.5% on this account's instruments.
    expect(paperSection(paper, 0, "GBP").join("\n")).toContain("Gross of spread");
  });

  it("says positions are open but undecided rather than reporting a zero result", () => {
    const none = { ...paper, closed: 0, wins: 0, losses: 0, winRate: null, netPnl: 0, averageWin: null, averageLoss: null, byReason: { stopLoss: 0, takeProfit: 0 } };
    const text = paperSection(none, 3, "GBP").join("\n");
    expect(text).toContain("3 positions open, none closed yet.");
    expect(text).not.toMatch(/Result:/);
  });

  it("says how many positions went unmeasured instead of silently dropping them", () => {
    // A position open while the bot was off has an unknown path; it carries no
    // result, so without this line it would simply vanish from the count.
    const text = paperSection(paper, 0, "GBP", 2).join("\n");
    expect(text).toMatch(/Unmeasured:\s+2 — the bot was off while they were open/);
    expect(text).toMatch(/Trades:\s+10/); // not counted as trades
  });

  it("reports unmeasured positions even when nothing was measured", () => {
    const none = { ...paper, closed: 0, wins: 0, losses: 0, winRate: null, netPnl: 0, averageWin: null, averageLoss: null, byReason: { stopLoss: 0, takeProfit: 0 } };
    const text = paperSection(none, 0, "GBP", 1).join("\n");
    expect(text).toMatch(/Unmeasured:\s+1 — the bot was off while it was open/);
    expect(text).not.toMatch(/positions? open/);
  });

  it("says nothing at all when there is no dry run to report", () => {
    expect(paperSection(null, 0, "GBP")).toEqual([]);
    const none = { ...paper, closed: 0, byReason: { stopLoss: 0, takeProfit: 0 } };
    expect(paperSection(none, 0, "GBP")).toEqual([]);
  });

  it("counts how trades ended, which paper CAN answer and the broker cannot", () => {
    // The live report says "not reported" because Capital.com labels every
    // close "Trade closed". A simulated exit knows exactly why it closed.
    expect(paperSection(paper, 0, "GBP").join("\n")).toMatch(/Exits:\s+6 take-profit, 4 stop-loss/);
  });
});

describe("open positions", () => {
  // 23 Oct 2026, from the user's Capital.com screen: four OIL_CRUDE shorts,
  // 200 each, no stop-loss, together −£6,564.60. The report that morning said
  // "+£417.66 on 3 trades" and nothing else.
  const oil = (pnl: number) => ({ ticker: "OIL_CRUDE", direction: "SELL" as const, quantity: 200, pnl, pnlCurrency: null, stopLevel: null });
  const shorts = [oil(-1217.68), oil(-1498.82), oil(-1799.84), oil(-2048.26)];
  const yesterday = [row("2026-09-23T14:05:00.000", "OIL_CRUDE", "417.66")];

  it("puts the open loss in the subject, so a good day closed cannot read as a good morning", () => {
    const r = buildDailyReport(yesterday, NOW, { ...CONTEXT, openPositions: shorts });
    expect(r.subject).toBe("TradeBuzz daily: +£417.66 on 1 trade · open −£6564.60");
  });

  it("groups the deals of one bet into one line, says it is short, and that nothing protects it", () => {
    const { lines, total } = openPositionsSection(shorts, "GBP");
    const text = lines.join("\n");
    expect(text).toMatch(/OIL_CRUDE\s+Short\s+800\s+−£6564\.60\s+NO stop-loss on any of 4/);
    expect(text).toMatch(/Total open:\s+−£6564\.60/);
    expect(total).toBeCloseTo(-6564.6, 2);
  });

  it("sits directly under yesterday's result, above the weekly figures", () => {
    const text = buildDailyReport(yesterday, NOW, { ...CONTEXT, openPositions: shorts }).text;
    expect(text.indexOf("Open now")).toBeGreaterThan(text.indexOf("Yesterday"));
    expect(text.indexOf("Open now")).toBeLessThan(text.indexOf("Last 7 days"));
  });

  it("lists the worst first and counts partial protection", () => {
    const gold = { ticker: "GOLD", direction: "BUY" as const, quantity: 0.2, pnl: 12.3, pnlCurrency: null, stopLevel: 4000 };
    const silver = (stop: number | null) => ({ ticker: "SILVER", direction: "BUY" as const, quantity: 10, pnl: -5, pnlCurrency: null, stopLevel: stop });
    const text = openPositionsSection([gold, silver(59), silver(null)], "GBP").lines.join("\n");
    expect(text.indexOf("SILVER")).toBeLessThan(text.indexOf("GOLD"));
    expect(text).toMatch(/SILVER.*no stop-loss on 1 of 2/);
    expect(text).toMatch(/GOLD.*stop set/);
  });

  it("never adds dollars into a pounds total", () => {
    const usd = { ticker: "OIL_CRUDE", direction: "SELL" as const, quantity: 200, pnl: -1629.4, pnlCurrency: "USD", stopLevel: null };
    const { lines, total } = openPositionsSection([usd, oil(-100)], "GBP");
    const text = lines.join("\n");
    expect(text).toContain("−$1629.40");
    expect(total).toBeCloseTo(-100, 6);
    expect(text).toMatch(/One line is in another currency and left out of the total/);
  });

  it("says when positions could not be read, rather than implying nothing is open", () => {
    const r = buildDailyReport(yesterday, NOW, { ...CONTEXT, openPositions: null });
    expect(r.text).toMatch(/Open now\n\s+Could not be read from the broker/);
    expect(r.subject).not.toContain("open");
  });

  it("adds nothing when nothing is open", () => {
    const r = buildDailyReport(yesterday, NOW, { ...CONTEXT, openPositions: [] });
    expect(r.text).not.toContain("Open now");
    expect(r.subject).toBe("TradeBuzz daily: +£417.66 on 1 trade");
  });
});

describe("not itemised by Capital.com", () => {
  it("shows what moved the balance without a row, for each period measured", () => {
    const text = unitemisedSection(
      { state: "ok", periods: [{ since: new Date("2026-10-23T07:00:00Z"), amount: -649 }, { since: new Date("2026-10-16T07:00:00Z"), amount: -696.32 }] },
      "GBP"
    ).join("\n");
    expect(text).toContain("Not itemised by Capital.com (e.g. oil price adjustments)");
    expect(text).toMatch(/Since 2026-10-23 07:00 UTC:\s+−£649\.00/);
    expect(text).toMatch(/Since 2026-10-16 07:00 UTC:\s+−£696\.32/);
  });

  it("says none rather than printing pennies of timing noise", () => {
    expect(unitemisedSection({ state: "ok", periods: [{ since: new Date("2026-10-23T07:00:00Z"), amount: 0.4 }] }, "GBP").join("\n")).toMatch(/UTC:\s+none/);
  });

  it("says when it cannot be measured, never leaving the line out", () => {
    expect(unitemisedSection({ state: "first" }, "GBP").join("\n")).toMatch(/first figure arrives with the next report/);
    expect(unitemisedSection({ state: "inconsistent" }, "GBP").join("\n")).toMatch(/did not add up/);
    expect(unitemisedSection({ state: "unavailable" }, "GBP").join("\n")).toMatch(/could not be read/);
  });

  it("sits after the open positions in the report", () => {
    const text = buildDailyReport([row("2026-09-23T14:05:00.000", "OIL_CRUDE", "10")], NOW, {
      ...CONTEXT,
      openPositions: [{ ticker: "OIL_CRUDE", direction: "SELL", quantity: 200, pnl: -100, pnlCurrency: null, stopLevel: 95 }],
      unitemised: { state: "first" },
    }).text;
    expect(text.indexOf("Not itemised")).toBeGreaterThan(text.indexOf("Open now"));
    expect(text.indexOf("Not itemised")).toBeLessThan(text.indexOf("Last 7 days"));
  });
});
