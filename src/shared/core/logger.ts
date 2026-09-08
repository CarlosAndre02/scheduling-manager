import pino from "pino";

import { redactQueryParams } from "./redactQueryParams";
import { getRequestId } from "./requestContext";

// The one seam the application logs through. Destination, format and level are
// decided here and nowhere else, so changing any of them never reaches a call
// site — the same reason conn.ts is the only place that knows how the database
// is reached.

const LEVEL = process.env.LOG_LEVEL ?? "info";

// Logs are copied to places with weaker access control than the database they
// came from, and redaction added after the fact does not reach what already
// shipped. These paths are removed before a record is serialised, so a header
// or a field that should never travel cannot be logged by accident.
const REDACTED = [
  "req.headers.authorization",
  "req.headers.cookie",
  "*.password",
  "*.secret",
  "*.token",
  "DATABASE_URL",
];

// Pretty output is a development-only concern, and the split is by consumer
// rather than by taste: in development a person reads this at a terminal, in
// production a collector parses it. A transport spawns a worker thread, which
// is a cost worth paying for the first and not the second.
const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: LEVEL,
  redact: { paths: REDACTED, remove: true },

  // "level":"info" rather than "level":30. The number is pino's internal
  // ordering and means nothing to whoever reads the log.
  formatters: {
    level: (label) => ({ level: label }),
  },

  // Every record made inside a request carries the id that identifies it,
  // without any call site passing it. Outside a request this adds nothing.
  serializers: {
    err: (err: Error) => redactQueryParams(pino.stdSerializers.err(err)),
  },

  mixin() {
    const requestId = getRequestId();
    return requestId ? { requestId } : {};
  },

  transport: isProduction
    ? undefined
    : { target: "pino-pretty", options: { translateTime: "HH:MM:ss.l" } },
});
