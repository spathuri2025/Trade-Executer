/**
 * The watchdog: notices when trading has stopped and tells a human.
 *
 * Built after 22 Sep 2026, when Supabase stopped accepting database
 * connections for half an hour. The app now survives that and trades nothing
 * while it lasts (every cycle must verify its ownership lease in the database
 * first) — but nobody was told. The only signal was a generic Render email,
 * sent because the server crashed, not because trading had stopped. Supabase's
 * status page showed green throughout.
 *
 * Two checks:
 *
 *  1. Database reachable. Checked every minute. After three consecutive
 *     failures, an email goes out; a reminder every hour while it lasts; a
 *     recovery email when it's back. Deliberately needs NOTHING from the
 *     database to send — recipients come from ALERT_EMAIL or a cache filled
 *     while the database was up, and email goes straight to Resend.
 *
 *  2. Bots actually cycling. A bot marked running with no signal for several
 *     intervals has stopped, whatever the reason: a lease not re-adopted, a
 *     broker login failing, a wedged engine. Only checked while the database is
 *     up, because while it's down check 1 is already saying so.
 *
 * The watchdog cannot report its own death: if the whole server is down, this
 * code isn't running. That case belongs to an external monitor on /api/readyz.
 */

/** Consecutive failed checks (a minute apart) before the database alert fires. */
export const DB_FAILURES_BEFORE_ALERT = 3;
/** While still down, repeat the alert this often. */
export const DB_REMINDER_MS = 60 * 60 * 1000;
/** A bot is stalled after this many missed intervals… */
export const STALL_INTERVALS = 3;
/** …and never sooner than this, so a normal deploy handover never triggers it. */
export const STALL_MIN_MINUTES = 15;

export interface StalledBot {
  userId: number;
  email: string;
  intervalMinutes: number;
  /** null: running, with instruments, and has never produced a signal. */
  minutesSilent: number | null;
}

export interface WatchdogDeps {
  checkDb: () => Promise<{ ok: boolean; latencyMs: number; error?: unknown }>;
  /** Admin addresses, read from the database. Only called while it's up. */
  loadAdminEmails: () => Promise<string[]>;
  /** Running bots with enabled instruments and their silence. Only called while the database is up. */
  loadRunningBots: () => Promise<Array<{ userId: number; email: string; intervalMinutes: number; lastSignalAt: Date | null }>>;
  sendEmail: (to: string, subject: string, text: string) => Promise<boolean>;
  /** In-app notice to a bot's owner (needs the database, so only used for stalls). */
  notifyOwner: (userId: number, title: string, body: string) => Promise<void>;
  log: (level: "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>) => void;
  /** Comma-separated addresses from the ALERT_EMAIL environment variable. */
  configuredRecipients: string | undefined;
  now?: () => number;
}

export function stalledBots(
  bots: Array<{ userId: number; email: string; intervalMinutes: number; lastSignalAt: Date | null }>,
  now: number
): StalledBot[] {
  const out: StalledBot[] = [];
  for (const b of bots) {
    const thresholdMin = Math.max(STALL_INTERVALS * b.intervalMinutes, STALL_MIN_MINUTES);
    if (b.lastSignalAt === null) {
      out.push({ userId: b.userId, email: b.email, intervalMinutes: b.intervalMinutes, minutesSilent: null });
      continue;
    }
    const silent = (now - b.lastSignalAt.getTime()) / 60_000;
    if (silent >= thresholdMin) {
      out.push({ userId: b.userId, email: b.email, intervalMinutes: b.intervalMinutes, minutesSilent: Math.round(silent) });
    }
  }
  return out;
}

const RUNBOOK = `What to check, in this order:
1. Supabase dashboard -> TradeBuzz project home. If the Advisor shows "Database not usable", use Project Settings -> General -> Restart project. That fixed the 22 Sep 2026 outage; Supabase's status page showed green throughout.
2. https://www.tradebuzz.co.uk/api/readyz — "database":{"status":"up"} means the app can reach it again.
3. Render -> tradebuzz -> Logs, for the exact error.

While the database is unreachable the bot places no orders: every cycle must verify its ownership lease in the database first. Open positions keep their stop-loss and take-profit, which sit at the broker. Trading resumes by itself once the database is back — no need to press Start.`;

export class Watchdog {
  private consecutiveFailures = 0;
  private downSince: number | null = null;
  private lastDbAlertAt: number | null = null;
  private cachedAdmins: string[] = [];
  private alertedStalls = new Set<number>();
  private lastStallCheckAt = 0;
  private readonly now: () => number;

  constructor(private readonly deps: WatchdogDeps) {
    this.now = deps.now ?? Date.now;
  }

