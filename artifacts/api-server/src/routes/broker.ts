import { Router, type IRouter } from "express";
import {
  saveUserBrokerCredentials,
  clearUserBrokerCredentials,
  getUserBrokerConnectionStatus,
  type SaveBrokerCredentialsInput,
} from "../lib/brokerCredentialsService";
import { getBrokerAccount } from "../lib/broker";
import { stopBot } from "../lib/botEngine";
import { evictCapitalStream } from "../lib/capitalStream";

const router: IRouter = Router();

async function currentStatus(userId: number) {
  const status = await getUserBrokerConnectionStatus(userId);
  return status ? { connected: true as const, ...status } : { connected: false as const };
}

function parseConnectInput(body: unknown): SaveBrokerCredentialsInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  if (b["broker"] === "capitalcom") {
    const capital = b["capital"];
    if (typeof capital !== "object" || capital === null) return null;
    const c = capital as Record<string, unknown>;
    const apiKey = typeof c["apiKey"] === "string" ? c["apiKey"].trim() : "";
    const identifier = typeof c["identifier"] === "string" ? c["identifier"].trim() : "";
    const password = typeof c["password"] === "string" ? c["password"] : "";
    if (!apiKey || !identifier || !password) return null;
    return { broker: "capitalcom", capital: { apiKey, identifier, password } };
  }

  if (b["broker"] === "trading212") {
    const t212 = b["trading212"];
    if (typeof t212 !== "object" || t212 === null) return null;
    const t = t212 as Record<string, unknown>;
    const apiKey = typeof t["apiKey"] === "string" ? t["apiKey"].trim() : "";
    if (!apiKey) return null;
    return { broker: "trading212", trading212: { apiKey } };
  }

  return null;
}

router.post("/broker/connect", async (req, res): Promise<void> => {
  const input = parseConnectInput(req.body);
  if (!input) {
    res.status(400).json({ error: "A valid broker and its required credential fields are required" });
    return;
  }

  // Verify the credentials actually work before saving them — better than
  // silently persisting broken credentials the user won't discover until the
  // bot fails to run.
  let verified: SaveBrokerCredentialsInput;
  if (input.broker === "trading212") {
    // Trading 212 keys are environment-specific: a key generated on a practice
    // account only authenticates against the demo host. Try live first, then demo,
    // and remember whichever worked.
    let detected: SaveBrokerCredentialsInput | null = null;
    let lastErr: unknown = null;
    for (const environment of ["live", "demo"] as const) {
      const attempt: SaveBrokerCredentialsInput = {
        broker: "trading212",
        trading212: { apiKey: input.trading212.apiKey, environment },
      };
      try {
        await getBrokerAccount(req.user!.id, attempt);
        detected = attempt;
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!detected) {
      req.log.warn({ err: lastErr, broker: input.broker }, "Broker connection test failed");
      res.status(400).json({
        error:
          "Could not connect to Trading 212 with this API key (tried both live and practice environments). In the Trading 212 app go to Settings → API, generate a new key, and paste the full value here.",
      });
      return;
    }
    verified = detected;
  } else {
    try {
      await getBrokerAccount(req.user!.id, input);
    } catch (err) {
      req.log.warn({ err, broker: input.broker }, "Broker connection test failed");
      res.status(400).json({ error: `Could not connect to ${input.broker} with these credentials. Please check them and try again.` });
      return;
    }
    verified = input;
  }

  try {
    await saveUserBrokerCredentials(req.user!.id, verified);
    // A running stream manager (if any) is holding the OLD credentials —
    // evict it so the next SSE reconnect picks up the ones just saved.
    evictCapitalStream(req.user!.id);
    res.status(201).json(await currentStatus(req.user!.id));
  } catch (err) {
    req.log.error({ err }, "Failed to save broker credentials");
    res.status(500).json({ error: "Failed to save broker credentials" });
  }
});

router.get("/broker/status", async (req, res): Promise<void> => {
  res.json(await currentStatus(req.user!.id));
});

router.delete("/broker/disconnect", async (req, res): Promise<void> => {
  stopBot(req.user!.id);
  evictCapitalStream(req.user!.id);
  await clearUserBrokerCredentials(req.user!.id);
  res.sendStatus(204);
});

export default router;
