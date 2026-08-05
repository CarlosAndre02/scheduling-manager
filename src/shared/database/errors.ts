const UNIQUE_VIOLATION = "23505";

type PostgresError = {
  code?: string;
  constraint?: string;
};

// Drizzle wraps driver failures in a DrizzleQueryError and keeps the pg error
// (where the SQLSTATE code and the constraint name live) in `cause`.
function toPostgresError(err: unknown): PostgresError | undefined {
  let current: unknown = err;

  for (let depth = 0; current && depth < 5; depth += 1) {
    const candidate = current as PostgresError;
    if (typeof candidate.code === "string") return candidate;
    current = (current as { cause?: unknown }).cause;
  }

  return undefined;
}

/**
 * Detects a unique constraint violation, optionally narrowed to one
 * constraint or index name so unrelated collisions are not swallowed.
 */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const pgError = toPostgresError(err);
  if (pgError?.code !== UNIQUE_VIOLATION) return false;

  return constraint === undefined || pgError.constraint === constraint;
}
