import { pgTable, integer, boolean, timestamp } from "drizzle-orm/pg-core";

// Single-row table (id is always 1) that remembers whether the operator
// last left the bot running, so it can auto-resume after a restart/deploy.
export const botStateTable = pgTable("bot_state", {
  id: integer("id").primaryKey().default(1),
  running: boolean("running").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type BotStateRow = typeof botStateTable.$inferSelect;
