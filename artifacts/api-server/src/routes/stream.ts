import { Router, type IRouter } from "express";
import { acquireCapitalStream, releaseCapitalStream, type LiveQuote } from "../lib/capitalStream";
import { getUserBrokerCredentials } from "../lib/brokerCredentialsService";

const router: IRouter = Router();

/**
 * Live price stream (Server-Sent Events).
 *
 * One upstream Capital.com WebSocket per user (shared across that user's own
 * browser tabs — see `acquireCapitalStream`); each browser connection gets
 * its own SSE relay here. On connect we ensure the upstream is started and
 * subscribed to this user's currently enabled instruments, push an initial
 * snapshot, then forward every quote as it arrives.
 *
 * Event shapes (all JSON in the `data:` field):
 *   { "type": "snapshot", "quotes": LiveQuote[], "connected": boolean }
 *   { "type": "quote", "quote": LiveQuote }
 *   { "type": "status", "connected": boolean }
 */
router.get("/stream/prices", async (req, res) => {
  const userId = req.user!.id;
  const credentials = await getUserBrokerCredentials(userId);
  if (!credentials || credentials.broker !== "capitalcom") {
    res.status(400).json({ error: "Connect a Capital.com broker account first" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const write = (payload: unknown) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const stream = acquireCapitalStream(userId, credentials.capital);

  try {
    await stream.start();
    await stream.syncSubscriptions();
  } catch (err) {
    req.log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "Failed to start Capital.com stream for SSE client",
    );
  }

  write({
    type: "snapshot",
    quotes: stream.getSnapshot(),
    connected: stream.isConnected(),
  });

  const onQuote = (quote: LiveQuote) => write({ type: "quote", quote });
  const onStatus = (connected: boolean) => write({ type: "status", connected });
  stream.on("quote", onQuote);
  stream.on("status", onStatus);

  // Comment heartbeat keeps the proxy connection from idling out.
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    stream.off("quote", onQuote);
    stream.off("status", onStatus);
    releaseCapitalStream(userId);
    res.end();
  });
});

export default router;
