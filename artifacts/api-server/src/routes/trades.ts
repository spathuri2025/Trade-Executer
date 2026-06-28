import { Router, type IRouter } from "express";
import { db, tradesTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { ListTradesQueryParams, ExecuteTradeBody } from "@workspace/api-zod";
import {
  executeManualTrade,
  TradeExecutionError,
  TradeValidationError,
  DuplicateTradeError,
  getBotStatus,
} from "../lib/botEngine";
import { getBrokerQuote } from "../lib/broker";

const router: IRouter = Router();

router.get("/trades", async (req, res): Promise<void> => {
  const parsed = ListTradesQueryParams.safeParse(req.query);
  const limit = parsed.success ? (parsed.data.limit ?? 50) : 50;

  const trades = await db
    .select()
    .from(tradesTable)
    .orderBy(desc(tradesTable.executedAt))
    .limit(limit);

  res.json(
    trades.map((t) => ({
      id: t.id,
      ticker: t.ticker,
      side: t.side,
      quantity: Number(t.quantity),
      price: Number(t.price),
      total: t.total != null ? Number(t.total) : Number(t.price) * Number(t.quantity),
      executedAt: t.executedAt.toISOString(),
      status: t.status,
      errorMessage: t.errorMessage ?? null,
      orderId: t.orderId ?? null,
    }))
  );
});

router.get("/quote", async (req, res): Promise<void> => {
  const ticker = typeof req.query.ticker === "string" ? req.query.ticker.trim() : "";
  if (!ticker) {
    res.status(400).json({ error: "ticker query parameter is required" });
    return;
  }

  try {
    const broker = getBotStatus().config.broker;
    const quote = await getBrokerQuote(broker, ticker);
    res.json(quote);
  } catch (err) {
    req.log.error({ err, ticker }, "Failed to fetch quote");
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to fetch quote" });
  }
});

router.post("/trades/execute", async (req, res): Promise<void> => {
  const parsed = ExecuteTradeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid trade request", details: parsed.error.issues });
    return;
  }

  try {
    const trade = await executeManualTrade({
      ticker: parsed.data.ticker,
      side: parsed.data.side,
      amount: parsed.data.amount,
    });

    if (!trade) {
      throw new Error("Failed to record trade");
    }

    res.status(201).json({
      id: trade.id,
      ticker: trade.ticker,
      side: trade.side,
      quantity: Number(trade.quantity),
      price: Number(trade.price),
      total: trade.total != null ? Number(trade.total) : Number(trade.price) * Number(trade.quantity),
      executedAt: trade.executedAt.toISOString(),
      status: trade.status,
      errorMessage: trade.errorMessage ?? null,
      orderId: trade.orderId ?? null,
    });
  } catch (err) {
    if (err instanceof TradeValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof DuplicateTradeError) {
      res.status(429).json({ error: err.message });
      return;
    }
    if (err instanceof TradeExecutionError) {
      res.status(502).json({ error: err.message });
      return;
    }
    req.log.error({ err }, "Manual trade execution failed");
    res.status(502).json({ error: "Failed to execute trade" });
  }
});

export default router;
