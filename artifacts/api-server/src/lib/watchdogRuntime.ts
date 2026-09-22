import { and, eq, isNull, sql } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { logger } from "./logger";
import { checkDatabase } from "./healthCheck";
import { sendEmail } from "./email";
import { notifyUser } from "./notificationService";
import { Watchdog } from "./watchdog";

/** The watchdog wired to the real database, email and notifications. See watchdog.ts. */

const TICK_MS = 60_000;
let handle: ReturnType<typeof setInterval> | null = null;
let instance: Watchdog | null = null;

export function startWatchdog(): void {
  if (handle) return;

  const configuredRecipients = process.env["ALERT_EMAIL"];
  if (!configuredRecipients) {
    // Not fatal — admins are cached from the database while it's up — but the
    // one outage this can't cover is a process that boots while the database is
    // already down, which is exactly what happened on 22 Sep.
    logger.warn("ALERT_EMAIL is not set — database-outage alerts depend on admins cached while the database was up");
  }

  let recipientsForDedupe: string[] = [];

  const dog = new Watchdog({
    configuredRecipients,
    checkDb: () => checkDatabase(),
    loadAdminEmails: async () => {
      const rows = await db
        .select({ email: usersTable.email })
        .from(usersTable)
        .where(and(eq(usersTable.role, "admin"), isNull(usersTable.suspendedAt)));
      recipientsForDedupe = rows.map((r) => r.email);
      return recipientsForDedupe;
    },
    loadRunningBots: async () => {
      // Running bots that have something to trade. A bot with no enabled
      // instruments never produces a signal and would read as stalled forever.
      const result = await db.execute(sql`
        select c.user_id, u.email, c.interval_minutes,
               (select max(s.created_at) from signals s where s.user_id = c.user_id) as last_signal_at
        from bot_config c
        join users u on u.id = c.user_id
        where c.running = true
          and u.suspended_at is null
          and exists (select 1 from instruments i where i.user_id = c.user_id and i.enabled)
      `);
      return (result.rows as Array<Record<string, unknown>>).map((r) => ({
        userId: Number(r["user_id"]),
        email: String(r["email"]),
        intervalMinutes: Number(r["interval_minutes"]),
        lastSignalAt: r["last_signal_at"] ? new Date(r["last_signal_at"] as string) : null,
      }));
    },
    sendEmail: (to, subject, text) => sendEmail({ to, subject, text }),
    notifyOwner: async (userId, title, body) => {
      // An admin owner already got the watchdog email; don't send them a second.
      const [owner] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, userId));
      const alerted = new Set([...recipientsForDedupe, ...(configuredRecipients ?? "").split(",").map((s) => s.trim())]);
      if (owner && alerted.has(owner.email)) return;
      await notifyUser(userId, { type: "circuit_breaker", title, body, link: "/settings" });
    },
    log: (level, msg, extra) => logger[level](extra ?? {}, msg),
  });

  instance = dog;
  handle = setInterval(() => void dog.tick(), TICK_MS);
  handle.unref?.();
  logger.info({ alertEmailConfigured: Boolean(configuredRecipients) }, "Watchdog started");
}

export function stopWatchdog(): void {
  if (handle) {
    clearInterval(handle);
    handle = null;
  }
}

/** Admin-triggered: prove alerts arrive. Null when the watchdog isn't running (tests, API-only boots). */
export async function sendWatchdogTestAlert(): Promise<{ recipients: string[]; sent: number } | null> {
  return instance ? instance.sendTestAlert() : null;
}
