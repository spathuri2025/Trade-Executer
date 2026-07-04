import { Router, type IRouter } from "express";
import { capitalStream, type LiveQuote } from "../lib/capitalStream";

const router: IRouter = Router();

/**
 * Live price stream (Server-Sent Events).
 *
 * A single upstream Capital.com WebSocket is shared across all clients; each
 * browser connection gets its own SSE relay here. On connect we ensure the
 * upstream is started and subscribed to the current enabled instruments, push
 * an initial snapshot, then forward every quote as it arrives.
 *
 * Event shapes (all JSON in the `data:` field):
 *   { "type": "snapshot", "quotes": LiveQuote[], "connected": boolean }
 *   { "type": "quote", "quote": LiveQuote }
 *   { "type": "status", "connected": boolean }
 */
router.get("/stream/prices", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const write = (payload: unknown) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    await capitalStream.start();
    await capitalStream.syncSubscriptions();
  } catch (err) {
    req.log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "Failed to start Capital.com stream for SSE client",
    );
  }

  write({
    type: "snapshot",
    quotes: capitalStream.getSnapshot(),
    connected: capitalStream.isConnected(),
  });

  const onQuote = (quote: LiveQuote) => write({ type: "quote", quote });
  const onStatus = (connected: boolean) => write({ type: "status", connected });
  capitalStream.on("quote", onQuote);
  capitalStream.on("status", onStatus);

  // Comment heartbeat keeps the proxy connection from idling out.
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    capitalStream.off("quote", onQuote);
    capitalStream.off("status", onStatus);
    res.end();
  });
});

export default router;
