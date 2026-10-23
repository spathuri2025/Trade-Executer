import { and, desc, eq, gte, isNull, isNotNull, sql } from "drizzle-orm";
import { db, notificationsTable, signalsTable, paperPositionsTable, accountBalanceSnapshotsTable } from "@workspace/db";
import { logger } from "./logger";
import { getUserBrokerCredentials } from "./brokerCredentialsService";
import { getBrokerTransactions, getBrokerPositions, getBrokerAccount } from "./broker";
import { notifyUser } from "./notificationService";
import { buildDailyReport, type UnitemisedInput } from "./dailyReport";
import { snapshotConsistent, unitemisedSince, pickSnapshotBaselines } from "./livePerformance";
import { summarisePaper } from "./paperTrading";
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

/**
 * Records this morning's cash balance and measures what moved it without an
 * itemised row since earlier snapshots — the previous report, and about a week
 * ago. See account_balance_snapshots for why this has to be measured.
 *
 * Never throws: a failure here costs one line of the report, not the report.
 */
async function measureUnitemised(
  userId: number,
  credentials: NonNullable<Awaited<ReturnType<typeof getUserBrokerCredentials>>>,
  rows: Parameters<typeof unitemisedSince>[2],
  now: Date
): Promise<UnitemisedInput> {
  try {
    const account = await getBrokerAccount(userId, credentials);
    // NormalizedAccount names Capital.com's `deposit` "invested"; it is the
    // realised cash balance — cash + open P&L = balance, checked below.
    const current = { cashBalance: account.invested, equity: account.total, openPnl: account.result };

    const earlier = await db
      .select()
      .from(accountBalanceSnapshotsTable)
      .where(and(eq(accountBalanceSnapshotsTable.userId, userId), gte(accountBalanceSnapshotsTable.takenAt, new Date(now.getTime() - 9 * DAY_MS))))
      .orderBy(desc(accountBalanceSnapshotsTable.takenAt));

    await db.insert(accountBalanceSnapshotsTable).values({ userId, takenAt: now, ...current, currency: account.currency });

    if (!snapshotConsistent(current)) {
      logger.warn({ userId, ...current }, "Account figures do not add up — not measuring unitemised movements");
      return { state: "inconsistent" };
    }
    const baselines = pickSnapshotBaselines(earlier, now);
    if (baselines.length === 0) return { state: "first" };

    const periods = baselines.map((s) => ({
      since: s.takenAt,
      amount: unitemisedSince(s, current.cashBalance, rows),
    }));
    return { state: "ok", periods };
  } catch (err) {
    logger.warn({ err, userId }, "Could not measure unitemised balance movements");
    return { state: "unavailable" };
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** One pass. Exported for the admin "send now" path and for tests. */
export async function sendDailyReports(
  now: Date = new Date(),
  force = false
): Promise<{ sent: number; failed: number }> {
  if (!force && now.getUTCHours() < sendHourUtc()) return { sent: 0, failed: 0 };

  const recipients = await db.execute(sql`
    select c.user_id, c.running, c.dry_run, c.daily_profit_target,
           c.stop_loss_percent, c.take_profit_percent
    from bot_config c
    join users u on u.id = c.user_id
    where u.suspended_at is null
  `);

  let sent = 0;
  // Counted so "send now" can say a report FAILED, not that nobody has a broker
  // — on 23 Oct 2026 it said the latter while the history read was failing.
  let failed = 0;
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

      // Dry-run results live in paper_positions, not in the broker's history —
      // nothing about a simulated trade ever reaches Capital.com.
      const paperRows = await db
        .select({ pnl: paperPositionsTable.pnl, exitReason: paperPositionsTable.exitReason })
        .from(paperPositionsTable)
        .where(and(eq(paperPositionsTable.userId, userId), isNotNull(paperPositionsTable.closedAt)))
        .catch(() => [] as Array<{ pnl: number | null; exitReason: string | null }>);
      const [{ count: paperOpen } = { count: 0 }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(paperPositionsTable)
        .where(and(eq(paperPositionsTable.userId, userId), isNull(paperPositionsTable.closedAt)))
        .catch(() => [{ count: 0 }]);

      const paperUnmeasured = paperRows.filter((r) => r.exitReason === "unmeasured").length;
      const paper = paperRows.length > 0 || paperOpen > 0
        ? summarisePaper(
            paperRows
              .filter((r) => r.pnl !== null)
              .map((r) => ({ pnl: Number(r.pnl), exitReason: r.exitReason ?? "" }))
          )
        : null;

      // Read separately from the transactions: a positions failure must not
      // cost the whole report, and must not pass for "nothing open" either.
      const openPositions = await getBrokerPositions(userId, credentials).catch((err: unknown) => {
        logger.warn({ err, userId }, "Could not read open positions for the morning report");
        return null;
      });

      const unitemised = await measureUnitemised(userId, credentials, rows, now);

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
        paper,
        paperOpen: Number(paperOpen ?? 0),
        paperUnmeasured,
        openPositions,
        unitemised,
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
      failed += 1;
    }
  }
  return { sent, failed };
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
