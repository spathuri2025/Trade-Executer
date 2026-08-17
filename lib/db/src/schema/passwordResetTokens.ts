import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

import { usersTable } from "./users";

/**
 * One-time tokens backing the "forgot password" flow.
 *
 * `tokenHash` stores a SHA-256 of the token, never the token itself. The raw
 * value exists only in the emailed link — so a leak of this table (a stolen
 * backup, a compromised read-only replica) cannot be used to reset anyone's
 * password, exactly as password hashing protects the passwords themselves.
 *
 * Rows are kept after use rather than deleted: `usedAt` makes a replayed link
 * fail explicitly, instead of a missing row being indistinguishable from a
 * typo'd one.
 */
export const passwordResetTokensTable = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  /** SHA-256 hex of the token from the emailed link. */
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  /** Non-null once redeemed — a token is single-use. */
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PasswordResetTokenRow = typeof passwordResetTokensTable.$inferSelect;
