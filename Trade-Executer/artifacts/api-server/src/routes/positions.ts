import { Router, type IRouter } from "express";
import { getBrokerPositions } from "../lib/broker";
import { getBotStatus } from "../lib/botEngine";

const router: IRouter = Router();

router.get("/positions", async (req, res): Promise<void> => {
  const { config } = getBotStatus();
  try {
    const positions = await getBrokerPositions(config.broker);
    res.json(positions);
  } catch (err) {
    req.log.error({ err, broker: config.broker }, "Failed to fetch positions");
    res.status(502).json({ error: `Failed to fetch positions from ${config.broker}` });
  }
});

export default router;
