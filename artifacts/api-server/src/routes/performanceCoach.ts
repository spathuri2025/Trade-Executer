import { Router, type IRouter } from "express";
import { computePerformanceCoach } from "../lib/performanceCoachService";

const router: IRouter = Router();

router.get("/performance/coach", async (req, res): Promise<void> => {
  try {
    const coach = await computePerformanceCoach();
    res.set("Cache-Control", "no-store");
    res.json(coach);
  } catch (err) {
    req.log.error({ err }, "Failed to compute performance coach");
    res.status(500).json({ error: "Failed to compute performance coach" });
  }
});

export default router;
