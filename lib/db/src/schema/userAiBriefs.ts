import { pgTable, serial, integer, text, jsonb, date, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { usersTable } from "./users";

export interface BriefHighlight {
  /** one of: "risk" | "opportunity" | "alert" */
  type: string;
  text: string;
}

/**
 * One row per user per day. This briefing is grounded in the requesting
 * user's own account/watchlist/positions (see buildTradingContext), so unlike
 * the genuinely-global dailyMarketBriefsTable it must be per-user — an
 * earlier version stored one shared row for the whole platform, which meant
 * every customer saw whichever single user's account state happened to
 * trigger generation first that day.
 */
export const userAiBriefsTable = pgTable("user_ai_briefs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  briefDate: date("brief_date", { mode: "string" }).notNull(),
  message: text("message").notNull(),
  highlights: jsonb("highlights").$type<BriefHighlight[]>().notNull(),
  disclaimer: text("disclaimer").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserAiBriefSchema = createInsertSchema(userAiBriefsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertUserAiBrief = z.infer<typeof insertUserAiBriefSchema>;
export type UserAiBrief = typeof userAiBriefsTable.$inferSelect;
