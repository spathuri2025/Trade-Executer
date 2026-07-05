import { Router, type IRouter } from "express";
import { db, marketBrainSnapshotsTable, type MarketBrainSnapshot } from "@workspace/db";
import { desc } from "drizzle-orm";
import { generateMarketBrain } from "../lib/marketBrainService";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Same public-endpoint safeguard as the daily market brief: a small cooldown to
// blunt accidental double-generation while there is no auth.
const COOLDOWN_MS = 60_000;
let lastCreateAt = 0;
let creating = false;

function serialize(s: MarketBrainSnapshot) {
  return {
    id: s.id,
    regime: s.regime,
    confidence: s.confidence,
    drivers: s.drivers,
    highImpactNewsCount: s.highImpactNewsCount,
    upcomingEvents: s.upcomingEvents,
    opportunities: s.opportunities,
    risks: s.risks,
    disclaimer: s.disclaimer,
    createdAt: s.createdAt.toISOString(),
  };
}

function isFresh(date: Date): boolean {
  // A brain snapshot is considered fresh for 6 hours.
  return Date.now() - date.getTime() < 6 * 60 * 60 * 1000;
}

async function fetchLatest(): Promise<MarketBrainSnapshot | undefined> {
  const [latest] = await db
    .select()
    .from(marketBrainSnapshotsTable)
    .orderBy(desc(marketBrainSnapshotsTable.createdAt))
    .limit(1);
  return latest;
}

function triggerBackgroundGeneration(): void {
  creating = true;
  lastCreateAt = Date.now();
  void (async () => {
    try {
      const generated = await generateMarketBrain();
      await db.insert(marketBrainSnapshotsTable).values(generated);
      logger.info("Auto-generated market brain snapshot");
    } catch (err) {
      logger.error({ err }, "Background market brain generation failed");
    } finally {
      creating = false;
    }
  })();
}

router.get("/market-brain/latest", async (req, res): Promise<void> => {
  try {
    const latest = await fetchLatest();
    const needsFresh = !latest || !isFresh(latest.createdAt);
    if (needsFresh && !creating && Date.now() - lastCreateAt >= COOLDOWN_MS) {
      triggerBackgroundGeneration();
    }
    res.set("Cache-Control", "no-store");
    res.json({ snapshot: latest ? serialize(latest) : null });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch latest market brain");
    res.status(500).json({ error: "Failed to fetch latest market brain" });
  }
});

router.post("/market-brain/generate", async (req, res): Promise<void> => {
  if (creating || Date.now() - lastCreateAt < COOLDOWN_MS) {
    res.status(429).json({ error: "A snapshot was just generated. Please wait a moment." });
    return;
  }
  creating = true;
  try {
    const generated = await generateMarketBrain();
    const [saved] = await db.insert(marketBrainSnapshotsTable).values(generated).returning();
    if (!saved) throw new Error("Failed to persist market brain snapshot");
    lastCreateAt = Date.now();
    res.status(201).json(serialize(saved));
  } catch (err) {
    req.log.error({ err }, "Failed to generate market brain");
    res.status(502).json({ error: "Failed to generate market brain" });
  } finally {
    creating = false;
  }
});

export default router;
