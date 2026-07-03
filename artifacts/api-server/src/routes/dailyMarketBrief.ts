import { Router, type IRouter } from "express";
import { db, dailyMarketBriefsTable, type DailyMarketBrief } from "@workspace/db";
import { desc } from "drizzle-orm";
import { generateDailyBrief } from "../lib/dailyBriefService";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * The app has no auth yet, so this endpoint is publicly reachable and each call
 * costs LLM credits. Apply a small in-process cooldown to blunt accidental
 * double-clicks and abusive hammering. Replace with real authz once auth lands.
 */
const CREATE_COOLDOWN_MS = 30_000;
let lastCreateAt = 0;
let creating = false;

function serialize(brief: DailyMarketBrief) {
  return {
    id: brief.id,
    markets: brief.markets,
    disclaimer: brief.disclaimer,
    createdAt: brief.createdAt.toISOString(),
  };
}

/** True when the given date falls on the current UTC calendar day. */
function isFromToday(date: Date): boolean {
  const now = new Date();
  return (
    date.getUTCFullYear() === now.getUTCFullYear() &&
    date.getUTCMonth() === now.getUTCMonth() &&
    date.getUTCDate() === now.getUTCDate()
  );
}

async function fetchLatest(): Promise<DailyMarketBrief | undefined> {
  const [latest] = await db
    .select()
    .from(dailyMarketBriefsTable)
    .orderBy(desc(dailyMarketBriefsTable.createdAt))
    .limit(1);
  return latest;
}

/**
 * Fire-and-forget generation of today's brief. Runs in the background so the GET
 * request can return immediately instead of hanging ~13s on the LLM call. The
 * client polls /latest and picks up the brief once it's saved. Guarded by the
 * shared `creating` flag + cooldown so only one generation runs at a time.
 */
function triggerBackgroundGeneration(): void {
  creating = true;
  lastCreateAt = Date.now();
  void (async () => {
    try {
      const generated = await generateDailyBrief(logger);
      const [saved] = await db
        .insert(dailyMarketBriefsTable)
        .values({ markets: generated.markets, disclaimer: generated.disclaimer })
        .returning();
      if (!saved) throw new Error("Failed to persist generated brief");
      logger.info({ id: saved.id }, "Auto-generated daily market brief");
    } catch (genErr) {
      logger.error({ err: genErr }, "Background auto-generation of daily brief failed");
    } finally {
      creating = false;
    }
  })();
}

router.get("/daily-market-brief/latest", async (req, res): Promise<void> => {
  try {
    const latest = await fetchLatest();

    // Self-populate: if there's no brief for today, kick off generation in the
    // background so every environment (dev + production) fills itself without a
    // manual admin action. The request returns immediately with whatever we have
    // (null or yesterday's brief); the client polls and shows the new one when ready.
    const needsFresh = !latest || !isFromToday(latest.createdAt);
    if (needsFresh && !creating && Date.now() - lastCreateAt >= CREATE_COOLDOWN_MS) {
      triggerBackgroundGeneration();
    }

    // Never cache: while a brief is generating we return null, and the client must
    // see the real brief on its next poll rather than a cached empty response.
    res.set("Cache-Control", "no-store");
    res.json({ brief: latest ? serialize(latest) : null });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch latest daily market brief");
    res.status(500).json({ error: "Failed to fetch latest daily market brief" });
  }
});

router.post("/daily-market-brief/create", async (req, res): Promise<void> => {
  if (creating || Date.now() - lastCreateAt < CREATE_COOLDOWN_MS) {
    res.status(429).json({ error: "A brief was just generated. Please wait a moment before trying again." });
    return;
  }
  creating = true;
  try {
    const generated = await generateDailyBrief(req.log);

    const [saved] = await db
      .insert(dailyMarketBriefsTable)
      .values({ markets: generated.markets, disclaimer: generated.disclaimer })
      .returning();

    if (!saved) {
      throw new Error("Failed to persist generated brief");
    }

    lastCreateAt = Date.now();
    res.status(201).json(serialize(saved));
  } catch (err) {
    req.log.error({ err }, "Failed to generate daily market brief");
    res.status(502).json({ error: "Failed to generate daily market brief" });
  } finally {
    creating = false;
  }
});

export default router;
