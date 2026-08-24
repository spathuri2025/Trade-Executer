import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

import { usersTable } from "./users";

/**
 * Permanent record of every admin action — who did what, to whom, and when.
 *
 * Written because on 17 Aug 2026 a customer account vanished and there was no
 * way to establish who deleted it: Render's request logs had rolled, Postgres
 * records no row deletions by default, and the app kept no history of its own.
 * The question was unanswerable, which is the worst possible outcome for an
 * operator wondering whether they have an intruder.
 *
 * Deliberately NOT foreign-keyed to the target user: the whole point is that a
 * delete leaves evidence, and a cascade would erase the record along with the
 * account. `targetUserId` / `targetEmail` are captured as plain values so the
 * row still reads sensibly after its subject is gone.
 *
 * Append-only by convention — nothing in the app updates or deletes these rows.
 */
export const auditLogTable = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  /** The admin who performed the action. Kept FK'd — an actor always exists. */
  actorUserId: integer("actor_user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  actorEmail: text("actor_email").notNull(),
  action: text("action", {
    enum: [
      "customer_deleted",
      "customer_suspended",
      "customer_unsuspended",
      "subscription_updated",
      "upgrade_request_resolved",
      "announcement_sent",
      "support_replied",
      "support_thread_status_changed",
    ],
  }).notNull(),
  /** Plain integer, NOT a foreign key — see the note above about deletes. */
  targetUserId: integer("target_user_id"),
  targetEmail: text("target_email"),
  /** Human-readable summary of what changed, e.g. "plan: free → pro". */
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AuditLogRow = typeof auditLogTable.$inferSelect;
