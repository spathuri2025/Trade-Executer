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
  supportThreadsTable,
  supportMessagesTable,
  announcementsTable,
  type SubscriptionRow,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin";
import { getUserBrokerConnectionStatus } from "../lib/brokerCredentialsService";
import { peekBotRunning, stopBot } from "../lib/botEngine";
import { evictCapitalStream } from "../lib/capitalStream";
import { notifyUser, broadcastAnnouncement } from "../lib/notificationService";
import { recordAudit, listAudit, lookupEmail } from "../lib/auditService";
import { getEffectivePlan } from "../lib/planService";
import { sendWatchdogTestAlert } from "../lib/watchdogRuntime";

const router: IRouter = Router();
// Scoped to /admin paths, NOT router.use(requireAdmin) bare. This router is
// mounted path-less in routes/index.ts, so a path-less gate would intercept
// EVERY request that reaches this point in the chain and 403 non-admins
// before later routers (/plan, /support, /notifications, …) could match.
// That exact bug silently broke the plan card and upgrade requests for every
// customer until 17 Aug 2026 — only admins ever passed, so it was invisible
// to the operator. Every route in this file starts with /admin, so the path
// scope loses nothing.
router.use("/admin", requireAdmin);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function parseUserId(raw: string | string[]): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.post("/admin/watchdog/test-alert", async (_req, res): Promise<void> => {
  const result = await sendWatchdogTestAlert();
  res.json({
    running: result !== null,
    recipients: result?.recipients ?? [],
    sent: result?.sent ?? 0,
    alertEmailConfigured: Boolean(process.env["ALERT_EMAIL"]),
  });
});

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
      const [broker, effectivePlan] = await Promise.all([
        getUserBrokerConnectionStatus(u.id),
        // The stored subscription row is NOT the answer to "what can this
        // account do?" — a lapsed row still reads "pro", and an admin with no
        // row at all is entitled to everything. Testing found the console
        // showing id 1 as "free" while that account held enterprise
        // entitlements. Report both: the billing row, and the truth.
        getEffectivePlan(u.id),
      ]);
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
        effectivePlan,
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

  await recordAudit(req.user!, {
    action: "customer_suspended",
    targetUserId: id,
    targetEmail: updated.email,
    detail: "Account suspended; bot stopped and live stream evicted.",
  });

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

  await recordAudit(req.user!, {
    action: "customer_unsuspended",
    targetUserId: id,
    targetEmail: updated.email,
  });

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

  // Captured BEFORE the delete — afterwards the email is gone and the audit
  // row could only say "user 2", which is the uninformative answer this whole
  // table exists to prevent.
  const targetEmail = await lookupEmail(id);

  const [deleted] = await db.delete(usersTable).where(eq(usersTable.id, id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }

  await recordAudit(req.user!, {
    action: "customer_deleted",
    targetUserId: id,
    targetEmail: targetEmail ?? undefined,
    detail: "Account and all associated data permanently deleted.",
  });

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
  // Read the prior state first so the audit entry records the CHANGE, not just
  // the new value — "free → pro" is the useful record, "pro" alone isn't.
  const [before] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.userId, id));

  const [row] = await db
    .insert(subscriptionsTable)
    .values(values)
    .onConflictDoUpdate({ target: subscriptionsTable.userId, set: values })
    .returning();

  const wasPlan = before?.plan ?? "none";
  const wasStatus = before?.status ?? "none";
  const wasRenews = before?.renewsAt?.toISOString().slice(0, 10) ?? "never";
  const nowRenews = renewsAt?.toISOString().slice(0, 10) ?? "never";
  await recordAudit(req.user!, {
    action: "subscription_updated",
    targetUserId: id,
    targetEmail: await lookupEmail(id) ?? undefined,
    detail: `plan: ${wasPlan} → ${plan}; status: ${wasStatus} → ${status}; renews: ${wasRenews} → ${nowRenews}`,
  });

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

  // Close the loop with the requester: they asked from inside the app, so the
  // outcome should arrive the same way (plus email). "Handled" nearly always
  // means the plan was granted on the customer record moments earlier.
  await recordAudit(req.user!, {
    action: "upgrade_request_resolved",
    targetUserId: row.userId,
    targetEmail: await lookupEmail(row.userId) ?? undefined,
    detail: `Upgrade request #${row.id} marked ${status}.`,
  });

  if (status === "handled") {
    await notifyUser(row.userId, {
      type: "upgrade_handled",
      title: "Your upgrade request has been processed",
      body: "Good news — your upgrade request has been handled. Check Settings to see your current plan, or reply in your Inbox if anything looks wrong.",
      link: "/settings",
    });
  }

  res.json({ id: row.id, status: row.status });
});

// ---------------------------------------------------------------------------
// Support inbox — the operator side of the communication centre.
// ---------------------------------------------------------------------------

/** Every thread, unread first then latest activity, joined to the user's email. */
router.get("/admin/support/threads", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: supportThreadsTable.id,
      subject: supportThreadsTable.subject,
      status: supportThreadsTable.status,
      adminUnread: supportThreadsTable.adminUnread,
      lastMessageAt: supportThreadsTable.lastMessageAt,
      createdAt: supportThreadsTable.createdAt,
      userId: supportThreadsTable.userId,
      userEmail: usersTable.email,
    })
    .from(supportThreadsTable)
    .innerJoin(usersTable, eq(supportThreadsTable.userId, usersTable.id))
    .orderBy(desc(supportThreadsTable.adminUnread), desc(supportThreadsTable.lastMessageAt));

  res.json({
    threads: rows.map((t) => ({
      id: t.id,
      subject: t.subject,
      status: t.status,
      unread: t.adminUnread,
      lastMessageAt: t.lastMessageAt.toISOString(),
      createdAt: t.createdAt.toISOString(),
      userId: t.userId,
      userEmail: t.userEmail,
    })),
  });
});

