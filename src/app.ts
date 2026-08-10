import express, { Request, Response } from "express";

import { userRouter } from "./modules/user/routes";
import { meetingRouter } from "./modules/meeting/routes";
import { schedulingRouter } from "./modules/scheduling/routes";
import { errorHandler, notFoundHandler } from "./shared/core/errorHandler";
import { isShuttingDown } from "./shared/core/lifecycle";

const app = express();

// The largest legitimate body is a meeting, whose longest field caps at 100
// characters. The 100kb default is orders of magnitude more than that.
const BODY_LIMIT = "10kb";

// Behind a proxy, the socket address is the proxy's, so `req.ip` reports the
// balancer for every client. Anything keyed on the caller's address — rate
// limiting first of all — is silently wrong until Express is told how many
// proxies to look past in X-Forwarded-For.
//
// The count has to be exact. Trusting every proxy (`true`) lets a client send
// its own X-Forwarded-For and claim any address it likes, which is worse than
// trusting none. Zero, the default here, means the request came straight from
// the client — correct for local development, wrong the moment a proxy exists.
const TRUSTED_PROXY_HOPS = Number(process.env.TRUSTED_PROXY_HOPS ?? 0);

app.set("trust proxy", TRUSTED_PROXY_HOPS);

app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

app.get("/", (_req: Request, res: Response) => {
  res.json({ message: "Hello World!" });
});

app.get("/health", (_req: Request, res: Response) => {
  // While draining, report unhealthy so the load balancer deregisters this
  // instance before its in-flight connections are closed.
  if (isShuttingDown()) {
    return res
      .status(503)
      .json({ status: "SHUTTING_DOWN", timestamp: new Date().toISOString() });
  }

  return res
    .status(200)
    .json({ status: "OK", timestamp: new Date().toISOString() });
});

app.use(userRouter);
app.use(meetingRouter);
app.use(schedulingRouter);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