  private recipients(): string[] {
    const configured = (this.deps.configuredRecipients ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return [...new Set([...configured, ...this.cachedAdmins])];
  }

  private async alert(subject: string, text: string): Promise<number> {
    const to = this.recipients();
    if (to.length === 0) {
      this.deps.log("error", "Watchdog has nobody to alert — set ALERT_EMAIL", { subject });
      return 0;
    }
    let sent = 0;
    for (const addr of to) {
      if (await this.deps.sendEmail(addr, subject, text).catch(() => false)) sent += 1;
    }
    this.deps.log("warn", "Watchdog alert sent", { subject, recipients: to.length, sent });
    return sent;
  }

  /**
   * Send a clearly-labelled test through the same path a real alert takes, so
   * a wrong or missing address is found now rather than during an outage.
   */
  async sendTestAlert(): Promise<{ recipients: string[]; sent: number }> {
    // Pick up the admin list first, so the test covers the cached route too.
    try {
      const admins = await this.deps.loadAdminEmails();
      if (admins.length > 0) this.cachedAdmins = admins;
    } catch {
      /* keep the previous cache */
    }
    const recipients = this.recipients();
    const sent = await this.alert(
      "TradeBuzz: test alert — no action needed",
      `This is a test of TradeBuzz's outage alerts. If you're reading it, alerts reach you.\n\nA real alert looks like this one, and includes what to do:\n\n${RUNBOOK}`
    );
    return { recipients, sent };
  }

  /** One pass. Called every minute. Never throws. */
  async tick(): Promise<void> {
    try {
      const db = await this.deps.checkDb();
      if (!db.ok) {
        await this.onDbDown(db.error);
        return;
      }
      await this.onDbUp();
      if (this.now() - this.lastStallCheckAt >= 5 * 60 * 1000) {
        this.lastStallCheckAt = this.now();
        await this.checkStalls();
      }
    } catch (err) {
      this.deps.log("error", "Watchdog tick failed", { err: err instanceof Error ? err.message : String(err) });
    }
  }

  private async onDbDown(error: unknown): Promise<void> {
    this.consecutiveFailures += 1;
    this.downSince ??= this.now();
    if (this.consecutiveFailures < DB_FAILURES_BEFORE_ALERT) return;

    const due = this.lastDbAlertAt === null || this.now() - this.lastDbAlertAt >= DB_REMINDER_MS;
    if (!due) return;
    this.lastDbAlertAt = this.now();

    const minutes = Math.max(1, Math.round((this.now() - this.downSince) / 60_000));
    const reason = error instanceof Error ? error.message : String(error ?? "unknown");
    await this.alert(
      `TradeBuzz: database unreachable for ${minutes} min — trading paused`,
      `TradeBuzz has been unable to reach its database for about ${minutes} minute${minutes === 1 ? "" : "s"}.\n\nLast error: ${reason}\n\n${RUNBOOK}`
    );
  }

  private async onDbUp(): Promise<void> {
    const wasAlerted = this.lastDbAlertAt !== null;
    const downFor = this.downSince === null ? 0 : Math.round((this.now() - this.downSince) / 60_000);
    this.consecutiveFailures = 0;
    this.downSince = null;
    this.lastDbAlertAt = null;

    // Refresh while we can: these addresses are what the NEXT outage emails.
    try {
      const admins = await this.deps.loadAdminEmails();
      if (admins.length > 0) this.cachedAdmins = admins;
    } catch {
      /* keep the previous cache */
    }

    if (wasAlerted) {
      await this.alert(
        "TradeBuzz: database reachable again — trading resuming",
        `The database is reachable again after about ${downFor} minute${downFor === 1 ? "" : "s"}. Running bots resume by themselves within a minute or two. If one hasn't, you'll get a separate "bot not cycling" email.`
      );
    }
  }

  private async checkStalls(): Promise<void> {
    const bots = await this.deps.loadRunningBots();
    const stalled = stalledBots(bots, this.now());
    const stalledIds = new Set(stalled.map((s) => s.userId));

    for (const s of stalled) {
      if (this.alertedStalls.has(s.userId)) continue;
      this.alertedStalls.add(s.userId);
      const silence = s.minutesSilent === null ? "has never completed a cycle" : `hasn't completed a cycle in ${s.minutesSilent} minutes`;
      this.deps.log("warn", "Bot not cycling", { userId: s.userId, minutesSilent: s.minutesSilent });
      await this.alert(
        `TradeBuzz: a running bot ${silence}`,
        `The bot for ${s.email} is marked running but ${silence} (its interval is ${s.intervalMinutes} min). The database is reachable, so this is something else: a broker login failing, the bot not picked up after a deploy, or the engine stuck.\n\nCheck Render -> tradebuzz -> Logs, and the Signals page for that account. Stopping and starting the bot from Settings often clears it.`
      );
      await this.deps
        .notifyOwner(
          s.userId,
          "Your trading bot has stopped cycling",
          `Your bot is switched on but ${silence}. We've been alerted. Open positions keep their broker-side stop-loss and take-profit.`
        )
        .catch(() => {});
    }

    // A bot cycling again is cleared, so a later stall alerts afresh.
    for (const id of [...this.alertedStalls]) {
      if (!stalledIds.has(id)) {
        this.alertedStalls.delete(id);
        this.deps.log("info", "Bot cycling again", { userId: id });
      }
    }
  }
}
