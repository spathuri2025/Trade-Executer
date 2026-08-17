import { Router, type IRouter } from "express";
import { db, instrumentsTable, subscriptionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getEffectivePlan, PLAN_LIMITS, getAiQuotaUsage } from "../lib/planService";
import { PLAN_CATALOG, PLAN_ORDER, catalogWithLimits } from "../lib/planCatalog";

/**
 * Public — mounted BEFORE the auth gate in routes/index.ts. Pricing must be
 * visible to a logged-out visitor deciding whether to sign up; hiding it
 * behind login is how a plan comparison ends up screenshot-shared instead of
 * linked. Contains only catalogue data (names, prices, marketing copy, the
 * enforced limits) — nothing user-specific.
 */
export const publicPlansRouter: IRouter = Router();

publicPlansRouter.get("/plans", (_req, res): void => {
  res.json({ plans: PLAN_ORDER.map(catalogWithLimits) });
});

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

  // The raw subscription row, for display only ("renews on…", "trial ends…").
  // Entitlement always comes from getEffectivePlan above — an expired row may
  // well say "pro"/"active" while the effective plan is already free.
  const [subscription] = await db
    .select({ status: subscriptionsTable.status, renewsAt: subscriptionsTable.renewsAt })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, userId));

  const quota = await getAiQuotaUsage(userId);
  const cap = (n: number) => (Number.isFinite(n) ? n : null);

  res.set("Cache-Control", "no-store");
  res.json({
    plan,
    planDisplay: PLAN_CATALOG[plan].displayName,
    status: subscription?.status ?? null,
    renewsAt: subscription?.renewsAt?.toISOString() ?? null,
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
