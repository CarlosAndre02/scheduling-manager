// A driver error embeds the values the failed query was called with, and those
// values are the request body — a name, an email, whatever was being written.
// Pino's `redact` matches paths, so it cannot reach inside a message or a
// stack, and both carry them.
//
// The match ends at the next stack frame or `caused by:`, so a value spanning
// several lines is covered while the cause chain underneath survives — and that
// chain is where the failure is actually named.
// `$` is not the end of the string here: the `m` flag makes it the end of a
// line, which stops the match at the first newline and leaves the rest of a
// multi-line value in the log. `(?![\s\S])` is end-of-input regardless of `m`.
const QUERY_PARAMS =
  /^params: [\s\S]*?(?=\n\s*(?:at |caused by:)|(?![\s\S]))/gm;

/** Walks a serialised error, rewriting the parameter line wherever it appears. */
export function redactQueryParams<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(QUERY_PARAMS, "params: [redacted]") as T;
  }

  if (Array.isArray(value)) {
    return value.map(redactQueryParams) as T;
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        redactQueryParams(item),
      ]),
    ) as T;
  }

  return value;
}
