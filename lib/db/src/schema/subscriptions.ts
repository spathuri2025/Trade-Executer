import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

import { usersTable } from "./users";

/**
 * One row per user, admin-authored (not derived from a payment processor —
 * no Stripe account exists yet). Real, useful data on its own (who's on what
 * plan, who's overdue) with a clear upgrade path: a future Stripe webhook
 * integration would just start writing to this same table automatically.
 */
export const subscriptionsTable = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .unique()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  plan: text("plan", { enum: ["free", "starter", "pro", "enterprise"] }).notNull().default("free"),
  status: text("status", { enum: ["active", "trialing", "past_due", "canceled"] }).notNull().default("active"),
  notes: text("notes"),
  renewsAt: timestamp("renews_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SubscriptionRow = typeof subscriptionsTable.$inferSelect;
