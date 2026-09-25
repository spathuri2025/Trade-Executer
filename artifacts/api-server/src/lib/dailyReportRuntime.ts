import { and, eq, gte, sql } from "drizzle-orm";
import { db, notificationsTable, signalsTable } from "@workspace/db";
import { logger } from "./logger";
import { getUserBrokerCredentials } from "./brokerCredentialsService";
import { getBrokerTransactions } from "./broker";
import { notifyUser } from "./notificationService";
import { buildDailyReport } from "./dailyReport";
import { modesActiveBetween } from "./tradingProfiles";

/**
 * Sends each account its morning report — see dailyReport.ts for the content.
 *
 * Timing is deliberately loose: a check every 10 minutes, sending once the hour
 * has arrived. Precision to the minute buys nothing, and being late is better
 * than a cron that fires during a restart and is missed entirely.
 *
 * Whether today's report has already gone is answered by the notifications
 * table, not by memory. A deploy mid-morning must not produce a second one, and
 * this process may not be the one that sent the first.
 */

const CHECK_MS = 10 * 60 * 1000;
/** 07:00 UTC = 08:00 UK in summer, 07:00 in winter. */
const DEFAULT_HOUR_UTC = 7;
const LOOKBACK_DAYS = 30;

let handle: ReturnType<typeof setInterval> | null = null;

function sendHourUtc(): number {
  const raw = Number(process.env["DAILY_REPORT_HOUR_UTC"]);
  return Number.isInteger(raw) && raw >= 0 && raw <= 23 ? raw : DEFAULT_HOUR_UTC;
}

async function alreadySentToday(userId: number, now: Date): Promise<boolean> {
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [row] = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.userId, userId),
        eq(notificationsTable.type, "daily_report"),
        gte(notificationsTable.createdAt, todayStart)
      )
    )
    .limit(1);
  return row !== undefined;
}

/** One pass. Exported for the admin "send now" path and for tests. */
export async function sendDailyReports(now: Date = new Date(), force = false): Promise<number> {
  if (!force && now.getUTCHours() < sendHourUtc()) return 0;

  const recipients = await db.execute(sql`
    select c.user_id, c.running, c.dry_run, c.daily_profit_target,
           c.stop_loss_percent, c.take_profit_percent
    from bot_config c
    join users u on u.id = c.user_id
    where u.suspended_at is null
  `);

  let sent = 0;
  for (const r of recipients.rows as Array<Record<string, unknown>>) {
    const userId = Number(r["user_id"]);
    try {
      if (!force && (await alreadySentToday(userId, now))) continue;

      // No broker, no report: there is nothing to report on, and saying
      // "no trades" every morning to someone who never connected one is spam.
      const credentials = await getUserBrokerCredentials(userId);
      if (!credentials) continue;

      const to = now;
      const from = new Date(to.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
      const rows = await getBrokerTransactions(userId, credentials, from, to);
      if (rows === null) continue; // broker has no transaction history

      const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
      const modes = await modesActiveBetween(userId, yesterdayStart, todayStart).catch(() => [] as string[]);

      // Measured spread per instrument from the signal log. Recorded whenever a
      // quote was fetched, so it reflects the moments the engine actually
      // considered trading rather than an average over quiet hours.
      const spreads = await db
        .select({
          ticker: signalsTable.ticker,
          spreadPct: sql<number>`avg(${signalsTable.spreadPct})`,
          samples: sql<number>`count(${signalsTable.spreadPct})`,
        })
        .from(signalsTable)
        .where(and(eq(signalsTable.userId, userId), gte(signalsTable.createdAt, from), sql`${signalsTable.spreadPct} is not null`))
        .groupBy(signalsTable.ticker)
        .catch((err: unknown) => {
          logger.warn({ err, userId }, "Could not read spreads for the morning report — omitting that section");
          return [] as Array<{ ticker: string; spreadPct: number; samples: number }>;
        });

      const report = buildDailyReport(rows, now, {
        modes,
        botRunning: Boolean(r["running"]),
        dryRun: Boolean(r["dry_run"]),
        dailyTarget: Number(r["daily_profit_target"] ?? 0),
        spreads: spreads.map((x) => ({
          ticker: x.ticker,
          spreadPct: Number(x.spreadPct) * 100, // stored as a fraction, shown as a percent
          samples: Number(x.samples),
        })),
        stopLossPercent: Number(r["stop_loss_percent"] ?? 0),
        takeProfitPercent: Number(r["take_profit_percent"] ?? 0),
      });

      // notifyUser writes the in-app copy AND emails it — one path, so the
      // record and the email can never disagree.
      await notifyUser(userId, {
        type: "daily_report",
        title: report.subject,
        body: report.text,
        link: "/performance",
      });
      sent += 1;
      logger.info({ userId, yesterdayNet: report.yesterdayNet, trades: report.yesterdayTrades }, "Daily report sent");
    } catch (err) {
      // One account's broker being unreachable must not stop everyone else's.
      logger.error({ userId, err }, "Could not send daily report");
    }
  }
  return sent;
}

export function startDailyReports(): void {
  if (handle) return;
  handle = setInterval(() => void sendDailyReports().catch(() => {}), CHECK_MS);
  handle.unref?.();
  logger.info({ hourUtc: sendHourUtc() }, "Daily reports scheduled");
}

export function stopDailyReports(): void {
  if (handle) {
    clearInterval(handle);
    handle = null;
  }
}
