import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
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
