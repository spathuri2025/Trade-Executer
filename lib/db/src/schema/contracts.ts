import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

import { usersTable } from "./users";

/**
 * Admin-uploaded contract/legal documents, one row per file. `fileData` is
 * base64 rather than a Postgres bytea column — simpler and more portable,
 * and entirely adequate for infrequent, typically-small admin uploads (not
 * designed for user-generated media at scale). If file volume grows, migrate
 * `fileData` to an object-storage URL without changing the rest of the shape.
 */
export const contractsTable = pgTable("contracts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(),
  fileSize: integer("file_size").notNull(),
  fileData: text("file_data").notNull(),
  notes: text("notes"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ContractRow = typeof contractsTable.$inferSelect;
