import { Router, type IRouter, type Request } from "express";
import { requireSession } from "../middlewares/auth";

const router: IRouter = Router();

const BOT_ENGINE_URL = (
  process.env["BOT_ENGINE_URL"] ?? "http://localhost:8001"
).replace(/\/$/, "");
const BOT_BASE_PATH = "/engine";
const ADMIN_API_KEY = process.env["ADMIN_API_KEY"] ?? "";

if (process.env["NODE_ENV"] === "production" && !ADMIN_API_KEY) {
  throw new Error(
    "ADMIN_API_KEY is required in production: the bot engine proxy uses it to " +
      "authenticate upstream requests. Set it as a deployment secret before publishing.",
  );
}

/**
 * Authenticated reverse proxy from /api/engine/* to the Python bot engine.
 *
 * The browser only ever talks to this Node server. The admin API key never
 * leaves the server: requests are gated by the dashboard session cookie, and
 * the key is injected here before forwarding to the bot engine.
 */
router.use("/engine", requireSession, async (req: Request, res) => {
  const search = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const subPath = req.path; // path after /api/engine, e.g. /bot/status
  const target = `${BOT_ENGINE_URL}${BOT_BASE_PATH}${subPath}${search}`;

  const method = req.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  const headers: Record<string, string> = {
    "x-api-key": ADMIN_API_KEY,
    accept: "application/json",
  };
  if (hasBody) {
    headers["content-type"] = "application/json";
  }

  try {
    const upstream = await fetch(target, {
      method,
      headers,
      body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
    });

    const text = await upstream.text();
    res.status(upstream.status);
    const contentType = upstream.headers.get("content-type");
    if (contentType) res.set("content-type", contentType);
    res.send(text);
  } catch (err) {
    req.log.error({ err, target }, "Bot engine proxy request failed");
    res
      .status(502)
      .json({ error: "Bot engine is unavailable. Please try again shortly." });
  }
});

export default router;
