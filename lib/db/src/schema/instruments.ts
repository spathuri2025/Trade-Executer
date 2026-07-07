import { pgTable, text, serial, integer, boolean, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { usersTable } from "./users";

export const instrumentsTable = pgTable(
  "instruments",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
    ticker: text("ticker").notNull(),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Was a global-unique ticker before per-user instruments — now unique per
  // user, so two different customers can both watch the same ticker.
  (table) => [unique().on(table.userId, table.ticker)],
);

export const insertInstrumentSchema = createInsertSchema(instrumentsTable).omit({ id: true, addedAt: true });
export type InsertInstrument = z.infer<typeof insertInstrumentSchema>;
export type Instrument = typeof instrumentsTable.$inferSelect;
