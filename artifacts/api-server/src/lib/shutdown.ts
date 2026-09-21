/**
 * Graceful shutdown for a process that owns trading engines.
 *
 * Render's zero-downtime deploy sends the outgoing instance SIGTERM and
 * force-kills it about 30 seconds later. The job in between is to hand the
 * engines over cleanly: fast, and never with two processes trading at once.
 *
 * The order matters, and each step exists because skipping it breaks something:
 *
 *  1. Stop adopting. A leaving process must not pick up engines on its way out.
 *  2. Stand every engine down — no new cycle may START — while leaving the
 *     user's `running` intent untouched: they still want the bot running, the
 *     incoming instance is about to run it.
 *  3. Stop accepting HTTP.
 *  4. Wait for cycles ALREADY RUNNING to finish. One may be mid-order.
 *  5. Release the leases — only if step 4 completed. Releasing while a cycle
 *     is still placing an order would let the incoming instance start trading
 *     the same account alongside it: the one failure leases exist to prevent.
 *     If the drain times out, the leases are kept and simply expire. That is
 *     safe because expiry (60-90s out, depending on when each last renewed)
 *     always comes after Render's force-kill (30s): the old process is gone
 *     before anyone else can take over.
 *
 * Before this, none of it ran: the server was started through pnpm, which does
 * not forward SIGTERM, so the process was killed mid-whatever and every lease
 * had to time out — a gap of 1.5 to 2.5 minutes on every deploy.
 */

/** Well inside Render's ~30s grace period, leaving time to release and exit. */
export const DRAIN_TIMEOUT_MS = 20_000;
const POLL_MS = 250;

export interface ShutdownDeps {
  stopAdopting: () => void;
  standDownEngines: () => Promise<number>;
  stopServer: () => void;
  inFlight: () => number;
  releaseLeases: () => Promise<void>;
  log: (msg: string, extra?: Record<string, unknown>) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface ShutdownResult {
  drained: boolean;
  released: boolean;
  engines: number;
}

export async function gracefulShutdown(deps: ShutdownDeps, drainTimeoutMs = DRAIN_TIMEOUT_MS): Promise<ShutdownResult> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;

  deps.stopAdopting();
  const engines = await deps.standDownEngines();
  deps.stopServer();

  const deadline = now() + drainTimeoutMs;
  while (deps.inFlight() > 0 && now() < deadline) {
    await sleep(POLL_MS);
  }
  const drained = deps.inFlight() === 0;

  if (!drained) {
    deps.log("Shutdown: a cycle was still running at the deadline — keeping leases so they expire after this process is gone", {
      inFlight: deps.inFlight(),
    });
    return { drained, released: false, engines };
  }

  await deps.releaseLeases();
  deps.log("Shutdown: engines stood down, cycles finished, leases released", { engines });
  return { drained, released: true, engines };
}
