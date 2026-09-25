import { describe, it, expect } from "vitest";
import {
  utcWeekKey,
  rollMarks,
  hardLimitBreach,
  trailingLossStreak,
  withinCooldown,
  type EquityMarks,
} from "./riskGuards";

const at = (iso: string) => new Date(`${iso}Z`);

const noMarks: EquityMarks = {
  dayKey: null,
  dayStartEquity: null,
  dayPeakEquity: null,
  weekKey: null,
  weekStartEquity: null,
  profitLockedDayKey: null,
};

describe("utcWeekKey", () => {
  it("keeps a Monday and the Friday after it in the same week", () => {
    expect(utcWeekKey(at("2026-09-21T00:00:00"))).toBe(utcWeekKey(at("2026-09-25T23:59:59")));
  });

  it("puts Sunday in the week that just ended, not the one starting", () => {
    // 2026-09-27 is a Sunday; 2026-09-28 the Monday after.
    expect(utcWeekKey(at("2026-09-27T12:00:00"))).toBe(utcWeekKey(at("2026-09-21T12:00:00")));
    expect(utcWeekKey(at("2026-09-28T12:00:00"))).not.toBe(utcWeekKey(at("2026-09-27T12:00:00")));
  });

  it("carries the ISO year across the turn of the year", () => {
    // 2026-12-31 is a Thursday, so its week belongs to 2026 and runs into January.
    expect(utcWeekKey(at("2026-12-31T00:00:00"))).toBe("2026-W53");
    expect(utcWeekKey(at("2027-01-01T00:00:00"))).toBe("2026-W53");
  });
});

describe("rollMarks", () => {
  it("opens both baselines on the first observation", () => {
    const m = rollMarks(noMarks, 5000, at("2026-09-21T08:00:00"));
    expect(m.dayStartEquity).toBe(5000);
    expect(m.dayPeakEquity).toBe(5000);
    expect(m.weekStartEquity).toBe(5000);
  });

  it("raises the day's peak but never lowers it", () => {
    let m = rollMarks(noMarks, 5000, at("2026-09-21T08:00:00"));
    m = rollMarks(m, 5200, at("2026-09-21T09:00:00"));
    m = rollMarks(m, 4900, at("2026-09-21T10:00:00"));
    expect(m.dayPeakEquity).toBe(5200);
    expect(m.dayStartEquity).toBe(5000);
  });

  it("keeps the week's baseline when the day rolls", () => {
    let m = rollMarks(noMarks, 5000, at("2026-09-21T08:00:00")); // Monday
    m = rollMarks(m, 4800, at("2026-09-22T08:00:00")); // Tuesday
    expect(m.dayStartEquity).toBe(4800);
    expect(m.weekStartEquity).toBe(5000);
  });

  it("re-bases the week on Monday", () => {
    let m = rollMarks(noMarks, 5000, at("2026-09-25T08:00:00")); // Friday
    m = rollMarks(m, 4700, at("2026-09-28T08:00:00")); // the Monday after
    expect(m.weekStartEquity).toBe(4700);
  });

  it("survives a restart: given the persisted marks it does not re-open the day", () => {
    const persisted = rollMarks(noMarks, 5000, at("2026-09-21T08:00:00"));
    // Same day, new process, equity already down £80.
    const afterRestart = rollMarks(persisted, 4920, at("2026-09-21T14:00:00"));
    expect(afterRestart.dayStartEquity).toBe(5000);
  });
});

describe("hardLimitBreach", () => {
  const cfg = { equityFloor: 4500, maxWeeklyLossPercent: 5 };
  const week: EquityMarks = { ...noMarks, weekKey: "2026-W39", weekStartEquity: 5000 };

  it("passes an account above both limits", () => {
    expect(hardLimitBreach(week, 4900, cfg)).toBeNull();
  });

  it("halts at the floor, not only below it", () => {
    expect(hardLimitBreach(week, 4500, cfg)?.code).toBe("equity_floor");
  });

  it("puts the floor ahead of the weekly limit when both are breached", () => {
    expect(hardLimitBreach(week, 4000, cfg)?.code).toBe("equity_floor");
  });

  it("halts on the weekly loss while still above the floor", () => {
    // 5% of 5000 is 250, so 4750 is exactly the limit.
    expect(hardLimitBreach(week, 4750, cfg)?.code).toBe("weekly_loss");
  });

  it("is off when the limits are zero", () => {
    expect(hardLimitBreach(week, 1, { equityFloor: 0, maxWeeklyLossPercent: 0 })).toBeNull();
  });

  it("does not halt before a week's baseline has been observed", () => {
    expect(hardLimitBreach(noMarks, 1000, { equityFloor: 0, maxWeeklyLossPercent: 5 })).toBeNull();
  });
});

describe("trailingLossStreak", () => {
  const t = (...results: number[]) => results.map((result) => ({ result }));

  it("counts only the losses at the end", () => {
    expect(trailingLossStreak(t(-1, -1, 5, -1, -1, -1))).toEqual({ count: 3, loss: 3 });
  });

  it("adds up what the streak cost, not just how long it is", () => {
    // Six losses of 23p is £1.38 — the 24 Sep 2026 case, where halting for the
    // day was a wild over-reaction to the money actually lost.
    const { count, loss } = trailingLossStreak(t(-0.23, -0.23, -0.23, -0.23, -0.23, -0.23));
    expect(count).toBe(6);
    expect(loss).toBeCloseTo(1.38, 10);
  });

  it("is zero when the last trade won", () => {
    expect(trailingLossStreak(t(-1, -1, -1, 0.5))).toEqual({ count: 0, loss: 0 });
  });

  it("treats a scratch as ending the streak", () => {
    expect(trailingLossStreak(t(-1, -1, 0, -1))).toEqual({ count: 1, loss: 1 });
  });

  it("is zero with no trades", () => {
    expect(trailingLossStreak([])).toEqual({ count: 0, loss: 0 });
  });
});

describe("withinCooldown", () => {
  const now = at("2026-09-24T11:09:10");

  it("blocks a re-entry 10 seconds after the last order", () => {
    expect(withinCooldown(at("2026-09-24T11:09:00"), now, 5)).toBe(true);
  });

  it("allows one after the cooldown has passed", () => {
    expect(withinCooldown(at("2026-09-24T11:04:00"), now, 5)).toBe(false);
  });

  it("is off at zero minutes", () => {
    expect(withinCooldown(at("2026-09-24T11:09:09"), now, 0)).toBe(false);
  });

  it("allows an instrument that has never been traded", () => {
    expect(withinCooldown(null, now, 5)).toBe(false);
  });
});
