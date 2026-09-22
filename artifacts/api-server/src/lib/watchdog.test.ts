import { describe, it, expect, vi } from "vitest";
import { Watchdog, stalledBots, type WatchdogDeps } from "./watchdog";

const MIN = 60_000;

function harness(opts: { recipients?: string; admins?: string[] } = {}) {
  let clock = Date.UTC(2026, 8, 22, 10, 20);
  let dbUp = true;
  let bots: Array<{ userId: number; email: string; intervalMinutes: number; lastSignalAt: Date | null }> = [];
  const emails: Array<{ to: string; subject: string; text: string }> = [];
  const deps: WatchdogDeps = {
    checkDb: vi.fn(async () =>
      dbUp ? { ok: true, latencyMs: 20 } : { ok: false, latencyMs: 10_000, error: new Error("Connection terminated due to connection timeout") }
    ),
    loadAdminEmails: vi.fn(async () => opts.admins ?? []),
    loadRunningBots: vi.fn(async () => bots),
    sendEmail: vi.fn(async (to, subject, text) => {
      emails.push({ to, subject, text });
      return true;
    }),
    notifyOwner: vi.fn(async () => {}),
    log: () => {},
    configuredRecipients: opts.recipients,
    now: () => clock,
  };
  const dog = new Watchdog(deps);
  return {
    dog,
    deps,
    emails,
    advance: (ms: number) => (clock += ms),
    setDb: (up: boolean) => (dbUp = up),
    setBots: (b: typeof bots) => (bots = b),
    now: () => clock,
  };
}

/** Tick once a minute for n minutes. */
async function minutes(h: ReturnType<typeof harness>, n: number) {
  for (let i = 0; i < n; i++) {
    await h.dog.tick();
    h.advance(MIN);
  }
}

describe("database watchdog — replaying 22 Sep", () => {
  it("stays quiet for a blip, alerts on the third failed minute", async () => {
    const h = harness({ recipients: "owner@example.com" });
    h.setDb(false);
    await minutes(h, 2);
    expect(h.emails).toHaveLength(0); // a two-minute blip is not an incident

    await minutes(h, 1);
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0].subject).toMatch(/database unreachable.*trading paused/);
    // The alert carries the fix that worked, not just the fact of the failure.
    expect(h.emails[0].text).toContain("Restart project");
    expect(h.emails[0].text).toContain("Connection terminated due to connection timeout");
  });

  it("does not repeat every minute; reminds once an hour", async () => {
    const h = harness({ recipients: "owner@example.com" });
    h.setDb(false);
    await minutes(h, 30); // today's outage length
    expect(h.emails).toHaveLength(1);

    await minutes(h, 35);
    expect(h.emails).toHaveLength(2); // hourly reminder
  });

  it("says when it's back, and how long it was down", async () => {
    const h = harness({ recipients: "owner@example.com" });
    h.setDb(false);
    await minutes(h, 30);
    h.setDb(true);
    await minutes(h, 1);

    const recovery = h.emails.at(-1)!;
    expect(recovery.subject).toMatch(/reachable again/);
    expect(recovery.text).toMatch(/about 30 minutes/);
  });

  it("sends no recovery email for a blip that never alerted", async () => {
    const h = harness({ recipients: "owner@example.com" });
    h.setDb(false);
    await minutes(h, 2);
    h.setDb(true);
    await minutes(h, 1);
    expect(h.emails).toHaveLength(0);
  });

  it("reaches the admins it cached while the database was up, even with no ALERT_EMAIL", async () => {
    const h = harness({ admins: ["admin@example.com"] });
    await minutes(h, 1); // healthy: caches the admin list
    h.setDb(false);
    await minutes(h, 3);
    expect(h.emails.map((e) => e.to)).toEqual(["admin@example.com"]);
  });

  it("with nothing cached and no ALERT_EMAIL, fails loudly in the log rather than crashing", async () => {
    // Today's exact situation: the replacement process booted while the database
    // was already down, so it never had a chance to cache anyone. ALERT_EMAIL is
    // the only thing that makes this case alert.
    const h = harness();
    const log = vi.fn();
    h.deps.log = log;
    h.setDb(false);
    await minutes(h, 3);
    expect(h.emails).toHaveLength(0);
    expect(log).toHaveBeenCalledWith("error", expect.stringContaining("ALERT_EMAIL"), expect.anything());
  });

  it("never checks for stalled bots while the database is down — that alert already covers it", async () => {
    const h = harness({ recipients: "owner@example.com" });
    h.setDb(false);
    await minutes(h, 10);
    expect(h.deps.loadRunningBots).not.toHaveBeenCalled();
  });

  it("never throws, whatever a dependency does", async () => {
    const h = harness({ recipients: "owner@example.com" });
    h.deps.checkDb = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(h.dog.tick()).resolves.toBeUndefined();
  });
});

describe("test alert", () => {
  it("goes through the real alert path to every recipient, labelled as a test", async () => {
    const h = harness({ recipients: "owner@example.com", admins: ["admin@example.com"] });
    const result = await h.dog.sendTestAlert();

    expect(result).toEqual({ recipients: ["owner@example.com", "admin@example.com"], sent: 2 });
    expect(h.emails.every((e) => /test alert/.test(e.subject))).toBe(true);
    expect(h.emails[0].text).toContain("Restart project");
  });

  it("reports zero sent when there is nobody to send to", async () => {
    const h = harness();
    expect(await h.dog.sendTestAlert()).toEqual({ recipients: [], sent: 0 });
  });
});

describe("stalled bot detection", () => {
  it("alerts once when a running bot goes quiet, clears when it cycles, alerts again on a new stall", async () => {
    const h = harness({ recipients: "owner@example.com" });
    const at = (ago: number) => [{ userId: 1, email: "owner@example.com", intervalMinutes: 5, lastSignalAt: new Date(h.now() - ago * MIN) }];

    h.setBots(at(20)); // silent 20 min on a 5-min interval
    await h.dog.tick();
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0].subject).toMatch(/hasn't completed a cycle in 20 minutes/);
    expect(h.deps.notifyOwner).toHaveBeenCalledTimes(1);

    h.advance(5 * MIN);
    h.setBots(at(25));
    await h.dog.tick();
    expect(h.emails).toHaveLength(1); // still the same stall — no repeat

    h.advance(5 * MIN);
    h.setBots(at(1)); // cycling again
    await h.dog.tick();

    h.advance(5 * MIN);
    h.setBots(at(20)); // a fresh stall
    await h.dog.tick();
    expect(h.emails).toHaveLength(2);
  });

  it("ignores a normal deploy gap — under 15 minutes is never a stall", () => {
    const now = Date.now();
    expect(stalledBots([{ userId: 1, email: "a", intervalMinutes: 5, lastSignalAt: new Date(now - 12 * MIN) }], now)).toHaveLength(0);
  });

  it("scales with the interval — an hourly bot silent 90 minutes is fine", () => {
    const now = Date.now();
    expect(stalledBots([{ userId: 1, email: "a", intervalMinutes: 60, lastSignalAt: new Date(now - 90 * MIN) }], now)).toHaveLength(0);
    expect(stalledBots([{ userId: 1, email: "a", intervalMinutes: 60, lastSignalAt: new Date(now - 181 * MIN) }], now)).toHaveLength(1);
  });

  it("flags a running bot that has never produced a signal", () => {
    expect(stalledBots([{ userId: 1, email: "a", intervalMinutes: 5, lastSignalAt: null }], Date.now())[0].minutesSilent).toBeNull();
  });
});
