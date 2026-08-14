import { Router, type IRouter } from "express";
import { computePerformanceCoach } from "../lib/performanceCoachService";
import { consumeAiQuota, aiQuotaExceededBody } from "../lib/planService";

const router: IRouter = Router();

router.get("/performance/coach", async (req, res): Promise<void> => {
  const quota = await consumeAiQuota(req.user!.id);
  if (!quota.allowed) {
    res.status(402).json(aiQuotaExceededBody(quota));
    return;
  }

  try {
    const coach = await computePerformanceCoach(req.user!.id);
    res.set("Cache-Control", "no-store");
    res.json(coach);
  } catch (err) {
    req.log.error({ err }, "Failed to compute performance coach");
    res.status(500).json({ error: "Failed to compute performance coach" });
  }
});

export default router;
