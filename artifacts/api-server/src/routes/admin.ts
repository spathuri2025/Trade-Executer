import { Router, type IRouter } from "express";
import multer from "multer";
import { count, desc, eq, max } from "drizzle-orm";
import {
  db,
  usersTable,
  subscriptionsTable,
  contractsTable,
  tradesTable,
  signalsTable,
  upgradeRequestsTable,
  type SubscriptionRow,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin";
import { getUserBrokerConnectionStatus } from "../lib/brokerCredentialsService";
import { peekBotRunning, stopBot } from "../lib/botEngine";
import { evictCapitalStream } from "../lib/capitalStream";

const router: IRouter = Router();
router.use(requireAdmin);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function parseUserId(raw: string | string[]): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.get("/admin/customers", async (_req, res): Promise<void> => {
  const [users, subscriptions, tradeCounts, signalCounts, lastTrades, lastSignals] = await Promise.all([
    db.select().from(usersTable),
    db.select().from(subscriptionsTable),
    db.select({ userId: tradesTable.userId, n: count() }).from(tradesTable).groupBy(tradesTable.userId),
    db.select({ userId: signalsTable.userId, n: count() }).from(signalsTable).groupBy(signalsTable.userId),
    db.select({ userId: tradesTable.userId, at: max(tradesTable.executedAt) }).from(tradesTable).groupBy(tradesTable.userId),
    db.select({ userId: signalsTable.userId, at: max(signalsTable.createdAt) }).from(signalsTable).groupBy(signalsTable.userId),
  ]);

  const subByUser = new Map(subscriptions.map((s) => [s.userId, s]));
  const tradeCountByUser = new Map(tradeCounts.map((t) => [t.userId, t.n]));
  const signalCountByUser = new Map(signalCounts.map((s) => [s.userId, s.n]));
  const lastTradeByUser = new Map(lastTrades.map((t) => [t.userId, t.at]));
  const lastSignalByUser = new Map(lastSignals.map((s) => [s.userId, s.at]));

  const customers = await Promise.all(
    users.map(async (u) => {
      const broker = await getUserBrokerConnectionStatus(u.id);
      const lastTradeAt = lastTradeByUser.get(u.id) ?? null;
      const lastSignalAt = lastSignalByUser.get(u.id) ?? null;
      const lastActivityAt =
        lastTradeAt && lastSignalAt
          ? lastTradeAt > lastSignalAt
            ? lastTradeAt
            : lastSignalAt
          : (lastTradeAt ?? lastSignalAt);

      return {
        id: u.id,
        email: u.email,
        role: u.role,
        suspendedAt: u.suspendedAt?.toISOString() ?? null,
        createdAt: u.createdAt.toISOString(),
        broker,
        botRunning: peekBotRunning(u.id),
        subscription: subscriptionToJson(subByUser.get(u.id) ?? null),
        tradeCount: tradeCountByUser.get(u.id) ?? 0,
        signalCount: signalCountByUser.get(u.id) ?? 0,
        lastActivityAt: lastActivityAt?.toISOString() ?? null,
      };
    })
  );

  res.json({ customers });
});

router.post("/admin/customers/:id/suspend", async (req, res): Promise<void> => {
  const id = parseUserId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid customer id" });
    return;
  }
  if (id === req.user!.id) {
    res.status(400).json({ error: "You cannot suspend your own account" });
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set({ suspendedAt: new Date() })
    .where(eq(usersTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }

  // Suspension must take effect immediately, not just block future logins.
  await stopBot(id);
  evictCapitalStream(id);

  res.json({ id: updated.id, suspendedAt: updated.suspendedAt?.toISOString() ?? null });
});

router.post("/admin/customers/:id/unsuspend", async (req, res): Promise<void> => {
  const id = parseUserId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid customer id" });
    return;
  }

  const [updated] = await db.update(usersTable).set({ suspendedAt: null }).where(eq(usersTable.id, id)).returning();
  if (!updated) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }

  res.json({ id: updated.id, suspendedAt: null });
});

router.delete("/admin/customers/:id", async (req, res): Promise<void> => {
  const id = parseUserId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid customer id" });
    return;
  }
  if (id === req.user!.id) {
    res.status(400).json({ error: "You cannot delete your own account" });
    return;
  }

  await stopBot(id);
  evictCapitalStream(id);

  const [deleted] = await db.delete(usersTable).where(eq(usersTable.id, id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }

  res.sendStatus(204);
});

function subscriptionToJson(row: SubscriptionRow | null) {
  if (!row) return { plan: "free" as const, status: "active" as const, notes: null, renewsAt: null };
  return {
    plan: row.plan,
    status: row.status,
    notes: row.notes,
    renewsAt: row.renewsAt?.toISOString() ?? null,
  };
}

router.put("/admin/customers/:id/subscription", async (req, res): Promise<void> => {
  const id = parseUserId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid customer id" });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const plan = body["plan"];
  const status = body["status"];
  const notes = typeof body["notes"] === "string" ? body["notes"] : null;
  const renewsAt = typeof body["renewsAt"] === "string" && body["renewsAt"] ? new Date(body["renewsAt"]) : null;

  const validPlans = ["free", "starter", "pro", "enterprise"];
  const validStatuses = ["active", "trialing", "past_due", "canceled"];
  if (typeof plan !== "string" || !validPlans.includes(plan)) {
    res.status(400).json({ error: `plan must be one of ${validPlans.join(", ")}` });
    return;
  }
  if (typeof status !== "string" || !validStatuses.includes(status)) {
    res.status(400).json({ error: `status must be one of ${validStatuses.join(", ")}` });
    return;
  }

  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, id));
  if (!user) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }

  const values = {
    userId: id,
    plan: plan as SubscriptionRow["plan"],
    status: status as SubscriptionRow["status"],
    notes,
    renewsAt,
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(subscriptionsTable)
    .values(values)
    .onConflictDoUpdate({ target: subscriptionsTable.userId, set: values })
    .returning();

  res.json(subscriptionToJson(row ?? null));
});

