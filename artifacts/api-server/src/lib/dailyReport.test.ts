import { describe, it, expect } from "vitest";
import { buildDailyReport } from "./dailyReport";
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

  it("says how trades ended, so an exit level that never fires is visible", () => {
    // Yesterday's three closes: one take-profit, one stop-loss, one plain.
    expect(report.text).toMatch(/Exits:\s+1 take-profit, 1 stop-loss, 1 closed early/);
  });

  it("makes it obvious when no trade ever reaches its target", () => {
    // The 24 Sep 2026 pattern: everything closed early, neither level reached.
    const allEarly = buildDailyReport(
      [
        row("2026-09-23T14:00:00.000", "GOLD", "0.21"),
        row("2026-09-23T14:30:00.000", "GOLD", "-0.23"),
        row("2026-09-23T15:00:00.000", "US500", "0.19"),
      ],
      NOW,
      CONTEXT,
    );
    expect(allEarly.text).toMatch(/Exits:\s+0 take-profit, 0 stop-loss, 3 closed early/);
  });

  it("admits when it recognised no exit label at all, and shows the wording", () => {
    const unknown = buildDailyReport(
      [
        row("2026-09-23T14:00:00.000", "Silver", "-0.58", "Position closed by SL"),
        row("2026-09-23T14:30:00.000", "Silver", "-0.60", "Position closed by SL"),
      ],
      NOW,
      CONTEXT,
    );
    expect(unknown.text).toMatch(/Exits:\s+0 take-profit, 0 stop-loss, 2 closed early/);
    expect(unknown.text).toContain('unrecognised labels: "Position closed by SL"');
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
