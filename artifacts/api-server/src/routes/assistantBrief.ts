import { Router, type IRouter } from "express";
import { db, userAiBriefsTable, type UserAiBrief } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { generateAssistantDailyBrief } from "../lib/assistantDailyBriefService";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const COOLDOWN_MS = 60_000;
/** Per-user generation state — this brief is grounded in the requesting user's
 * own account/watchlist, so generation (and its cooldown) must not be shared
 * across customers. */
const lastCreateAtByUser = new Map<number, number>();
const creatingByUser = new Set<number>();

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function serialize(b: UserAiBrief) {
  return {
    id: b.id,
    briefDate: b.briefDate,
    message: b.message,
    highlights: b.highlights,
    disclaimer: b.disclaimer,
    createdAt: b.createdAt.toISOString(),
  };
}

async function fetchLatest(userId: number): Promise<UserAiBrief | undefined> {
  const [latest] = await db
    .select()
    .from(userAiBriefsTable)
    .where(eq(userAiBriefsTable.userId, userId))
    .orderBy(desc(userAiBriefsTable.createdAt))
    .limit(1);
  return latest;
}

function triggerBackgroundGeneration(userId: number): void {
  creatingByUser.add(userId);
  lastCreateAtByUser.set(userId, Date.now());
  void (async () => {
    try {
      const generated = await generateAssistantDailyBrief(userId);
      await db.insert(userAiBriefsTable).values({ ...generated, userId, briefDate: todayUtc() });
      logger.info({ userId }, "Auto-generated assistant daily brief");
    } catch (err) {
      logger.error({ userId, err }, "Background assistant daily brief generation failed");
    } finally {
      creatingByUser.delete(userId);
    }
  })();
}

router.get("/assistant/daily-brief", async (req, res): Promise<void> => {
  const userId = req.user!.id;
  try {
    const latest = await fetchLatest(userId);
    const needsFresh = !latest || latest.briefDate !== todayUtc();
    const lastCreateAt = lastCreateAtByUser.get(userId) ?? 0;
    if (needsFresh && !creatingByUser.has(userId) && Date.now() - lastCreateAt >= COOLDOWN_MS) {
      triggerBackgroundGeneration(userId);
    }
    res.set("Cache-Control", "no-store");
    res.json({ brief: latest ? serialize(latest) : null });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch assistant daily brief");
    res.status(500).json({ error: "Failed to fetch assistant daily brief" });
  }
});

export default router;
