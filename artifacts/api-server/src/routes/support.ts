import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, supportThreadsTable, supportMessagesTable } from "@workspace/db";
import { notifyAdmins } from "../lib/notificationService";

const router: IRouter = Router();

const MAX_SUBJECT = 200;
const MAX_BODY = 5000;

function threadShape(row: typeof supportThreadsTable.$inferSelect) {
  return {
    id: row.id,
    subject: row.subject,
    status: row.status,
    unread: row.userUnread,
    lastMessageAt: row.lastMessageAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** The caller's threads, most recent activity first. */
router.get("/support/threads", async (req, res): Promise<void> => {
  try {
    const rows = await db
      .select()
      .from(supportThreadsTable)
      .where(eq(supportThreadsTable.userId, req.user!.id))
      .orderBy(desc(supportThreadsTable.lastMessageAt));
    res.json({ threads: rows.map(threadShape) });
  } catch (err) {
    req.log.error({ err }, "Failed to list support threads");
    res.status(500).json({ error: "Failed to load your messages" });
  }
});

/** Start a new thread with its first message. */
router.post("/support/threads", async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const subject = typeof body["subject"] === "string" ? body["subject"].trim() : "";
  const message = typeof body["body"] === "string" ? body["body"].trim() : "";

  if (!subject || !message) {
    res.status(400).json({ error: "A subject and a message are both required" });
    return;
  }
  if (subject.length > MAX_SUBJECT || message.length > MAX_BODY) {
    res.status(400).json({ error: "Your message is too long" });
    return;
  }

  try {
    const [thread] = await db
      .insert(supportThreadsTable)
      .values({ userId: req.user!.id, subject, adminUnread: true })
      .returning();
    if (!thread) throw new Error("Failed to create thread");

    await db.insert(supportMessagesTable).values({ threadId: thread.id, senderRole: "user", body: message });

    // The operator must hear about this without watching the app — badge in
    // their own Inbox plus email. Best-effort: a notification failure must
    // not fail the customer's send.
    await notifyAdmins({
      type: "support_message",
      title: `New support message from ${req.user!.email}`,
      body: `${subject}\n\n${message}`,
      link: "/admin",
    });

    req.log.info({ threadId: thread.id }, "Support thread created");
    res.status(201).json(threadShape(thread));
  } catch (err) {
    req.log.error({ err }, "Failed to create support thread");
    res.status(500).json({ error: "Failed to send your message" });
  }
});

/**
 * One thread with its messages. Ownership is enforced in the WHERE clause, so
 * another user's thread id behaves exactly like a missing one (404) — no
 * probing which ids exist.
 */
router.get("/support/threads/:id", async (req, res): Promise<void> => {
  const threadId = Number(req.params["id"]);
  if (!Number.isInteger(threadId)) {
    res.status(400).json({ error: "Invalid thread id" });
    return;
  }

  try {
    const [thread] = await db
      .select()
      .from(supportThreadsTable)
      .where(and(eq(supportThreadsTable.id, threadId), eq(supportThreadsTable.userId, req.user!.id)));
    if (!thread) {
      res.status(404).json({ error: "Thread not found" });
      return;
    }

    const messages = await db
      .select()
      .from(supportMessagesTable)
      .where(eq(supportMessagesTable.threadId, thread.id))
      .orderBy(supportMessagesTable.createdAt);

    // Opening the thread is what "reads" it.
    if (thread.userUnread) {
      await db
        .update(supportThreadsTable)
        .set({ userUnread: false })
        .where(eq(supportThreadsTable.id, thread.id));
    }

    res.json({
      ...threadShape(thread),
      unread: false,
      messages: messages.map((m) => ({
        id: m.id,
        senderRole: m.senderRole,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    req.log.error({ err, threadId }, "Failed to load support thread");
    res.status(500).json({ error: "Failed to load the conversation" });
  }
});

/** Reply on an existing thread. Writing to a closed thread reopens it. */
router.post("/support/threads/:id/messages", async (req, res): Promise<void> => {
  const threadId = Number(req.params["id"]);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const message = typeof body["body"] === "string" ? body["body"].trim() : "";

  if (!Number.isInteger(threadId)) {
    res.status(400).json({ error: "Invalid thread id" });
    return;
  }
  if (!message || message.length > MAX_BODY) {
    res.status(400).json({ error: message ? "Your message is too long" : "A message is required" });
    return;
  }

  try {
    const [thread] = await db
      .select()
      .from(supportThreadsTable)
      .where(and(eq(supportThreadsTable.id, threadId), eq(supportThreadsTable.userId, req.user!.id)));
    if (!thread) {
      res.status(404).json({ error: "Thread not found" });
      return;
    }

    await db.insert(supportMessagesTable).values({ threadId: thread.id, senderRole: "user", body: message });
    await db
      .update(supportThreadsTable)
      .set({ adminUnread: true, status: "open", lastMessageAt: new Date() })
      .where(eq(supportThreadsTable.id, thread.id));

    await notifyAdmins({
      type: "support_message",
      title: `Reply from ${req.user!.email} on "${thread.subject}"`,
      body: message,
      link: "/admin",
    });

    res.sendStatus(204);
  } catch (err) {
    req.log.error({ err, threadId }, "Failed to send support message");
    res.status(500).json({ error: "Failed to send your message" });
  }
});

export default router;
