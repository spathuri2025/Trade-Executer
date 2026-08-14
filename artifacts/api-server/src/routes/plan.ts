import { Router, type IRouter } from "express";
import { db, instrumentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getEffectivePlan, PLAN_LIMITS, getAiQuotaUsage } from "../lib/planService";

const router: IRouter = Router();

/**
 * The caller's own entitlements and current usage, so the UI can show what's
 * included and what's left rather than guessing (or discovering a limit only
 * by hitting a 402).
 *
 * `Infinity` isn't valid JSON, so uncapped limits serialize as null and the
 * frontend renders them as "Unlimited".
 */
router.get("/plan", async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const plan = await getEffectivePlan(userId);
  const limits = PLAN_LIMITS[plan];

  const instruments = await db
    .select({ id: instrumentsTable.id })
    .from(instrumentsTable)
    .where(eq(instrumentsTable.userId, userId));

  const quota = await getAiQuotaUsage(userId);
  const cap = (n: number) => (Number.isFinite(n) ? n : null);

  res.set("Cache-Control", "no-store");
  res.json({
    plan,
    limits: {
      liveTrading: limits.liveTrading,
      aiTradeModes: limits.aiTradeModes,
      maxInstruments: cap(limits.maxInstruments),
      aiQueriesPerDay: cap(limits.aiQueriesPerDay),
    },
    usage: {
      instruments: instruments.length,
      aiQueriesToday: quota.used,
    },
  });
});

export default router;
