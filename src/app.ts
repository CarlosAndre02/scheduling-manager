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
