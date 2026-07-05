import { pgTable, serial, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const aiMarketAnalysisTable = pgTable("ai_market_analysis", {
  id: serial("id").primaryKey(),
  headline: text("headline").notNull(),
  source: text("source"),
  articleUrl: text("article_url"),
  affectedAssets: jsonb("affected_assets").$type<string[]>().notNull(),
  sentiment: text("sentiment", { enum: ["bullish", "bearish", "neutral"] }).notNull(),
  impactLevel: text("impact_level", { enum: ["low", "medium", "high"] }).notNull(),
  summary: text("summary").notNull(),
  whyItMatters: text("why_it_matters").notNull(),
  possibleReaction: text("possible_reaction").notNull(),
  riskWarning: text("risk_warning").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAiMarketAnalysisSchema = createInsertSchema(aiMarketAnalysisTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAiMarketAnalysis = z.infer<typeof insertAiMarketAnalysisSchema>;
export type AiMarketAnalysis = typeof aiMarketAnalysisTable.$inferSelect;
