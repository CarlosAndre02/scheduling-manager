import "dotenv/config";
import { readFileSync } from "node:fs";
import { Pool, type PoolConfig } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

// Asserting the value with `!` would defer the failure to the first query,
// where it surfaces as a driver error that names neither the variable nor the
// cause. Refusing to start says what is wrong, once.
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const STATEMENT_TIMEOUT_MS = Number(
  process.env.DATABASE_STATEMENT_TIMEOUT_MS ?? 10_000,
);

// TLS is configured here and never through `sslmode` in DATABASE_URL, because
// pg lets the connection string replace this option wholesale rather than merge
// with it: a URL carrying any sslmode silently discards the `ca` below, leaving
// verification to run against Node's default trust store — which fails for a
// provider whose certificate authority is not in it, with an error about the
// certificate rather than about the configuration. Keep sslmode out of the URL.
function resolveSsl(): PoolConfig["ssl"] {
  const caPath = process.env.DATABASE_SSL_CA;

  // Read at startup on purpose: a wrong path fails immediately instead of on
  // the first connection.
  if (caPath) return { ca: readFileSync(caPath, "utf8") };

  // For a provider whose certificate chains to a publicly trusted authority.
  return process.env.DATABASE_SSL === "true" ? true : undefined;
}

export const pool = new Pool({
  connectionString,
  ssl: resolveSsl(),
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,

  // Enforced by Postgres, so a query that overruns is cancelled and its
  // connection returns to the pool. Without it one stuck query holds a
  // connection until the process dies, and enough of them exhaust the pool.
  //
  // Migrations must run with this disabled (`0`) — DDL on a populated table can
  // legitimately take longer than any value that makes sense for a request.
  statement_timeout: STATEMENT_TIMEOUT_MS,

  // Client-side backstop for when the server never answers at all. Deliberately
  // above the server's timeout so Postgres cancels first: this one destroys the
  // connection instead of cancelling the query.
  query_timeout: STATEMENT_TIMEOUT_MS + 2_000,
});

// An idle client whose connection dies emits on the pool, and with no listener
// that becomes an uncaughtException — which the bootstrap answers by killing
// the process. A failover or a brief network blip would take every container
// down at once instead of letting the pool replace the connection. Errors on a
// client that is running a query are not routed here: those reject the query
// itself and surface as a normal request failure.
pool.on("error", (err) => {
  console.error("\n[DatabasePool] Idle client error, dropping it");
  console.error(err);
});

export const db = drizzle(pool, {
  schema,
  logger: process.env.NODE_ENV !== "production",
});
