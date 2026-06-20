import { Router, type IRouter } from "express";
import { db, tradesTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { ListTradesQueryParams } from "@workspace/api-zod";

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

export default router;
