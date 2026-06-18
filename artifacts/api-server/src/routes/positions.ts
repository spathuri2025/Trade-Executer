import { Router, type IRouter } from "express";
import { getPositions } from "../lib/trading212";

const router: IRouter = Router();

router.get("/positions", async (req, res): Promise<void> => {
  try {
    const positions = await getPositions();
    res.json(
      positions.map((p) => ({
        ticker: p.ticker,
        quantity: p.quantity,
        averagePrice: p.averagePrice,
        currentPrice: p.currentPrice,
        pnl: p.ppl,
        pnlPercent: p.averagePrice > 0 ? ((p.currentPrice - p.averagePrice) / p.averagePrice) * 100 : 0,
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Failed to fetch positions");
    res.status(502).json({ error: "Failed to fetch positions from Trading 212" });
  }
});

export default router;
