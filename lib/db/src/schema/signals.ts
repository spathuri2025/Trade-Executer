import { pgTable, text, serial, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const signalsTable = pgTable("signals", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  signal: text("signal", { enum: ["BUY", "SELL", "HOLD"] }).notNull(),
  shortMa: numeric("short_ma", { precision: 18, scale: 8 }).notNull(),
  longMa: numeric("long_ma", { precision: 18, scale: 8 }).notNull(),
  price: numeric("price", { precision: 18, scale: 8 }).notNull(),
  tradeExecuted: boolean("trade_executed").notNull().default(false),
  aiReason: text("ai_reason"),
  strategy: text("strategy", { enum: ["trend_following", "mean_reversion"] }),
  regime: text("regime", { enum: ["trending", "ranging"] }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSignalSchema = createInsertSchema(signalsTable).omit({ id: true, createdAt: true });
export type InsertSignal = z.infer<typeof insertSignalSchema>;
export type Signal = typeof signalsTable.$inferSelect;
