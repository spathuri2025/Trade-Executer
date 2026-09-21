import app from "./app";
import { logger } from "./lib/logger";
import {
  resumeRunningBots,
  startAdoptionSweep,
  stopAdoptionSweep,
  standDownAllBots,
  cyclesInFlight,
} from "./lib/botEngine";
import { resumeRunningScanners, standDownAllScanners, scansInFlight } from "./lib/scannerEngine";
import { releaseAllLeases, INSTANCE_ID } from "./lib/engineLease";
import { gracefulShutdown } from "./lib/shutdown";

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
 * Graceful shutdown — see lib/shutdown.ts for the sequence and why each step
 * is there. This only receives SIGTERM because render.yaml starts node
 * directly (`exec node …`): started through `pnpm run`, the signal never
 * reached this process and none of this ran.
 */
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal, instanceId: INSTANCE_ID }, "Shutting down");

  const result = await gracefulShutdown({
    stopAdopting: stopAdoptionSweep,
    standDownEngines: async () => (await standDownAllBots()) + (await standDownAllScanners()),
    stopServer: () => server.close(),
    inFlight: () => cyclesInFlight() + scansInFlight(),
    releaseLeases: releaseAllLeases,
    log: (msg, extra) => logger.info({ ...extra, instanceId: INSTANCE_ID }, msg),
  });

  logger.info({ signal, ...result }, "Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
