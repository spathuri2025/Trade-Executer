import { Router, type IRouter } from "express";
import { getUserBrokerCredentials } from "../lib/brokerCredentialsService";
import { getBrokerTransactions } from "../lib/broker";
import { summariseTransactions, type LivePerformance } from "../lib/livePerformance";

const router: IRouter = Router();

const ALLOWED_DAYS = new Set([7, 30, 90]);

/**
 * Short per-user cache. The page may be reloaded and re-rendered freely; the
 * broker's history changes only when a trade closes, and every request here
 * would otherwise be a Capital.com call competing with the bot's own cycles for
 * the same rate limit.
 */
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; body: LivePerformance & { from: string; to: string; days: number } }>();

router.get("/performance/live", async (req, res): Promise<void> => {
  const days = req.query["days"] === undefined ? 30 : Number(req.query["days"]);
  if (!ALLOWED_DAYS.has(days)) {
    res.status(400).json({ error: "days must be 7, 30 or 90" });
    return;
  }

  const userId = req.user!.id;
  const key = `${userId}:${days}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    res.json(hit.body);
    return;
  }

  const credentials = await getUserBrokerCredentials(userId);
  if (!credentials) {
    res.status(400).json({ error: "Connect a broker account to see live results" });
    return;
  }

  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  try {
    const rows = await getBrokerTransactions(userId, credentials, from, to);
    if (rows === null) {
      res.status(400).json({ error: `Live results come from the broker's transaction history, which ${credentials.broker} doesn't provide` });
      return;
    }
    const body = { ...summariseTransactions(rows), from: from.toISOString(), to: to.toISOString(), days };
    cache.set(key, { at: Date.now(), body });
    res.json(body);
  } catch (err) {
    req.log.error({ err, broker: credentials.broker }, "Failed to fetch transaction history");
    res.status(502).json({ error: `Couldn't fetch your trading history from ${credentials.broker}. Try again in a minute.` });
  }
});

export default router;