/** One thread with messages; opening it marks it read on the admin side. */
router.get("/admin/support/threads/:id", async (req, res): Promise<void> => {
  const threadId = parseUserId(req.params.id);
  if (!threadId) {
    res.status(400).json({ error: "Invalid thread id" });
    return;
  }

  const [thread] = await db
    .select({
      id: supportThreadsTable.id,
      subject: supportThreadsTable.subject,
      status: supportThreadsTable.status,
      lastMessageAt: supportThreadsTable.lastMessageAt,
      createdAt: supportThreadsTable.createdAt,
      userId: supportThreadsTable.userId,
      userEmail: usersTable.email,
      adminUnread: supportThreadsTable.adminUnread,
    })
    .from(supportThreadsTable)
    .innerJoin(usersTable, eq(supportThreadsTable.userId, usersTable.id))
    .where(eq(supportThreadsTable.id, threadId));
  if (!thread) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }

  const messages = await db
    .select()
    .from(supportMessagesTable)
    .where(eq(supportMessagesTable.threadId, threadId))
    .orderBy(supportMessagesTable.createdAt);

  if (thread.adminUnread) {
    await db.update(supportThreadsTable).set({ adminUnread: false }).where(eq(supportThreadsTable.id, threadId));
  }

  res.json({
    id: thread.id,
    subject: thread.subject,
    status: thread.status,
    unread: false,
    lastMessageAt: thread.lastMessageAt.toISOString(),
    createdAt: thread.createdAt.toISOString(),
    userId: thread.userId,
    userEmail: thread.userEmail,
    messages: messages.map((m) => ({
      id: m.id,
      senderRole: m.senderRole,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    })),
  });
});

/** Reply to a thread — the user gets an in-app notification and an email. */
router.post("/admin/support/threads/:id/messages", async (req, res): Promise<void> => {
  const threadId = parseUserId(req.params.id);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const message = typeof body["body"] === "string" ? body["body"].trim() : "";

  if (!threadId) {
    res.status(400).json({ error: "Invalid thread id" });
    return;
  }
  if (!message || message.length > 5000) {
    res.status(400).json({ error: message ? "Message too long" : "A message is required" });
    return;
  }

  const [thread] = await db.select().from(supportThreadsTable).where(eq(supportThreadsTable.id, threadId));
  if (!thread) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }

  await db.insert(supportMessagesTable).values({ threadId, senderRole: "admin", body: message });
  await db
    .update(supportThreadsTable)
    .set({ userUnread: true, lastMessageAt: new Date() })
    .where(eq(supportThreadsTable.id, threadId));

  await notifyUser(thread.userId, {
    type: "support_reply",
    title: `Reply on "${thread.subject}"`,
    body: message,
    link: "/inbox",
  });

  await recordAudit(req.user!, {
    action: "support_replied",
    targetUserId: thread.userId,
    targetEmail: await lookupEmail(thread.userId) ?? undefined,
    detail: `Replied on thread #${threadId} "${thread.subject}".`,
  });

  res.sendStatus(204);
});

/** Close or reopen a thread. */
router.patch("/admin/support/threads/:id", async (req, res): Promise<void> => {
  const threadId = parseUserId(req.params.id);
  const status = (req.body ?? {})["status"];
  if (!threadId) {
    res.status(400).json({ error: "Invalid thread id" });
    return;
  }
  if (status !== "open" && status !== "closed") {
    res.status(400).json({ error: "status must be 'open' or 'closed'" });
    return;
  }

  const [row] = await db
    .update(supportThreadsTable)
    .set({ status })
    .where(eq(supportThreadsTable.id, threadId))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }

  await recordAudit(req.user!, {
    action: "support_thread_status_changed",
    targetUserId: row.userId,
    targetEmail: await lookupEmail(row.userId) ?? undefined,
    detail: `Thread #${row.id} set to ${status}.`,
  });

  res.json({ id: row.id, status: row.status });
});

// ---------------------------------------------------------------------------
// Announcements — one message to every active user.
// ---------------------------------------------------------------------------

router.post("/admin/announcements", async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const title = typeof body["title"] === "string" ? body["title"].trim() : "";
  const text = typeof body["body"] === "string" ? body["body"].trim() : "";

  if (!title || !text) {
    res.status(400).json({ error: "A title and a body are both required" });
    return;
  }
  if (title.length > 200 || text.length > 5000) {
    res.status(400).json({ error: "Announcement too long" });
    return;
  }

  try {
    const result = await broadcastAnnouncement(title, text, req.user!.id);
    await recordAudit(req.user!, {
      action: "announcement_sent",
      detail: `"${title}" sent to ${result.recipients} user${result.recipients === 1 ? "" : "s"}.`,
    });
    res.status(201).json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to broadcast announcement");
    res.status(500).json({ error: "Failed to send the announcement" });
  }
});

/**
 * The admin audit trail. Read-only by design — there is no endpoint to edit or
 * delete entries, because a log an admin can rewrite answers nothing.
 */
router.get("/admin/audit-log", async (_req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  res.json({ entries: await listAudit(100) });
});

router.get("/admin/announcements", async (_req, res): Promise<void> => {
  const rows = await db.select().from(announcementsTable).orderBy(desc(announcementsTable.createdAt)).limit(50);
  res.json({
    announcements: rows.map((a) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      createdAt: a.createdAt.toISOString(),
    })),
  });
});

export default router;
