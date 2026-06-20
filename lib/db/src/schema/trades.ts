import { pgTable, text, serial, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tradesTable = pgTable("trades", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  side: text("side", { enum: ["BUY", "SELL"] }).notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 8 }).notNull(),
  price: numeric("price", { precision: 18, scale: 8 }).notNull(),
  total: numeric("total", { precision: 18, scale: 8 }),
  executedAt: timestamp("executed_at", { withTimezone: true }).notNull().defaultNow(),
  status: text("status", { enum: ["FILLED", "FAILED", "DRY_RUN"] }).notNull().default("DRY_RUN"),
  errorMessage: text("error_message"),
  orderId: text("order_id"),
});

export const insertTradeSchema = createInsertSchema(tradesTable).omit({ id: true, executedAt: true });
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type Trade = typeof tradesTable.$inferSelect;
