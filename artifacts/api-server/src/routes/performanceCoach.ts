import { Router, type IRouter } from "express";
import { count, eq } from "drizzle-orm";
import { db, tradesTable } from "@workspace/db";
import { computePerformanceCoach } from "../lib/performanceCoachService";
import { consumeAiQuota, aiQuotaExceededBody } from "../lib/planService";

const router: IRouter = Router();

/**
 * Per-user cache of the coach's output.
 *
 * Two defects made this necessary, both found in testing. The endpoint charged
 * a quota call on every page load, so a Free customer capped at ten AI calls a
 * day could exhaust the allowance by navigating — without ever asking a
 * question. And because nothing was cached, two consecutive loads of the same
 * unchanged data returned different advice, which reads as the tool being
 * unreliable rather than the model being non-deterministic.
 *
 * Keyed on the user's trade count: new trades are exactly what makes previous
 * advice stale, and nothing else does. The TTL is a backstop for inputs the
 * count cannot see. In memory, like the bot engine's own state — a restart
 * costs one regeneration.
 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<number, { tradeCount: number; at: number; payload: unknown }>();

router.get("/performance/coach", async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const [{ n: tradeCount }] = await db
    .select({ n: count() })
    .from(tradesTable)
    .where(eq(tradesTable.userId, userId));

  const hit = cache.get(userId);
  if (hit && hit.tradeCount === tradeCount && Date.now() - hit.at < CACHE_TTL_MS) {
    // Served without touching the quota: the customer asked for a page, not for
    // a new analysis, and the analysis they would get is the one they have.
    res.set("Cache-Control", "no-store");
    res.json(hit.payload);
    return;
  }

  const quota = await consumeAiQuota(userId);
  if (!quota.allowed) {
    // Out of allowance and nothing cached to fall back on.
    res.status(402).json(aiQuotaExceededBody(quota));
    return;
  }

  try {
    const coach = await computePerformanceCoach(userId);
    cache.set(userId, { tradeCount, at: Date.now(), payload: coach });
    res.set("Cache-Control", "no-store");
    res.json(coach);
  } catch (err) {
    req.log.error({ err }, "Failed to compute performance coach");
    res.status(500).json({ error: "Failed to compute performance coach" });
  }
});

export default router;
