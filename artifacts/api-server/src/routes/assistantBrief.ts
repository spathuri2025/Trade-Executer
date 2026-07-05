import { Router, type IRouter } from "express";
import { db, userAiBriefsTable, type UserAiBrief } from "@workspace/db";
import { desc } from "drizzle-orm";
import { generateAssistantDailyBrief } from "../lib/assistantDailyBriefService";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const COOLDOWN_MS = 60_000;
let lastCreateAt = 0;
let creating = false;

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

async function fetchLatest(): Promise<UserAiBrief | undefined> {
  const [latest] = await db
    .select()
    .from(userAiBriefsTable)
    .orderBy(desc(userAiBriefsTable.createdAt))
    .limit(1);
  return latest;
}

function triggerBackgroundGeneration(): void {
  creating = true;
  lastCreateAt = Date.now();
  void (async () => {
    try {
      const generated = await generateAssistantDailyBrief();
      await db.insert(userAiBriefsTable).values({ ...generated, briefDate: todayUtc() });
      logger.info("Auto-generated assistant daily brief");
    } catch (err) {
      logger.error({ err }, "Background assistant daily brief generation failed");
    } finally {
      creating = false;
    }
  })();
}

router.get("/assistant/daily-brief", async (req, res): Promise<void> => {
  try {
    const latest = await fetchLatest();
    const needsFresh = !latest || latest.briefDate !== todayUtc();
    if (needsFresh && !creating && Date.now() - lastCreateAt >= COOLDOWN_MS) {
      triggerBackgroundGeneration();
    }
    res.set("Cache-Control", "no-store");
    res.json({ brief: latest ? serialize(latest) : null });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch assistant daily brief");
    res.status(500).json({ error: "Failed to fetch assistant daily brief" });
  }
});

export default router;
