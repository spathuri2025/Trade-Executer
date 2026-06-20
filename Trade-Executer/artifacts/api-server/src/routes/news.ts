import { Router, type IRouter } from "express";
import { getMarketNews } from "../lib/newsService";

const router: IRouter = Router();

router.get("/news", async (req, res): Promise<void> => {
  try {
    const limit = req.query["limit"] ? Number(req.query["limit"]) : 15;
    const items = await getMarketNews(limit);
    res.json(items);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch market news");
    res.status(502).json({ error: "Failed to fetch market news" });
  }
});

export default router;
