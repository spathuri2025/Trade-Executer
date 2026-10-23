import { and, eq, isNull } from "drizzle-orm";
import { db, botConfigTable, riskAlertsTable, usersTable } from "@workspace/db";
import { logger } from "./logger";
import { getUserBrokerCredentials } from "./brokerCredentialsService";
import { getBrokerAccount, getBrokerPositions } from "./broker";
import { notifyUser } from "./notificationService";
import { assessRisk, alertMessage, type RiskFinding, type RiskWatchSettings } from "./riskWatch";

/**
 * Runs the risk watch for every account that has it on — see riskWatch.ts.
 *
 * Independent of the bot: the book it watches is mostly manual, and on the
 * account it was built for the bot had been stopped for seventeen days while
 * the risk grew. Each problem is notified once, recorded in risk_alerts.
 */

const CHECK_MS = 5 * 60 * 1000;
const FIRST_CHECK_MS = 60 * 1000;
let handle: ReturnType<typeof setInterval> | null = null;
let first: ReturnType<typeof setTimeout> | null = null;

export interface RiskSnapshot {
  enabled: boolean;
  checkedAt: string;
  currency: string | null;
  equity: number | null;
  cashBalance: number | null;
  findings: RiskFinding[];
}

async function settingsFor(userId: number): Promise<RiskWatchSettings> {
  const [row] = await db
    .select({
      enabled: botConfigTable.riskWatchEnabled,
      maxInstrumentPercent: botConfigTable.riskWatchMaxInstrumentPercent,
      openLossPercent: botConfigTable.riskWatchOpenLossPercent,
    })
    .from(botConfigTable)
    .where(eq(botConfigTable.userId, userId));
  // No settings row yet = the defaults the settings page shows.
  return row ?? { enabled: true, maxInstrumentPercent: 300, openLossPercent: 10 };
}

/** The account's risk as of now. Null when no broker is connected. Throws on broker failure. */
export async function currentRisk(userId: number, now = new Date()): Promise<RiskSnapshot | null> {
  const settings = await settingsFor(userId);
  const credentials = await getUserBrokerCredentials(userId);
  if (!credentials) return null;
  if (!settings.enabled) {
    return { enabled: false, checkedAt: now.toISOString(), currency: null, equity: null, cashBalance: null, findings: [] };
  }
  const [positions, account] = await Promise.all([
    getBrokerPositions(userId, credentials),
    getBrokerAccount(userId, credentials),
  ]);
  // Cash before open positions: equity minus open P&L. On Capital.com this is
  // its `deposit`, and the identity is checked by the balance snapshots.
  const cashBalance = account.total - account.result;
  return {
    enabled: true,
    checkedAt: now.toISOString(),
    currency: account.currency,
    equity: account.total,
    cashBalance,
    findings: assessRisk(positions, { equity: account.total, cashBalance, currency: account.currency }, settings, now),
  };
}

/**
 * Records the findings' keys; returns those findings with at least one key
 * not seen before. The unique index makes this safe if two processes run it.
 */
async function newFindings(userId: number, findings: RiskFinding[]): Promise<RiskFinding[]> {
  const keys = [...new Set(findings.flatMap((f) => f.keys))];
  if (keys.length === 0) return [];
  const inserted = await db
    .insert(riskAlertsTable)
    .values(keys.map((key) => ({ userId, key })))
    .onConflictDoNothing()
    .returning({ key: riskAlertsTable.key });
  const fresh = new Set(inserted.map((r) => r.key));
  return findings.filter((f) => f.keys.some((k) => fresh.has(k)));
}

export async function runRiskWatch(now = new Date()): Promise<{ checked: number; alerted: number }> {
  const users = await db
    .select({ userId: botConfigTable.userId })
    .from(botConfigTable)
    .innerJoin(usersTable, eq(usersTable.id, botConfigTable.userId))
    .where(and(eq(botConfigTable.riskWatchEnabled, true), isNull(usersTable.suspendedAt)));

  let checked = 0;
  let alerted = 0;
  for (const { userId } of users) {
    try {
      const risk = await currentRisk(userId, now);
      if (!risk) continue;
      checked += 1;
      const fresh = await newFindings(userId, risk.findings);
      if (fresh.length === 0) continue;
      await notifyUser(userId, { type: "risk_watch", ...alertMessage(fresh), link: "/" });
      alerted += 1;
      logger.info({ userId, kinds: fresh.map((f) => f.kind) }, "Risk watch alert sent");
    } catch (err) {
      // One account's broker being unreachable must not stop everyone else's.
      logger.warn({ err, userId }, "Risk watch check failed");
    }
  }
  return { checked, alerted };
}

export function startRiskWatch(): void {
  if (handle) return;
  first = setTimeout(() => void runRiskWatch().catch(() => {}), FIRST_CHECK_MS);
  handle = setInterval(() => void runRiskWatch().catch(() => {}), CHECK_MS);
}

export function stopRiskWatch(): void {
  if (first) clearTimeout(first);
  if (handle) clearInterval(handle);
  first = handle = null;
}