router.get("/admin/customers/:id/contracts", async (req, res): Promise<void> => {
  const id = parseUserId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid customer id" });
    return;
  }

  const rows = await db
    .select({
      id: contractsTable.id,
      fileName: contractsTable.fileName,
      fileType: contractsTable.fileType,
      fileSize: contractsTable.fileSize,
      notes: contractsTable.notes,
      uploadedAt: contractsTable.uploadedAt,
    })
    .from(contractsTable)
    .where(eq(contractsTable.userId, id))
    .orderBy(desc(contractsTable.uploadedAt));

  res.json({
    contracts: rows.map((r) => ({ ...r, uploadedAt: r.uploadedAt.toISOString() })),
  });
});

// Not declared in OpenAPI — multipart/form-data upload, same exception as SSE endpoints.
router.post("/admin/customers/:id/contracts", upload.single("file"), async (req, res): Promise<void> => {
  const id = parseUserId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid customer id" });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "A file is required" });
    return;
  }

  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, id));
  if (!user) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }

  const notes = typeof req.body?.notes === "string" && req.body.notes ? req.body.notes : null;

  const [row] = await db
    .insert(contractsTable)
    .values({
      userId: id,
      fileName: req.file.originalname,
      fileType: req.file.mimetype,
      fileSize: req.file.size,
      fileData: req.file.buffer.toString("base64"),
      notes,
    })
    .returning({
      id: contractsTable.id,
      fileName: contractsTable.fileName,
      fileType: contractsTable.fileType,
      fileSize: contractsTable.fileSize,
      notes: contractsTable.notes,
      uploadedAt: contractsTable.uploadedAt,
    });

  res.status(201).json({ ...row, uploadedAt: row!.uploadedAt.toISOString() });
});

router.delete("/admin/contracts/:contractId", async (req, res): Promise<void> => {
  const contractId = parseUserId(req.params.contractId);
  if (!contractId) {
    res.status(400).json({ error: "Invalid contract id" });
    return;
  }

  const [deleted] = await db.delete(contractsTable).where(eq(contractsTable.id, contractId)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Contract not found" });
    return;
  }
  res.sendStatus(204);
});

// Not declared in OpenAPI — raw binary response, same exception as SSE endpoints.
router.get("/admin/contracts/:contractId/download", async (req, res): Promise<void> => {
  const contractId = parseUserId(req.params.contractId);
  if (!contractId) {
    res.status(400).json({ error: "Invalid contract id" });
    return;
  }

  const [row] = await db.select().from(contractsTable).where(eq(contractsTable.id, contractId));
  if (!row) {
    res.status(404).json({ error: "Contract not found" });
    return;
  }

  res.set("Content-Type", row.fileType);
  res.set("Content-Disposition", `attachment; filename="${row.fileName.replace(/"/g, "")}"`);
  res.send(Buffer.from(row.fileData, "base64"));
});

/**
 * Upgrade requests waiting to be actioned. Returns pending ones only — this is
 * a work queue, not an archive — joined to the customer so the admin can see
 * who is asking, what blocked them, and what plan they're on now, without
 * cross-referencing the customer list.
 */
router.get("/admin/upgrade-requests", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: upgradeRequestsTable.id,
      userId: upgradeRequestsTable.userId,
      email: usersTable.email,
      trigger: upgradeRequestsTable.trigger,
      message: upgradeRequestsTable.message,
      createdAt: upgradeRequestsTable.createdAt,
      plan: subscriptionsTable.plan,
      status: subscriptionsTable.status,
    })
    .from(upgradeRequestsTable)
    .innerJoin(usersTable, eq(usersTable.id, upgradeRequestsTable.userId))
    .leftJoin(subscriptionsTable, eq(subscriptionsTable.userId, upgradeRequestsTable.userId))
    .where(eq(upgradeRequestsTable.status, "pending"))
    .orderBy(desc(upgradeRequestsTable.createdAt));

  res.set("Cache-Control", "no-store");
  res.json({
    pendingCount: rows.length,
    requests: rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      email: r.email,
      trigger: r.trigger,
      message: r.message,
      createdAt: r.createdAt.toISOString(),
      // Current plan, so the admin can see what they're upgrading FROM.
      currentPlan: r.plan ?? "free",
      currentStatus: r.status ?? "active",
    })),
  });
});

/** Mark a request handled (plan granted) or dismissed (declined / spam). */
router.patch("/admin/upgrade-requests/:id", async (req, res): Promise<void> => {
  const id = parseUserId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid request id" });
    return;
  }

  const status = (req.body ?? {})["status"];
  if (status !== "handled" && status !== "dismissed") {
    res.status(400).json({ error: "status must be 'handled' or 'dismissed'" });
    return;
  }

  const [row] = await db
    .update(upgradeRequestsTable)
    .set({ status, resolvedAt: new Date() })
    .where(eq(upgradeRequestsTable.id, id))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Upgrade request not found" });
    return;
  }

  res.json({ id: row.id, status: row.status });
});

export default router;
