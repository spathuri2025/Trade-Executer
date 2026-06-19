import { pgTable, text, serial, numeric, boolean, timestamp } from "drizzle-orm/pg-core";

export const scannerResultsTable = pgTable("scanner_results", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  name: text("name").notNull(),
  signal: text("signal", { enum: ["BUY", "SELL"] }).notNull(),
  shortMa: numeric("short_ma", { precision: 18, scale: 8 }).notNull(),
  longMa: numeric("long_ma", { precision: 18, scale: 8 }).notNull(),
  price: numeric("price", { precision: 18, scale: 8 }).notNull(),
  trendStrength: numeric("trend_strength", { precision: 10, scale: 4 }).notNull(),
  autoTraded: boolean("auto_traded").default(false).notNull(),
  orderId: text("order_id"),
  scannedAt: timestamp("scanned_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ScannerResult = typeof scannerResultsTable.$inferSelect;
