import { Router, type IRouter } from "express";
import { getBotStatus, startBot, stopBot, updateConfig } from "../lib/botEngine";
import { UpdateBotConfigBody } from "@workspace/api-zod";
import { getAccountCash, getAccountInfo } from "../lib/trading212";

const router: IRouter = Router();

router.get("/bot/status", async (_req, res): Promise<void> => {
  res.json(getBotStatus());
});

router.post("/bot/start", async (_req, res): Promise<void> => {
  const status = startBot();
  res.json(status);
});

router.post("/bot/stop", async (_req, res): Promise<void> => {
  const status = stopBot();
  res.json(status);
});

router.patch("/bot/config", async (req, res): Promise<void> => {
  const parsed = UpdateBotConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const status = updateConfig(parsed.data);
  res.json(status);
});

router.get("/account", async (req, res): Promise<void> => {
  try {
    const [info, cash] = await Promise.all([getAccountInfo(), getAccountCash()]);
    res.json({
      cash: cash.free,
      invested: cash.invested,
      result: cash.result,
      total: cash.total,
      currency: info.currencyCode ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch account");
    res.status(502).json({ error: "Failed to fetch account from Trading 212" });
  }
});

export default router;
