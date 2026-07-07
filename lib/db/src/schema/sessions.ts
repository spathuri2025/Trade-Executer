import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

import { usersTable } from "./users";

/** id is an opaque random token (not auto-increment) — see artifacts/api-server/src/lib/auth.ts. */
export const sessionsTable = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export type Session = typeof sessionsTable.$inferSelect;
