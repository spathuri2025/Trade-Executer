import { describe, it, expect } from "vitest";
import { resolvePaperExit, paperPnl, paperLevels, summarisePaper, settlePaperPosition, barsToCover } from "./paperTrading";

const long = { side: "BUY" as const, entryPrice: 100, quantity: 10, stopLevel: 98.5, targetLevel: 103 };
const short = { side: "SELL" as const, entryPrice: 100, quantity: 10, stopLevel: 101.5, targetLevel: 97 };
const bar = (high: number, low: number) => ({ high, low });

describe("resolvePaperExit", () => {
  it("closes a long at its target when the bar's HIGH reaches it", () => {
    // Close-only checking would miss this entirely and report the position open.
    expect(resolvePaperExit(long, [bar(103.2, 100.5)])).toEqual({ reason: "take-profit", price: 103 });
  });

  it("closes a long at its stop when the bar's LOW reaches it", () => {
    expect(resolvePaperExit(long, [bar(100.4, 98.2)])).toEqual({ reason: "stop-loss", price: 98.5 });
  });

  it("takes the STOP when one bar touches both", () => {
    // Within a bar we cannot know which came first. Assuming the profitable one
    // is how paper results come out better than live ones.
    expect(resolvePaperExit(long, [bar(103.5, 98.0)])).toEqual({ reason: "stop-loss", price: 98.5 });
  });

  it("mirrors the logic for a short", () => {
    expect(resolvePaperExit(short, [bar(100.2, 96.8)])).toEqual({ reason: "take-profit", price: 97 });
    expect(resolvePaperExit(short, [bar(101.9, 100.1)])).toEqual({ reason: "stop-loss", price: 101.5 });
  });

  it("returns the FIRST exit when several bars would qualify", () => {
    const hits = resolvePaperExit(long, [bar(100.2, 99.9), bar(103.4, 100.1), bar(99.0, 98.0)]);
    expect(hits).toEqual({ reason: "take-profit", price: 103 });
  });

  it("leaves the position open when neither level is touched", () => {
    expect(resolvePaperExit(long, [bar(101, 99.5), bar(102.4, 99.2)])).toBeNull();
  });

  it("ignores a stop that is not set", () => {
    const noStop = { ...long, stopLevel: null };
    expect(resolvePaperExit(noStop, [bar(100.4, 90)])).toBeNull();
  });

  it("ignores a target that is not set, instead of exiting at zero", () => {
    // The null checks are load-bearing on this side. Without them JavaScript
    // coerces null to 0, so `bar.high >= null` is true for any positive price
    // and every position closes instantly "at target" for nothing.
    const noTarget = { ...long, targetLevel: null };
    expect(resolvePaperExit(noTarget, [bar(101, 99.5)])).toBeNull();

    const noTargetShort = { ...short, targetLevel: null };
    expect(resolvePaperExit(noTargetShort, [bar(100.5, 99.5)])).toBeNull();
  });

  it("skips malformed bars rather than reading them as a touch", () => {
    expect(resolvePaperExit(long, [bar(NaN, NaN), bar(101, 99.5)])).toBeNull();
  });
});

describe("paperPnl", () => {
  it("profits on a long that rose", () => {
    expect(paperPnl(long, 103)).toBeCloseTo(30, 10);
  });

  it("loses on a long that fell", () => {
    expect(paperPnl(long, 98.5)).toBeCloseTo(-15, 10);
  });

  it("profits on a short that fell", () => {
    expect(paperPnl(short, 97)).toBeCloseTo(30, 10);
  });

  it("loses on a short that rose", () => {
    expect(paperPnl(short, 101.5)).toBeCloseTo(-15, 10);
  });
});

describe("paperLevels", () => {
  it("places a long's stop below and target above", () => {
    expect(paperLevels("BUY", 100, 1.5, 3)).toEqual({ stopLevel: 98.5, targetLevel: 103 });
  });

  it("places a short's stop above and target below", () => {
    // toBeCloseTo, not toEqual: 100 * 1.015 is 101.49999999999999 in binary
    // floating point. Rounding the levels instead would be the wrong fix — a
    // price level should carry the instrument's own precision, not two decimals.
    const levels = paperLevels("SELL", 100, 1.5, 3);
    expect(levels.stopLevel).toBeCloseTo(101.5, 9);
    expect(levels.targetLevel).toBeCloseTo(97, 9);
  });

  it("leaves a level unset when its percentage is zero", () => {
    expect(paperLevels("BUY", 100, 0, 0)).toEqual({ stopLevel: null, targetLevel: null });
  });
});

