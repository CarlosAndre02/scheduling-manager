import { BadRequestError } from "./errors";

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export type Pagination = {
  limit: number;
  offset: number;
};

function parsePositiveInteger(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined) return undefined;

  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new BadRequestError(`${field} must be a non-negative integer`);
  }

  return Number(value);
}

/**
 * Reads `limit`/`offset` from a query string. An unbounded list endpoint is a
 * denial of service waiting to happen, so the limit is always capped whether
 * or not the caller asks for one.
 */
export function parsePagination(query: unknown): Pagination {
  const { limit, offset } = (query ?? {}) as Record<string, unknown>;

  const parsedLimit = parsePositiveInteger(limit, "limit");
  const parsedOffset = parsePositiveInteger(offset, "offset");

  if (parsedLimit !== undefined && parsedLimit < 1) {
    throw new BadRequestError("limit must be at least 1");
  }

  if (parsedLimit !== undefined && parsedLimit > MAX_LIMIT) {
    throw new BadRequestError(`limit must not exceed ${MAX_LIMIT}`);
  }

  return {
    limit: parsedLimit ?? DEFAULT_LIMIT,
    offset: parsedOffset ?? 0,
  };
}
