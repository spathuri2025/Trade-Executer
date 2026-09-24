import { and, asc, eq } from "drizzle-orm";
import {
  db,
  tradingProfilesTable,
  profileActivationsTable,
  botConfigTable,
  type TradingProfileRow,
} from "@workspace/db";
import { logger } from "./logger";
import { getBotStatus, updateConfig, type BotConfig } from "./botEngine";

/**
 * Trading modes: the settings that define HOW the engine trades, applied in one
 * click. See the schema for why risk limits are deliberately excluded.
 */

/** The fields a profile owns. Everything else is account-level and untouched by a switch. */
export type ProfileSettings = Pick<
  BotConfig,
  | "strategyMode"
  | "barResolution"
  | "intervalMinutes"
  | "stopLossPercent"
  | "takeProfitPercent"
  | "minEdgeVsSpread"
  | "aiTradeMode"
  | "minAiConfidence"
>;

/**
 * Seeds for a user's first two modes. Starting points, not prescriptions — the
 * user saves their own tuning over them, which is why they are not constants
 * the engine reads.
 */
export const DEFAULT_PROFILES: Array<{ name: string } & ProfileSettings> = [
  {
    name: "Scalping",
    strategyMode: "scalp",
    barResolution: "MINUTE",
    intervalMinutes: 1,
    // Exits sized to the move being traded: a scalp expects a fraction of a
    // percent, so a 3% target would never be reached and a 1.5% stop would risk
    // ten times the gain.
    stopLossPercent: 0.3,
    takeProfitPercent: 0.3,
    minEdgeVsSpread: 3,
    // No AI: at one-minute cycles an AI call per cycle costs more per day than
    // the strategy is trying to earn, and the scalp signal would be discarded.
    aiTradeMode: "off",
    minAiConfidence: "medium",
  },
  {
    name: "Intraday",
    strategyMode: "auto",
    barResolution: "MINUTE_5",
    intervalMinutes: 5,
    stopLossPercent: 1.5,
    takeProfitPercent: 3,
    minEdgeVsSpread: 3,
    aiTradeMode: "guard",
    minAiConfidence: "medium",
  },
];

function toSettings(row: TradingProfileRow): ProfileSettings {
  return {
    strategyMode: row.strategyMode,
    barResolution: row.barResolution,
    intervalMinutes: row.intervalMinutes,
    stopLossPercent: row.stopLossPercent,
    takeProfitPercent: row.takeProfitPercent,
    minEdgeVsSpread: row.minEdgeVsSpread,
    aiTradeMode: row.aiTradeMode,
    minAiConfidence: row.minAiConfidence,
  };
}

/** Creates the starter modes the first time a user looks. Idempotent. */
export async function ensureProfiles(userId: number): Promise<TradingProfileRow[]> {
  const existing = await db
    .select()
    .from(tradingProfilesTable)
    .where(eq(tradingProfilesTable.userId, userId))
    .orderBy(asc(tradingProfilesTable.id));
  if (existing.length > 0) return existing;

  await db
    .insert(tradingProfilesTable)
    .values(DEFAULT_PROFILES.map((p) => ({ userId, ...p })))
    .onConflictDoNothing();

  return db
    .select()
    .from(tradingProfilesTable)
    .where(eq(tradingProfilesTable.userId, userId))
    .orderBy(asc(tradingProfilesTable.id));
}

export async function listProfiles(userId: number): Promise<{ profiles: TradingProfileRow[]; activeProfileId: number | null }> {
  const profiles = await ensureProfiles(userId);
  const [row] = await db
    .select({ activeProfileId: botConfigTable.activeProfileId })
    .from(botConfigTable)
    .where(eq(botConfigTable.userId, userId));
  return { profiles, activeProfileId: row?.activeProfileId ?? null };
}

export class ProfileNotFoundError extends Error {}

/**
 * Apply a mode. Goes through updateConfig so the running engine picks it up
 * immediately (and re-arms its timers for a changed interval) rather than
 * waiting for a restart.
 */
export async function activateProfile(userId: number, profileId: number) {
  const [profile] = await db
    .select()
    .from(tradingProfilesTable)
    .where(and(eq(tradingProfilesTable.id, profileId), eq(tradingProfilesTable.userId, userId)));
  if (!profile) throw new ProfileNotFoundError("No such trading mode");

  const status = await updateConfig(userId, { ...toSettings(profile), activeProfileId: profile.id });

  // Recorded so a day's results can later be attributed to the mode that
  // produced them — the whole point of having modes.
  await db.insert(profileActivationsTable).values({ userId, profileName: profile.name });
  logger.info({ userId, profile: profile.name }, "Trading mode activated");

  return { status, profile };
}

/** Overwrite a profile with the settings currently in force — "save my tuning". */
export async function saveCurrentIntoProfile(userId: number, profileId: number): Promise<TradingProfileRow> {
  const status = await getBotStatus(userId);
  const c = status.config;
  const [updated] = await db
    .update(tradingProfilesTable)
    .set({
      strategyMode: c.strategyMode,
      barResolution: c.barResolution,
      intervalMinutes: c.intervalMinutes,
      stopLossPercent: c.stopLossPercent,
      takeProfitPercent: c.takeProfitPercent,
      minEdgeVsSpread: c.minEdgeVsSpread,
      aiTradeMode: c.aiTradeMode,
      minAiConfidence: c.minAiConfidence,
      updatedAt: new Date(),
    })
    .where(and(eq(tradingProfilesTable.id, profileId), eq(tradingProfilesTable.userId, userId)))
    .returning();
  if (!updated) throw new ProfileNotFoundError("No such trading mode");
  return updated;
}

/** Modes active during a period, most recent first — for the morning report. */
export async function modesActiveBetween(userId: number, from: Date, to: Date): Promise<string[]> {
  const rows = await db
    .select({ profileName: profileActivationsTable.profileName, activatedAt: profileActivationsTable.activatedAt })
    .from(profileActivationsTable)
    .where(eq(profileActivationsTable.userId, userId))
    .orderBy(asc(profileActivationsTable.activatedAt));

  const names: string[] = [];
  let carried: string | null = null;
  for (const r of rows) {
    if (r.activatedAt < from) carried = r.profileName; // in force when the period opened
    else if (r.activatedAt < to) names.push(r.profileName);
  }
  if (carried) names.unshift(carried);
  return [...new Set(names)];
}
