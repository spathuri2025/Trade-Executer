import { Router, type IRouter } from "express";
import { getBrokerPositions } from "../lib/broker";
import { getUserBrokerCredentials } from "../lib/brokerCredentialsService";

const router: IRouter = Router();

router.get("/positions", async (req, res): Promise<void> => {
  const credentials = await getUserBrokerCredentials(req.user!.id);
  if (!credentials) {
    res.status(400).json({ error: "Connect a broker account first" });
    return;
  }
  try {
    const positions = await getBrokerPositions(req.user!.id, credentials);
    res.json(positions);
  } catch (err) {
    req.log.error({ err, broker: credentials.broker }, "Failed to fetch positions");
    res.status(502).json({ error: `Failed to fetch positions from ${credentials.broker}` });
  }
});

export default router;