describe("summarisePaper", () => {
  const t = (pnl: number, exitReason = "take-profit") => ({ pnl, exitReason });

  it("reports the numbers that decide whether to run this for real", () => {
    const s = summarisePaper([t(30), t(30), t(-15, "stop-loss"), t(-15, "stop-loss")]);
    expect(s).toMatchObject({
      closed: 4,
      wins: 2,
      losses: 2,
      winRate: 0.5,
      netPnl: 30,
      averageWin: 30,
      averageLoss: -15,
    });
    expect(s.byReason).toEqual({ stopLoss: 2, takeProfit: 2 });
  });

  it("has no win rate with nothing closed, rather than claiming zero", () => {
    expect(summarisePaper([]).winRate).toBeNull();
  });

  it("treats a scratch as neither a win nor a loss", () => {
    const s = summarisePaper([t(0), t(10)]);
    expect(s.wins).toBe(1);
    expect(s.losses).toBe(0);
    expect(s.winRate).toBe(1);
  });
});

describe("settlePaperPosition", () => {
  // Bars exactly as Capital.com returns them: `time` in UNIX SECONDS.
  const T0 = Date.UTC(2026, 9, 6, 13, 0) / 1000; // 6 Oct 2026 13:00 UTC
  const tbar = (minutes: number, high: number, low: number) => ({ time: T0 + minutes * 60, high, low });
  const opened = new Date((T0 + 2 * 60) * 1000); // entered at 13:02, inside the 13:00 bar
  const pos = { ...long, openedAt: opened, checkedThrough: null };

  it("closes on a bar after the entry when bar times are in seconds", () => {
    // The 23 Oct 2026 bug: seconds compared with milliseconds, so no bar was
    // ever after the entry and no paper position ever closed.
    const bars = [tbar(0, 100.2, 99.9), tbar(5, 100.5, 99.8), tbar(10, 103.4, 100.1)];
    expect(settlePaperPosition(pos, bars)).toEqual({ kind: "exit", reason: "take-profit", price: 103 });
  });

  it("ignores the bar the entry was made inside", () => {
    // That bar's range includes prices from before the trade existed.
    const bars = [tbar(0, 104, 97), tbar(5, 100.5, 99.8)];
    expect(settlePaperPosition(pos, bars).kind).toBe("open");
  });

  it("stays open and records how far it has been checked", () => {
    const bars = [tbar(0, 100.2, 99.9), tbar(5, 100.5, 99.8), tbar(10, 100.6, 99.7)];
    expect(settlePaperPosition(pos, bars)).toEqual({ kind: "open", checkedThrough: new Date((T0 + 600) * 1000) });
  });

  it("is unmeasured when the bars no longer reach back to the entry", () => {
    // 6 Oct 2026: the bot stopped with AMD and US500 open, and 17 days later
    // the last 200 bars start long after the entry. Whatever happened in the
    // hole is unknown; booking an exit from the bars after it would be a guess.
    const later = [tbar(60 * 24 * 17, 104, 95)];
    expect(settlePaperPosition(pos, later)).toEqual({ kind: "unmeasured" });
  });

  it("measures from where checking stopped, not from the entry", () => {
    // Checked through 13:10 on an earlier cycle; this fetch starts at 13:10, so
    // there is no hole even though it no longer reaches the entry.
    const checked = { ...pos, checkedThrough: new Date((T0 + 600) * 1000) };
    expect(settlePaperPosition(checked, [tbar(10, 100.3, 99.9), tbar(15, 100.1, 98.4)])).toEqual({
      kind: "exit",
      reason: "stop-loss",
      price: 98.5,
    });
    expect(settlePaperPosition(checked, [tbar(15, 100.1, 99.9)])).toEqual({ kind: "unmeasured" });
  });

  it("says nothing when there are no bars", () => {
    expect(settlePaperPosition(pos, [])).toEqual({ kind: "skip" });
  });
});

describe("barsToCover", () => {
  it("counts bars back to the point, with a margin", () => {
    const from = new Date("2026-10-06T13:00:00Z");
    expect(barsToCover(from, new Date("2026-10-06T14:00:00Z"), "MINUTE_5")).toBe(22);
    expect(barsToCover(from, new Date("2026-10-23T13:00:00Z"), "MINUTE_5")).toBe(17 * 288 + 10);
  });
});
