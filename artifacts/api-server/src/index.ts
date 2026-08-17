import app from "./app";
import { logger } from "./lib/logger";
import { resumeRunningBots } from "./lib/botEngine";

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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Bots that were running before this process started must be re-armed, since
  // their timers live in memory and every deploy replaces the process. Kicked off
  // after listen (not awaited) so a slow broker or database can't delay the
  // health check; resumeRunningBots swallows its own errors.
  //
  // This lives here rather than in app.ts on purpose: tests import app.ts, and
  // importing the app must never start placing trades.
  void resumeRunningBots();
});
