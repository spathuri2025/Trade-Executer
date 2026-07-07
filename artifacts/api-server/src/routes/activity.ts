import { Router, type IRouter } from "express";
import { db, signalsTable, tradesTable, scannerResultsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { ListSignalsQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

/**
 * Unified, chronological activity feed that merges scanner hits, strategy
 * signals (incl. any Claude review reason), and executed/failed trades into a
 * single stream. Purely a read/merge over existing tables — additive to the
 * standalone Scanner/Signals/Trades pages, never a replacement.
 */
router.get("/activity", async (req, res): Promise<void> => {
  const parsed = ListSignalsQueryParams.safeParse(req.query);
  const perSource = parsed.success ? (parsed.data.limit ?? 30) : 30;

  const userId = req.user!.id;
  const [signals, trades, scans] = await Promise.all([
    db.select().from(signalsTable).where(eq(signalsTable.userId, userId)).orderBy(desc(signalsTable.createdAt)).limit(perSource),
    db.select().from(tradesTable).where(eq(tradesTable.userId, userId)).orderBy(desc(tradesTable.executedAt)).limit(perSource),
    db.select().from(scannerResultsTable).where(eq(scannerResultsTable.userId, userId)).orderBy(desc(scannerResultsTable.scannedAt)).limit(perSource),
  ]);

  const items = [
    ...scans.map((s) => ({
      id: `scan-${s.id}`,
      type: "scan" as const,
      ticker: s.ticker,
      name: s.name,
      signal: s.signal,
      timestamp: s.scannedAt.toISOString(),
      price: Number(s.price),
      shortMa: Number(s.shortMa),
      longMa: Number(s.longMa),
      trendStrength: Number(s.trendStrength),
      strategy: s.strategy,
      regime: s.regime,
      autoTraded: s.autoTraded,
      aiReason: null,
      aiConfidence: null,
      status: null,
      side: null,
      quantity: null,
      total: null,
      errorMessage: null,
    })),
    ...signals.map((s) => ({
      id: `signal-${s.id}`,
      type: "signal" as const,
      ticker: s.ticker,
      name: null,
      signal: s.signal,
      timestamp: s.createdAt.toISOString(),
      price: Number(s.price),
      shortMa: Number(s.shortMa),
      longMa: Number(s.longMa),
      trendStrength: null,
      strategy: s.strategy,
      regime: s.regime,
      autoTraded: s.tradeExecuted,
      aiReason: s.aiReason,
      aiConfidence: null,
      status: null,
      side: null,
      quantity: null,
      total: null,
      errorMessage: null,
    })),
    ...trades.map((t) => ({
      id: `trade-${t.id}`,
      type: "trade" as const,
      ticker: t.ticker,
      name: null,
      signal: null,
      timestamp: t.executedAt.toISOString(),
      price: Number(t.price),
      shortMa: null,
      longMa: null,
      trendStrength: null,
      strategy: null,
      regime: null,
      autoTraded: null,
      aiReason: t.aiReason,
      aiConfidence: t.aiConfidence,
      status: t.status,
      side: t.side,
      quantity: Number(t.quantity),
      total: t.total != null ? Number(t.total) : null,
      errorMessage: t.errorMessage,
    })),
  ];

  items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  res.json({ items });
});

export default router;
