import { Router, type IRouter } from "express";
import { getCapitalCandles } from "../lib/capitalcom";
import { getUserBrokerCredentials } from "../lib/brokerCredentialsService";
import { GetCandlesQueryParams } from "@workspace/api-zod";

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

router.get("/candles", async (req, res): Promise<void> => {
  const parsed = GetCandlesQueryParams.safeParse(req.query);
  const epicRaw = typeof req.query.epic === "string" ? req.query.epic : "";
  const epic = epicRaw.trim();
  if (!epic) {
    res.status(400).json({ error: "epic query parameter is required" });
    return;
  }
  const resolutionRaw = parsed.success ? (parsed.data.resolution ?? "HOUR") : "HOUR";
  const resolution = ALLOWED_RESOLUTIONS.has(resolutionRaw) ? resolutionRaw : "HOUR";
  const count = parsed.success ? (parsed.data.count ?? 200) : 200;

  const credentials = await getUserBrokerCredentials(req.user!.id);
  if (!credentials || credentials.broker !== "capitalcom") {
    res.status(400).json({ error: "Connect a Capital.com broker account first" });
    return;
  }

  try {
    const candles = await getCapitalCandles(
      req.user!.id,
      credentials.capital,
      epic,
      resolution,
      Math.min(Math.max(count, 1), 1000),
    );
    res.json(candles);
  } catch (err) {
    req.log.warn({ err, epic, resolution }, "Could not fetch candles from Capital.com");
    res.status(502).json({ error: "Could not fetch candles" });
  }
});

export default router;
