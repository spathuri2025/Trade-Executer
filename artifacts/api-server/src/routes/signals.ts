import { Router, type IRouter } from "express";
import { db, signalsTable, type Signal } from "@workspace/db";
import { desc } from "drizzle-orm";
import { ListSignalsQueryParams } from "@workspace/api-zod";
import { runCycle } from "../lib/botEngine";
import { deriveSignalExplanation } from "../lib/signalExplanation";

const router: IRouter = Router();

function serialize(s: Signal) {
  const explanation = deriveSignalExplanation(s);
  return {
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
    // Richer, plain-language explanation derived deterministically.
    signalReason: explanation.signalReason,
    confidence: explanation.confidence,
    technicalReason: explanation.technicalReason,
    newsReason: explanation.newsReason,
    riskLevel: explanation.riskLevel,
    suggestedAction: explanation.suggestedAction,
  };
}

router.get("/signals", async (req, res): Promise<void> => {
  const parsed = ListSignalsQueryParams.safeParse(req.query);
  const limit = parsed.success ? (parsed.data.limit ?? 20) : 20;

  const signals = await db
    .select()
    .from(signalsTable)
    .orderBy(desc(signalsTable.createdAt))
    .limit(limit);

  res.json(signals.map(serialize));
});

router.post("/signals/run", async (req, res): Promise<void> => {
  const results = await runCycle();

  const signals = await db
    .select()
    .from(signalsTable)
    .orderBy(desc(signalsTable.createdAt))
    .limit(results.length || 1);

  res.json(signals.map(serialize));
});

export default router;
