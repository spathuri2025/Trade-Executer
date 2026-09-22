import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Fail a connection attempt instead of waiting forever. The pg default is no
  // timeout at all, so a pooler that accepts the socket but never answers left
  // every query — each bot cycle, each lease renewal — hanging indefinitely.
  connectionTimeoutMillis: 10_000,
  // Let idle clients go before the pooler reaps them on its side; a client the
  // server has already dropped is the one that errors the next time it's used.
  idleTimeoutMillis: 30_000,
  // TCP keepalive notices a silently dead connection instead of trusting it.
  keepAlive: true,
});

/**
 * An idle client whose connection the server drops (pooler restart, network
 * blip, Supabase maintenance) makes the pool emit 'error'. With no listener,
 * Node treats that as an unhandled 'error' event and kills the process — which
 * is what took production down on 22 Sep 2026 ("Exited with status 1").
 *
 * The broken client is already discarded by the pool; the next query simply
 * opens a fresh connection. So the only correct response is to note it and
 * carry on.
 */
pool.on("error", (err) => {
  console.error(JSON.stringify({ level: "error", msg: "Idle database connection dropped — pool will reconnect", err: err.message }));
});

export const db = drizzle(pool, { schema });

export * from "./schema";
