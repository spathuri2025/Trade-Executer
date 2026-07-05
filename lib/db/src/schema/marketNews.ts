import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const marketNewsTable = pgTable("market_news", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  source: text("source").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  impactScore: integer("impact_score").notNull().default(0),
  impactLabel: text("impact_label", { enum: ["HIGH", "MEDIUM", "LOW"] })
    .notNull()
    .default("LOW"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMarketNewsSchema = createInsertSchema(marketNewsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertMarketNews = z.infer<typeof insertMarketNewsSchema>;
export type MarketNews = typeof marketNewsTable.$inferSelect;
