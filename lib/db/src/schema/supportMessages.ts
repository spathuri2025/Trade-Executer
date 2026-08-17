import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

import { supportThreadsTable } from "./supportThreads";

/** One message inside a support thread. */
export const supportMessagesTable = pgTable("support_messages", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id")
    .notNull()
    .references(() => supportThreadsTable.id, { onDelete: "cascade" }),
  /**
   * Who wrote it. A role, not a userId: the thread already knows its user, and
   * every admin reply speaks for "TradeBuzz support" rather than an individual.
   */
  senderRole: text("sender_role", { enum: ["user", "admin"] }).notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SupportMessageRow = typeof supportMessagesTable.$inferSelect;
