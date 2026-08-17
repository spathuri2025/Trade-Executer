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
  /**
   * When the paid period ends. Enforced by planService.getEffectivePlan: a past
   * date lapses the account to free on its next request. Null = never expires
   * (comped/admin-granted accounts).
   */
  renewsAt: timestamp("renews_at", { withTimezone: true }),
  /**
   * Stripe linkage — nullable and unused until billing goes live (BILLING.md).
   * Admin-authored rows simply leave them null; the future webhook writes them
   * so a Stripe subscription can be matched back to its row.
   */
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SubscriptionRow = typeof subscriptionsTable.$inferSelect;
