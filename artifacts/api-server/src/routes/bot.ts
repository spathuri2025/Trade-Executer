import { Router, type IRouter } from "express";
import { getBotStatus, startBot, stopBotAndGetStatus, updateConfig, resumeBot, BrokerNotConnectedError } from "../lib/botEngine";
import { UpdateBotConfigBody } from "@workspace/api-zod";
import { getBrokerAccount } from "../lib/broker";
import { getUserBrokerCredentials } from "../lib/brokerCredentialsService";
import { getPlanLimits } from "../lib/planService";

const router: IRouter = Router();

router.get("/bot/status", async (req, res): Promise<void> => {
  res.json(await getBotStatus(req.user!.id));
});

router.post("/bot/start", async (req, res): Promise<void> => {
  try {
    const status = await startBot(req.user!.id);
    res.json(status);
  } catch (err) {
    if (err instanceof BrokerNotConnectedError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

router.post("/bot/stop", async (req, res): Promise<void> => {
  const status = await stopBotAndGetStatus(req.user!.id);
  res.json(status);
});

router.post("/bot/resume", async (req, res): Promise<void> => {
  try {
    const status = await resumeBot(req.user!.id);
    res.json(status);
  } catch (err) {
    if (err instanceof BrokerNotConnectedError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

router.patch("/bot/config", async (req, res): Promise<void> => {
  const parsed = UpdateBotConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Reject settings the plan doesn't cover, so the user gets a clear reason
  // instead of silently saving a preference the engine then overrides. The
  // engine override (botEngine.runCycle) remains the actual security boundary
  // — this is purely for a comprehensible error message.
  const limits = await getPlanLimits(req.user!.id);
  if (parsed.data.dryRun === false && !limits.liveTrading) {
    res.status(402).json({
      error: "Live trading isn't included in your current plan. Upgrade to place real orders.",
    });
    return;
  }
  if (parsed.data.aiTradeMode && parsed.data.aiTradeMode !== "off" && !limits.aiTradeModes) {
    res.status(402).json({
      error: "AI trade modes aren't included in your current plan. Upgrade to use them.",
    });
    return;
  }

  const status = await updateConfig(req.user!.id, parsed.data);
  res.json(status);
});

router.get("/account", async (req, res): Promise<void> => {
  const credentials = await getUserBrokerCredentials(req.user!.id);
  if (!credentials) {
    res.status(400).json({ error: "Connect a broker account first" });
    return;
  }
  try {
    const account = await getBrokerAccount(req.user!.id, credentials);
    res.json(account);
  } catch (err) {
    req.log.error({ err, broker: credentials.broker }, "Failed to fetch account");
    res.status(502).json({ error: `Failed to fetch account from ${credentials.broker}` });
  }
});

export default router;
