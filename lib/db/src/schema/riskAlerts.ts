import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { usersTable } from "./users";

/**
 * Which risk-watch alerts have already gone out, so each is sent once.
 *
 * The check runs every few minutes; without a record of what was said, an
 * unprotected position would alert every five minutes until it closed. Kept in
 * the database rather than memory so a deploy or restart cannot repeat them,
 * and so two processes during a handover cannot both send one: the unique key
 * decides which insert wins. Keys are described in RiskFinding.keys.
 */
export const riskAlertsTable = pgTable(
  "risk_alerts",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("risk_alerts_user_key").on(t.userId, t.key)]
);
