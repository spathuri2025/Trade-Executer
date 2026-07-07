import { Router, type IRouter } from "express";
import { computeChartInsight } from "../lib/chartInsightService";
import { getUserBrokerCredentials } from "../lib/brokerCredentialsService";

const router: IRouter = Router();

const ALLOWED_RESOLUTIONS = new Set([
  "MINUTE",
  "MINUTE_5",
  "MINUTE_15",
  "MINUTE_30",
  "HOUR",
  "HOUR_4",
  "DAY",
  "WEEK",
]);

router.get("/charts/insight", async (req, res): Promise<void> => {
  const epic = typeof req.query["epic"] === "string" ? req.query["epic"].trim() : "";
  if (!epic) {
    res.status(400).json({ error: "epic query parameter is required" });
    return;
  }
  const resParam = typeof req.query["resolution"] === "string" ? req.query["resolution"] : "HOUR";
  const resolution = ALLOWED_RESOLUTIONS.has(resParam) ? resParam : "HOUR";

  const credentials = await getUserBrokerCredentials(req.user!.id);
  if (!credentials || credentials.broker !== "capitalcom") {
    res.status(400).json({ error: "Connect a Capital.com broker account first" });
    return;
  }

  try {
    const insight = await computeChartInsight(req.user!.id, credentials.capital, epic, resolution);
    res.set("Cache-Control", "no-store");
    res.json(insight);
  } catch (err) {
    req.log.error({ err, epic }, "Failed to compute chart insight");
    res.status(502).json({ error: "Failed to compute chart insight for this instrument" });
  }
});

export default router;
