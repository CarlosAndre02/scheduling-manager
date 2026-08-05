import { randomUUID } from "node:crypto";
import { NextFunction, Request, Response } from "express";

import { DefaultError } from "./errors";

export function notFoundHandler(_req: Request, res: Response): Response {
  return res.status(404).json({ message: "Route not found" });
}

// body-parser rejects a request before it ever reaches a controller, tagging
// the error with an HTTP status and a machine-readable type. Without this the
// client's own mistake would be reported as an internal failure.
const BODY_PARSER_MESSAGES: Record<string, string> = {
  "entity.parse.failed": "Malformed JSON body",
  "entity.too.large": "Request body is too large",
  "encoding.unsupported": "Unsupported content encoding",
};

type RequestError = Error & {
  status?: number;
  statusCode?: number;
  type?: string;
};

function clientErrorStatus(err: RequestError): number | undefined {
  const status = err.status ?? err.statusCode;
  if (typeof status !== "number" || status < 400 || status >= 500) {
    return undefined;
  }
  return status;
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

  const status = clientErrorStatus(err as RequestError);
  if (status !== undefined) {
    const type = (err as RequestError).type;
    const message = (type && BODY_PARSER_MESSAGES[type]) || "Invalid request";
    return res.status(status).json({ message });
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
