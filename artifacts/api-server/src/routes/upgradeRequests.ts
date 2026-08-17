import { Router, type IRouter } from "express";
import { db, upgradeRequestsTable, type UpgradeRequestRow } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { getEffectivePlan } from "../lib/planService";

const router: IRouter = Router();

const TRIGGERS = new Set<UpgradeRequestRow["trigger"]>([
  "live_trading",
  "ai_trade_modes",
  "instrument_cap",
  "ai_quota",
  "plan_card",
]);

const MAX_MESSAGE_LENGTH = 1000;

/**
 * Ask to be upgraded. Raised from whichever paywall the user just hit, so the
 * admin sees what actually blocked them rather than a bare "wants more".
 *
 * A user may only have ONE pending request at a time: asking again updates the
 * existing one instead of inserting a duplicate. That keeps the admin queue
 * meaningful (one row per waiting customer) and means repeatedly clicking the
 * button can't flood the table.
 */
router.post("/upgrade-requests", async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  const trigger = body["trigger"];
  if (typeof trigger !== "string" || !TRIGGERS.has(trigger as UpgradeRequestRow["trigger"])) {
    res.status(400).json({ error: "A valid trigger is required" });
    return;
  }

  const rawMessage = typeof body["message"] === "string" ? body["message"].trim() : "";
  if (rawMessage.length > MAX_MESSAGE_LENGTH) {
    res.status(400).json({ error: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer` });
    return;
  }
  const message = rawMessage.length > 0 ? rawMessage : null;

  const userId = req.user!.id;
  const [existing] = await db
    .select({ id: upgradeRequestsTable.id })
    .from(upgradeRequestsTable)
    .where(and(eq(upgradeRequestsTable.userId, userId), eq(upgradeRequestsTable.status, "pending")));

  const [row] = existing
    ? await db
        .update(upgradeRequestsTable)
        .set({ trigger: trigger as UpgradeRequestRow["trigger"], message, createdAt: new Date() })
        .where(eq(upgradeRequestsTable.id, existing.id))
        .returning()
    : await db
        .insert(upgradeRequestsTable)
        .values({ userId, trigger: trigger as UpgradeRequestRow["trigger"], message })
        .returning();

  req.log.info({ userId, trigger }, "Upgrade request raised");
  res.status(201).json({
    id: row?.id ?? existing?.id ?? 0,
    status: "pending",
    alreadyPending: Boolean(existing),
  });
});

/**
 * The caller's own pending request, so the UI can show "we've got your
 * request" rather than inviting them to ask again.
 */
router.get("/upgrade-requests/mine", async (req, res): Promise<void> => {
  const [row] = await db
    .select()
    .from(upgradeRequestsTable)
    .where(and(eq(upgradeRequestsTable.userId, req.user!.id), eq(upgradeRequestsTable.status, "pending")))
    .orderBy(desc(upgradeRequestsTable.createdAt));

  res.set("Cache-Control", "no-store");
  res.json({
    pending: row
      ? { id: row.id, trigger: row.trigger, message: row.message, createdAt: row.createdAt.toISOString() }
      : null,
    plan: await getEffectivePlan(req.user!.id),
  });
});

export default router;
