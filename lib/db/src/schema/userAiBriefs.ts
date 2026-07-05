import { pgTable, serial, text, jsonb, date, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export interface BriefHighlight {
  /** one of: "risk" | "opportunity" | "alert" */
  type: string;
  text: string;
}

export const userAiBriefsTable = pgTable("user_ai_briefs", {
  id: serial("id").primaryKey(),
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
