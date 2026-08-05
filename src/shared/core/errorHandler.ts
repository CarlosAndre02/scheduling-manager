import { randomUUID } from "node:crypto";
import { NextFunction, Request, Response } from "express";

import { DefaultError } from "./errors";

export function notFoundHandler(_req: Request, res: Response): Response {
  return res.status(404).json({ message: "Route not found" });
}

function isBodyParserSyntaxError(err: Error): boolean {
  return err instanceof SyntaxError && "body" in err;
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  next: NextFunction,
): Response | void {
  if (res.headersSent) return next(err);

  if (err instanceof DefaultError) {
    console.log(`\n[${err.name}]: An Application error occurred`);
    console.error(err.message);
    return res.status(err.code).json({ message: err.message });
  }

  if (isBodyParserSyntaxError(err)) {
    return res.status(400).json({ message: "Malformed JSON body" });
  }

  // Nothing below here is safe to expose: driver and query errors carry table
  // names, SQL fragments and parameter values. The client gets an id, the
  // details stay in the server log.
  const errorId = randomUUID();
  console.log(`\n[InternalError]: errorId=${errorId}`);
  console.error(err);

  return res.status(500).json({
    message: "Internal server error",
    errorId,
    ...(process.env.NODE_ENV !== "production" ? { detail: err.message } : {}),
  });
}
