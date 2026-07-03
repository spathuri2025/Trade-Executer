import { pgTable, serial, jsonb, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export interface MarketUpdate {
  name: string;
  bias: string;
  support: string;
  resistance: string;
  summary: string;
}

export const dailyMarketBriefsTable = pgTable("daily_market_briefs", {
  id: serial("id").primaryKey(),
  markets: jsonb("markets").$type<MarketUpdate[]>().notNull(),
  disclaimer: text("disclaimer").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDailyMarketBriefSchema = createInsertSchema(dailyMarketBriefsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertDailyMarketBrief = z.infer<typeof insertDailyMarketBriefSchema>;
export type DailyMarketBrief = typeof dailyMarketBriefsTable.$inferSelect;
