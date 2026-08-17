import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

import { usersTable } from "./users";

/**
 * Per-user notifications — the delivery spine of the communication centre.
 * Support replies, announcements and bot events all fan into this one table,
 * so the UI polls a single endpoint and the unread badge is one count.
 *
 * Rows are written only by notificationService.ts; nothing else inserts here,
 * which keeps "what can notify a user" auditable in one file.
 */
export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  type: text("type", {
    enum: ["support_reply", "announcement", "circuit_breaker", "upgrade_handled"],
  }).notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  /** Optional in-app path (e.g. "/inbox") the notification links to. */
  link: text("link"),
  /** Null = unread. */
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type NotificationRow = typeof notificationsTable.$inferSelect;
