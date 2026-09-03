import { AsyncLocalStorage } from "node:async_hooks";

type RequestContext = {
  requestId: string;
};

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Carries the request id down the call stack without it appearing in a single
 * signature.
 *
 * The alternative is threading a logger — or the id — through every
 * constructor, which would put a transport concern in the domain layer: a use
 * case would have to accept a parameter it never reads, only forwards. Here the
 * layers below stay unaware that logging exists at all.
 *
 * Node keeps the store attached across `await`, so anything the request awaits
 * reads the same context.
 */
export function runWithRequestContext<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId }, fn);
}

/** Undefined outside a request — startup, shutdown and the migration runner. */
export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}
