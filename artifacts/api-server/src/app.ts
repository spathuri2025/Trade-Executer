import express, { type Express } from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set (used to sign session cookies).");
}
if (!process.env.CREDENTIALS_ENCRYPTION_KEY) {
  throw new Error("CREDENTIALS_ENCRYPTION_KEY must be set (32-byte hex — used to encrypt broker credentials at rest).");
}

const app: Express = express();

// Managed hosts (Render, Replit, and most PaaS) put a reverse proxy in front of
// the app — required for express-rate-limit (used on /auth/login and
// /auth/signup) to read the real client IP rather than the proxy's.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(process.env.SESSION_SECRET));

app.use("/api", router);

/**
 * Serve the built frontend from this same server.
 *
 * The generated API client calls `/api/...` as a RELATIVE path and auth is
 * cookie-based, so the UI and the API must share one origin — splitting them
 * across two hosts would mean cross-site cookies. One service also keeps the
 * bot engine's in-memory per-user state on the single instance that owns it.
 *
 * FRONTEND_DIST_PATH allows an override; otherwise resolve the sibling
 * trading-bot build relative to this bundle. Serving is skipped entirely when
 * the directory is absent, so an API-only deployment (or running the Vite dev
 * server separately in development) still boots normally.
 */
// fileURLToPath(import.meta.url) rather than import.meta.dirname — the same
// pattern build.mjs already uses, and portable across Node versions.
const serverDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDist =
  process.env.FRONTEND_DIST_PATH ??
  path.resolve(serverDir, "../../trading-bot/dist/public");

if (fs.existsSync(path.join(frontendDist, "index.html"))) {
  // Hashed assets are immutable and safe to cache hard; index.html must not be
  // cached, or browsers keep booting an old bundle after a deploy.
  app.use(
    express.static(frontendDist, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith("index.html")) res.setHeader("Cache-Control", "no-cache");
      },
    }),
  );

  // SPA fallback: any non-/api GET returns index.html so client-side routes
  // (/settings, /admin, …) survive a refresh or a direct link.
  app.get(/^(?!\/api\/).*/, (req, res, next) => {
    if (req.method !== "GET") return next();
    res.sendFile(path.join(frontendDist, "index.html"));
  });

  logger.info({ frontendDist }, "Serving frontend from API server");
} else {
  logger.warn({ frontendDist }, "No frontend build found — serving API only");
}

export default app;
