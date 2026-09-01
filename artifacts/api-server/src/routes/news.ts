import { Router, type IRouter } from "express";
import { getMarketNews } from "../lib/newsService";

/** Bounded limit parsing — invalid input is refused, never silently defaulted. */
function parseLimit(raw: unknown, fallback: number, max: number): number | null {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) return null;
  return n;
}

const router: IRouter = Router();

router.get("/news", async (req, res): Promise<void> => {
  try {
    const limit = parseLimit(req.query["limit"], 15, 100);
    if (limit === null) {
      res.status(400).json({ error: "limit must be a whole number between 1 and 100" });
      return;
    }
    const items = await getMarketNews(limit);
    res.json(items);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch market news");
    res.status(502).json({ error: "Failed to fetch market news" });
  }
});

export default router;
