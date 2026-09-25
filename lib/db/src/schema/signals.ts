import { pgTable, text, serial, integer, numeric, real, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { usersTable } from "./users";

export const signalsTable = pgTable("signals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  ticker: text("ticker").notNull(),
  signal: text("signal", { enum: ["BUY", "SELL", "HOLD"] }).notNull(),
  shortMa: numeric("short_ma", { precision: 18, scale: 8 }).notNull(),
  longMa: numeric("long_ma", { precision: 18, scale: 8 }).notNull(),
  price: numeric("price", { precision: 18, scale: 8 }).notNull(),
  tradeExecuted: boolean("trade_executed").notNull().default(false),
  aiReason: text("ai_reason"),
  strategy: text("strategy", { enum: ["trend_following", "mean_reversion", "scalp"] }),
  regime: text("regime", { enum: ["trending", "ranging"] }),
  /**
   * The live round-trip spread when this signal was evaluated, as a percent of
   * price. Null when no quote was fetched — a HOLD costs nothing to skip, so
   * the engine does not spend a broker call on one.
   *
   * Recorded because spread decides which instruments can be profitable at all.
   * With a 0.3% stop and target, SMCI's measured 0.468% spread needs a 128% win
   * rate to break even — mathematically impossible — and until this column
   * existed that could only be discovered by regexing the numbers out of
   * rejection messages, which sees only the trades that were blocked.
   */
  spreadPct: real("spread_pct"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSignalSchema = createInsertSchema(signalsTable).omit({ id: true, createdAt: true });
export type InsertSignal = z.infer<typeof insertSignalSchema>;
export type Signal = typeof signalsTable.$inferSelect;
