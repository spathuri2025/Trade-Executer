import { Router, type IRouter } from "express";
import { db, signalsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { ListSignalsQueryParams } from "@workspace/api-zod";
import { runCycle } from "../lib/botEngine";

const router: IRouter = Router();

router.get("/signals", async (req, res): Promise<void> => {
  const parsed = ListSignalsQueryParams.safeParse(req.query);
  const limit = parsed.success ? (parsed.data.limit ?? 20) : 20;

  const signals = await db
    .select()
    .from(signalsTable)
    .orderBy(desc(signalsTable.createdAt))
    .limit(limit);

  res.json(
    signals.map((s) => ({
      id: s.id,
      ticker: s.ticker,
      signal: s.signal,
      shortMa: Number(s.shortMa),
      longMa: Number(s.longMa),
      price: Number(s.price),
      createdAt: s.createdAt.toISOString(),
      tradeExecuted: s.tradeExecuted,
      aiReason: s.aiReason,
      strategy: s.strategy,
      regime: s.regime,
    }))
  );
});

router.post("/signals/run", async (req, res): Promise<void> => {
  const results = await runCycle();

  const signals = await db
    .select()
    .from(signalsTable)
    .orderBy(desc(signalsTable.createdAt))
    .limit(results.length || 1);

  res.json(
    signals.map((s) => ({
      id: s.id,
      ticker: s.ticker,
      signal: s.signal,
      shortMa: Number(s.shortMa),
      longMa: Number(s.longMa),
      price: Number(s.price),
      createdAt: s.createdAt.toISOString(),
      tradeExecuted: s.tradeExecuted,
      aiReason: s.aiReason,
      strategy: s.strategy,
      regime: s.regime,
    }))
  );
});

export default router;
