import { Router, type IRouter } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, notificationsTable } from "@workspace/db";

const router: IRouter = Router();

/**
 * The caller's latest notifications plus their unread count — the endpoint the
 * Inbox nav badge polls (60s interval in the frontend). Capped at 50: the
 * bell is a recent-activity surface, not an archive.
 */
router.get("/notifications", async (req, res): Promise<void> => {
  try {
    const rows = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.userId, req.user!.id))
      .orderBy(desc(notificationsTable.createdAt))
      .limit(50);

    const unread = await db
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(and(eq(notificationsTable.userId, req.user!.id), isNull(notificationsTable.readAt)));

    res.set("Cache-Control", "no-store");
    res.json({
      unreadCount: unread.length,
      notifications: rows.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        link: n.link,
        read: n.readAt !== null,
        createdAt: n.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list notifications");
    res.status(500).json({ error: "Failed to load notifications" });
  }
});

/** Mark all of the caller's notifications read. */
router.post("/notifications/read-all", async (req, res): Promise<void> => {
  try {
    await db
      .update(notificationsTable)
      .set({ readAt: new Date() })
      .where(and(eq(notificationsTable.userId, req.user!.id), isNull(notificationsTable.readAt)));
    res.sendStatus(204);
  } catch (err) {
    req.log.error({ err }, "Failed to mark notifications read");
    res.status(500).json({ error: "Failed to update notifications" });
  }
});

export default router;
