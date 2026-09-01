import app from "./app";
import { logger } from "./lib/logger";
import { resumeRunningBots, startAdoptionSweep, stopAdoptionSweep } from "./lib/botEngine";
import { resumeRunningScanners } from "./lib/scannerEngine";
import { releaseAllLeases, INSTANCE_ID } from "./lib/engineLease";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port, instanceId: INSTANCE_ID }, "Server listening");

  // Bots that were running before this process started must be re-armed, since
  // their timers live in memory and every deploy replaces the process. Kicked off
  // after listen (not awaited) so a slow broker or database can't delay the
  // health check; resumeRunningBots swallows its own errors.
  //
  // This lives here rather than in app.ts on purpose: tests import app.ts, and
  // importing the app must never start placing trades.
  void resumeRunningBots();
  void resumeRunningScanners();

  // During a zero-downtime deploy the outgoing instance still owns the leases
  // when we boot, so the resume above deliberately declines those bots. The
  // sweep is what picks them up once that process exits — without it a deploy
  // would leave every bot stopped with nothing ever trying again.
  startAdoptionSweep();
});

/**
 * Graceful shutdown.
 *
 * Releasing the leases is the point: it turns a deploy handover from "the new
 * instance waits up to 90 seconds for leases to expire" into "the new instance
 * takes over on its next sweep". Without it the bots are correct but idle for a
 * minute and a half after every deploy.
 *
 * Render sends SIGTERM and then kills the process, so this is best-effort and
 * deliberately short. A missed release is not a correctness problem — the lease
 * expires on its own — only a slower handover.
 */
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal, instanceId: INSTANCE_ID }, "Shutting down — releasing engine leases");

  stopAdoptionSweep();
  // Stop accepting new connections while we let the leases go.
  server.close();
  await releaseAllLeases();

  logger.info({ signal }, "Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
