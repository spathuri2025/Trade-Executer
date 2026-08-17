import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { checkDatabase } from "../lib/healthCheck";

const router: IRouter = Router();

/**
 * Liveness: is this process up and serving? Deliberately shallow, and
 * deliberately what `render.yaml` points `healthCheckPath` at.
 *
 * Render restarts an instance whose health check fails. With one instance and
 * per-user bot state held in memory, that would mean a transient database blip
 * bouncing the trading engine and losing in-flight cycles — a worse outcome
 * than briefly serving errors. Depth belongs in /readyz, which nothing acts on
 * automatically.
 */
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/**
 * Readiness: can this process actually do its job? Round-trips a real query, so
 * it catches the case a liveness check cannot — the database being unreachable
 * or rejecting our credentials while the web server happily serves pages.
 *
 * Point an uptime monitor here, not at /healthz.
 */
router.get("/readyz", async (req, res): Promise<void> => {
  const database = await checkDatabase();

  if (!database.ok) {
    req.log.error({ err: database.error, latencyMs: database.latencyMs }, "Readiness check FAILED — database unreachable");
    // The underlying error is logged but never returned: this endpoint is
    // public, and messages like `password authentication failed for user
    // "postgres"` tell an attacker the database user name and that the host is
    // reachable.
    res.status(503).json({
      status: "degraded",
      database: { status: "down", latencyMs: database.latencyMs },
    });
    return;
  }

  res.json({
    status: "ok",
    database: { status: "up", latencyMs: database.latencyMs },
  });
});

export default router;
