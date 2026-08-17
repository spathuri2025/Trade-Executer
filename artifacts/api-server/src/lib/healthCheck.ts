import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/**
 * How long to wait for the database before calling it unreachable. Short on
 * purpose: a health endpoint that hangs is indistinguishable to most monitors
 * from one that is down, but it ties up a connection and delays the alert.
 */
export const DB_CHECK_TIMEOUT_MS = 3_000;

export interface DatabaseCheck {
  ok: boolean;
  latencyMs: number;
  /** Present only when the check failed. For server-side logs — never sent to the client. */
  error?: unknown;
}

/**
 * Round-trips a trivial query to prove the database is genuinely reachable AND
 * that the credentials work.
 *
 * Both halves matter. On 17 Aug 2026 a wrong password in DATABASE_URL took every
 * feature down while the service looked perfectly healthy, because the old health
 * check only proved the Node process was alive. A TCP-level check wouldn't have
 * caught it either — Postgres was answering, it was rejecting the login.
 */
export async function checkDatabase(timeoutMs: number = DB_CHECK_TIMEOUT_MS): Promise<DatabaseCheck> {
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Database did not respond within ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - startedAt, error };
  } finally {
    // Without this the losing timer keeps the event loop busy for its full
    // duration on every single healthy check.
    if (timer) clearTimeout(timer);
  }
}
