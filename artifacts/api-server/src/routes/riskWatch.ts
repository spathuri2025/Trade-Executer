import { Router, type IRouter } from "express";
import { currentRisk } from "../lib/riskWatchRuntime";

const router: IRouter = Router();

/**
 * The risk watch's view of the account right now — every current finding, not
 * only the new ones the alerts send. Read-only.
 */
router.get("/risk-watch", async (req, res): Promise<void> => {
  try {
    const risk = await currentRisk(req.user!.id);
    if (!risk) {
      res.status(400).json({ error: "Connect a broker account to use the risk watch" });
      return;
    }
    res.json({
      ...risk,
      findings: risk.findings.map(({ kind, ticker, title, detail }) => ({ kind, ticker, title, detail })),
    });
  } catch (err) {
    req.log.error({ err }, "Risk watch read failed");
    res.status(502).json({ error: "Couldn't read your positions from the broker. Try again in a minute." });
  }
});

export default router;
