import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";

import { usersTable } from "./users";

/**
 * One row per user. Only the fields for their chosen `broker` are populated;
 * values are AES-256-GCM ciphertext (see artifacts/api-server/src/lib/crypto.ts)
 * — never store or return plaintext credentials.
 */
export const brokerCredentialsTable = pgTable("broker_credentials", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .unique()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  broker: text("broker", { enum: ["trading212", "capitalcom"] }).notNull(),
  capitalApiKeyEnc: text("capital_api_key_enc"),
  capitalIdentifierEnc: text("capital_identifier_enc"),
  capitalPasswordEnc: text("capital_password_enc"),
  trading212ApiKeyEnc: text("trading212_api_key_enc"),
  /** Trading 212 API secret (the API now authenticates with a key+secret pair via HTTP Basic). */
  trading212ApiSecretEnc: text("trading212_api_secret_enc"),
  /** Which Trading 212 environment the key belongs to (auto-detected at connect time). */
  trading212Environment: text("trading212_environment", { enum: ["live", "demo"] }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BrokerCredentialsRow = typeof brokerCredentialsTable.$inferSelect;
