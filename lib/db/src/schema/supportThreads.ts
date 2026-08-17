import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";

import { usersTable } from "./users";

/**
 * A support conversation between one user and the operator — the user half of
 * the communication centre. Same thread/message split as the Assistant chat
 * (`conversations`/`messages`), but with a human on the other end.
 *
 * Unread state is two booleans rather than per-message read receipts: with a
 * single operator there are only two perspectives, and "has this side seen the
 * latest?" is the only question either surface asks.
 */
export const supportThreadsTable = pgTable("support_threads", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  subject: text("subject").notNull(),
  /** Closed threads reopen automatically when the user writes again. */
  status: text("status", { enum: ["open", "closed"] }).notNull().default("open"),
  /** True while the latest activity is unseen by the user (admin replied). */
  userUnread: boolean("user_unread").notNull().default(false),
  /** True while the latest activity is unseen by the operator (user wrote). */
  adminUnread: boolean("admin_unread").notNull().default(true),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SupportThreadRow = typeof supportThreadsTable.$inferSelect;
