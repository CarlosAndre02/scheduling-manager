import * as Sentry from "@sentry/node";

import { redactQueryParams } from "./redactQueryParams";
import { getRequestId } from "./requestContext";

// Logs answer "what happened in this request". This answers "how many users hit
// this, since which release" — a different question, and the one that decides
// whether to roll back. Grouping is the whole value: the same exception forty
// thousand times is forty thousand log records and one entry here, with a count
// on it.

const DSN = process.env.SENTRY_DSN;

/**
 * Inert without a DSN, which is the state every local run and every test is in.
 * A tracker that refused to start without one would make the credential a
 * requirement for running the application at all.
 */
export function initErrorTracking(): void {
  if (!DSN) return;

  Sentry.init({
    dsn: DSN,

    // The release is the commit SHA the image was built from, which is also
    // what `scripts/release.sh` takes to roll back. Without it an error spike
    // has no culprit and the way back is a guess — see docs/rollback.md.
    release: process.env.APP_RELEASE,
    environment: process.env.NODE_ENV ?? "development",

    // Off. Tracing here would sample every request to a third party for a
    // single-service system that has no second hop to attribute time to, and
    // the free allowance is measured in events.
    tracesSampleRate: 0,

    // The same redaction the log applies. A driver error embeds the values the
    // query was called with, and shipping them to a third party is a wider
    // disclosure than writing them to a disk we own.
    beforeSend: (event) => redactQueryParams(event),
  });
}

/**
 * Reports a failure under the id already returned to the client and written to
 * the log, so one identifier reaches all three.
 */
export function captureError(err: unknown, errorId: string): void {
  if (!DSN) return;

  Sentry.withScope((scope) => {
    scope.setTag("error_id", errorId);

    const requestId = getRequestId();
    if (requestId) scope.setTag("request_id", requestId);

    Sentry.captureException(err);
  });
}

/** Gives in-flight events a chance to leave before the process does. */
export function flushErrorTracking(timeoutMs: number): Promise<boolean> {
  if (!DSN) return Promise.resolve(true);
  return Sentry.flush(timeoutMs);
}
