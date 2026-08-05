import "dotenv/config";

import app from "./app";
import { markShuttingDown } from "./shared/core/lifecycle";
import { pool } from "./shared/database/conn";

const PORT = Number(process.env.SERVER_PORT ?? 4000);
const DRAIN_DELAY_MS = Number(process.env.SHUTDOWN_DRAIN_DELAY_MS ?? 5000);
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 15000);

const server = app.listen(PORT, () => {
  console.log(`\nServer is running on port ${PORT}`);
  console.log(`Hello World endpoint: http://localhost:${PORT}/`);
});

// Both must stay above the load balancer idle timeout (60s on an AWS ALB).
// Otherwise the balancer may reuse a connection Node is closing and the client
// sees a sporadic 502.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

let shutdownStarted = false;

async function shutdown(signal: string) {
  if (shutdownStarted) return;
  shutdownStarted = true;

  console.log(`\n[${signal}] Draining - /health now reports unhealthy`);
  markShuttingDown();
  await wait(DRAIN_DELAY_MS);

  const forceExit = setTimeout(() => {
    console.error(
      `Shutdown exceeded ${SHUTDOWN_TIMEOUT_MS}ms, closing open connections`,
    );
    server.closeAllConnections();
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
    server.closeIdleConnections();
  });

  clearTimeout(forceExit);
  await pool.end();

  console.log("Shutdown complete");
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

// Past this point the process state cannot be trusted, so there is no attempt
// to drain: log what happened and let the orchestrator start a fresh instance.
function crash(reason: string, err: unknown) {
  console.error(`\n[${reason}] Terminating`);
  console.error(err);
  process.exit(1);
}

process.on("uncaughtException", (err) => crash("uncaughtException", err));
process.on("unhandledRejection", (reason) =>
  crash("unhandledRejection", reason),
);
