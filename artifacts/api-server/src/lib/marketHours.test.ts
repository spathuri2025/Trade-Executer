import { describe, it, expect } from "vitest";
import {
  minutesUntilSessionEnd,
  minutesSinceSessionStart,
  formatSessionEnd,
  type OpeningHours,
} from "./marketHours";

// 2026-09-21 is a Monday.
const at = (iso: string) => new Date(`${iso}Z`);

/** A US stock CFD, as Capital.com reported PL's timetable in its rejections. */
const usStock: OpeningHours = {
  mon: ["13:30 - 20:00"],
  tue: ["13:30 - 20:00"],
  wed: ["13:30 - 20:00"],
  thu: ["13:30 - 20:00"],
  fri: ["13:30 - 20:00"],
  sat: [],
  sun: [],
  zone: "UTC",
};

/** Verbatim shape from Capital.com's own example: near-continuous, split at midnight. */
const nearContinuous: OpeningHours = {
  mon: ["00:00 - 22:00", "23:05 - 00:00"],
  tue: ["00:00 - 22:00", "23:05 - 00:00"],
  wed: ["00:00 - 22:00", "23:05 - 00:00"],
  thu: ["00:00 - 22:00", "23:05 - 00:00"],
  fri: ["00:00 - 22:00"],
  sat: [],
  sun: ["23:05 - 00:00"],
  zone: "UTC",
};

describe("minutesUntilSessionEnd", () => {
  it("counts down to a stock's daily close", () => {
    expect(minutesUntilSessionEnd(usStock, at("2026-09-21T19:50:00"))).toBe(10);
  });

  it("is null before the open and after the close — the market is shut, nothing to do", () => {
    expect(minutesUntilSessionEnd(usStock, at("2026-09-21T12:00:00"))).toBeNull();
    expect(minutesUntilSessionEnd(usStock, at("2026-09-21T20:30:00"))).toBeNull();
  });

  it("ignores an index's short nightly pause — that is not a session end", () => {
    // 22:00 to 23:05 is 65 minutes. Closing for it would pay the spread twice
    // a day for nothing.
    expect(minutesUntilSessionEnd(nearContinuous, at("2026-09-21T21:55:00"))).toBeNull();
  });

  it("treats the Friday close as a session end — the weekend is the biggest gap there is", () => {
    expect(minutesUntilSessionEnd(nearContinuous, at("2026-09-25T21:45:00"))).toBe(15);
  });

  it("merges windows across midnight — Sunday 23:05 runs straight into Monday", () => {
    // If the 00:00 join were read as a close, this would report a session end
    // at midnight Sunday and close everything on the market's own reopening.
    expect(minutesUntilSessionEnd(nearContinuous, at("2026-09-20T23:50:00"))).toBeNull();
  });

  it("declines any zone other than UTC rather than convert it wrongly", () => {
    expect(minutesUntilSessionEnd({ ...usStock, zone: "America/New_York" }, at("2026-09-21T19:50:00"))).toBeNull();
  });

  it("declines an unreadable window rather than guess", () => {
    expect(minutesUntilSessionEnd({ ...usStock, mon: ["half past one to eight"] }, at("2026-09-21T19:50:00"))).toBeNull();
  });

  it("is null with no schedule at all", () => {
    expect(minutesUntilSessionEnd(null, at("2026-09-21T19:50:00"))).toBeNull();
    expect(minutesUntilSessionEnd(undefined, at("2026-09-21T19:50:00"))).toBeNull();
  });

  it("never reports a session end for a market open all week", () => {
    const always = ["00:00 - 00:00"];
    const crypto: OpeningHours = { sun: always, mon: always, tue: always, wed: always, thu: always, fri: always, sat: always, zone: "UTC" };
    expect(minutesUntilSessionEnd(crypto, at("2026-09-25T21:45:00"))).toBeNull();
  });

  it("formats the close as a clock time", () => {
    expect(formatSessionEnd(10, at("2026-09-21T19:50:00"))).toBe("20:00 UTC");
  });
});

describe("minutesSinceSessionStart", () => {
  it("counts from the open of a stock's session", () => {
    // Monday 13:35 UTC, five minutes after a 13:30 open.
    expect(minutesSinceSessionStart(usStock, at("2026-09-21T13:35:00"))).toBeCloseTo(5, 9);
  });

  it("is zero at the opening instant", () => {
    expect(minutesSinceSessionStart(usStock, at("2026-09-21T13:30:00"))).toBe(0);
  });

  it("keeps counting later in the day", () => {
    expect(minutesSinceSessionStart(usStock, at("2026-09-21T19:00:00"))).toBeCloseTo(330, 9);
  });

  it("is null before the market opens", () => {
    expect(minutesSinceSessionStart(usStock, at("2026-09-21T13:00:00"))).toBeNull();
  });

  it("is null on a weekend", () => {
    expect(minutesSinceSessionStart(usStock, at("2026-09-19T15:00:00"))).toBeNull();
  });

  it("measures from Monday's open, not Friday's close", () => {
    // The weekend is the break; Monday 13:30 is a genuine open.
    expect(minutesSinceSessionStart(usStock, at("2026-09-21T13:45:00"))).toBeCloseTo(15, 9);
  });

  it("measures a near-continuous market from its WEEKLY open", () => {
    // Sunday 23:05 after the weekend is a real open; Monday 15:00 is 955
    // minutes into that session, so an opening-window gate correctly ignores it.
    expect(minutesSinceSessionStart(nearContinuous, at("2026-09-21T15:00:00"))).toBeCloseTo(955, 9);
  });

  it("does not treat an index CFD's hour-long overnight pause as an open", () => {
    // 22:00-23:05 is 65 minutes, under MIN_SESSION_GAP_MINUTES. Counting it as
    // an open would block new positions every night for no reason.
    expect(minutesSinceSessionStart(nearContinuous, at("2026-09-22T00:00:00"))).toBeNull();
  });

  it("declines a non-UTC zone rather than converting it", () => {
    expect(minutesSinceSessionStart({ ...usStock, zone: "America/New_York" }, at("2026-09-21T13:35:00"))).toBeNull();
  });

  it("declines an unreadable window", () => {
    expect(minutesSinceSessionStart({ ...usStock, mon: ["not a window"] }, at("2026-09-21T13:35:00"))).toBeNull();
  });

  it("declines a missing schedule", () => {
    expect(minutesSinceSessionStart(null, at("2026-09-21T13:35:00"))).toBeNull();
    expect(minutesSinceSessionStart(undefined, at("2026-09-21T13:35:00"))).toBeNull();
  });
});
