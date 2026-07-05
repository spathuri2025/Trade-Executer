import { pgTable, serial, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export interface BrainDriver {
  title: string;
  detail: string;
}

export interface BrainEvent {
  name: string;
  when: string;
  importance: string;
}

export interface BrainOpportunity {
  asset: string;
  rationale: string;
}

export interface BrainRisk {
  title: string;
  detail: string;
}

export const marketBrainSnapshotsTable = pgTable("market_brain_snapshots", {
  id: serial("id").primaryKey(),
  regime: text("regime", {
    enum: ["Risk-On", "Risk-Off", "Mixed", "High Volatility"],
  }).notNull(),
  confidence: integer("confidence").notNull(),
  drivers: jsonb("drivers").$type<BrainDriver[]>().notNull(),
  highImpactNewsCount: integer("high_impact_news_count").notNull().default(0),
  upcomingEvents: jsonb("upcoming_events").$type<BrainEvent[]>().notNull(),
  opportunities: jsonb("opportunities").$type<BrainOpportunity[]>().notNull(),
  risks: jsonb("risks").$type<BrainRisk[]>().notNull(),
  disclaimer: text("disclaimer").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMarketBrainSnapshotSchema = createInsertSchema(marketBrainSnapshotsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertMarketBrainSnapshot = z.infer<typeof insertMarketBrainSnapshotSchema>;
export type MarketBrainSnapshot = typeof marketBrainSnapshotsTable.$inferSelect;
