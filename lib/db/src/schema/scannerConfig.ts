import { pgTable, serial, integer, real, boolean, text, timestamp } from "drizzle-orm/pg-core";

import { usersTable } from "./users";

/**
 * One row per user — persists ScannerConfig (artifacts/api-server/src/lib/scannerEngine.ts).
 * Mirrors `bot_config`: before this table existed the scanner kept everything in
 * memory, so every deploy silently reset each customer's scanner settings to the
 * defaults AND stopped a running scan loop with nothing to say so.
 *
 * `running` is intent, not live status — the scan loop itself is an in-memory
 * timer on one instance. `resumeRunningScanners()` reads it at boot to re-arm
 * those timers. See the same note on `bot_config.running`.
 */
export const scannerConfigTable = pgTable("scanner_config", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .unique()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  scanEnabled: boolean("scan_enabled").notNull().default(false),
  /**
   * Whether hits may be traded automatically. Defaulting to false matters: it is
   * the difference between a restart losing a setting and a restart placing
   * orders the user didn't expect.
   */
  autoTrade: boolean("auto_trade").notNull().default(false),
  minTrendStrength: real("min_trend_strength").notNull().default(0.3),
  scanIntervalMinutes: integer("scan_interval_minutes").notNull().default(60),
  /**
   * Capital.com instrument types to scan. A plain text[] rather than an enum —
   * the set is the broker's, not ours, and a new type appearing upstream
   * shouldn't require a migration.
   */
  instrumentTypes: text("instrument_types")
    .array()
    .notNull()
    .default(["SHARES", "INDICES", "CURRENCIES", "COMMODITIES"]),
  maxInstrumentsPerScan: integer("max_instruments_per_scan").notNull().default(40),
  /** Whether the user wants the scan loop running. Written only by start/stopScanner. */
  running: boolean("running").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ScannerConfigRow = typeof scannerConfigTable.$inferSelect;
