import { pool } from "./conn";

// A hard ceiling on the response, not only on the query.
//
// `/ready` is publicly routable — the proxy's rule is a prefix match — and the
// proxy caps concurrent requests. A probe that hangs while the database is slow
// would fill that limit with health checks and start rejecting real traffic,
// turning a degraded database into a total outage. Answering within a known
// budget is what keeps the endpoint from becoming the failure.
//
// Well under the three seconds the image's health check allows, so this budget
// decides rather than the caller's timeout.
const PROBE_TIMEOUT_MS = 2_000;

/**
 * Whether the database answers. One round-trip proves the connection, TLS, the
 * certificate authority, the credential and the pooler — the path a release has
 * to work over and that `/health` deliberately never touches.
 *
 * `SELECT 1` and not a query against a table: readiness must not depend on the
 * schema, or a release running correctly against a schema it does not yet use
 * would report itself broken.
 */
export async function isDatabaseReachable(): Promise<boolean> {
  let expiry: NodeJS.Timeout | undefined;

  const expired = new Promise<never>((_resolve, reject) => {
    expiry = setTimeout(
      () => reject(new Error(`database probe exceeded ${PROBE_TIMEOUT_MS}ms`)),
      PROBE_TIMEOUT_MS,
    );
  });

  try {
    // Racing bounds the wait for a free connection too, which is a pool-wide
    // setting with no per-call override. A query abandoned here still ends on
    // its own: the pool's `query_timeout` closes it, long before the next check.
    await Promise.race([pool.query("SELECT 1"), expired]);
    return true;
  } catch (error) {
    console.error("\n[Readiness] Database probe failed");
    console.error(error);
    return false;
  } finally {
    clearTimeout(expiry);
  }
}
