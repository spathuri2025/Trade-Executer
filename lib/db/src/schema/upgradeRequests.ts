import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

import { usersTable } from "./users";

/**
 * A user asking to be moved onto a paid plan.
 *
 * There is no self-serve checkout yet — plans are granted by hand in the Admin
 * Centre — so this is the bridge: it captures the request at the moment the
 * user hits a limit, and surfaces it next to the customer record where the
 * plan actually gets changed.
 *
 * `trigger` records WHICH limit prompted the request (locked live trading, the
 * instrument cap, and so on). That's the useful part commercially: it shows
 * what people are actually blocked by, rather than just that they want "more".
 */
export const upgradeRequestsTable = pgTable("upgrade_requests", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  /** Which paywall the user hit when they asked. */
  trigger: text("trigger", {
    enum: ["live_trading", "ai_trade_modes", "instrument_cap", "ai_quota", "plan_card", "enterprise"],
  }).notNull(),
  /** Optional free-text note from the user. */
  message: text("message"),
  status: text("status", { enum: ["pending", "handled", "dismissed"] }).notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** Set when an admin marks it handled or dismissed. */
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export type UpgradeRequestRow = typeof upgradeRequestsTable.$inferSelect;
