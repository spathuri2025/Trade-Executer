import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

import { usersTable } from "./users";

/**
 * Operator broadcasts. The row is the historical record; delivery happens by
 * fanning one notification row out per user at creation time
 * (notificationService.broadcastAnnouncement). Fan-out at write is the simple
 * and correct choice at this user count — revisit only at thousands of users,
 * where a read-time join against an announcement_reads table would win.
 */
export const announcementsTable = pgTable("announcements", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdBy: integer("created_by")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AnnouncementRow = typeof announcementsTable.$inferSelect;
