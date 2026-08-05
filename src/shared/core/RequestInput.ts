import { BadRequestError } from "./errors";
import { TextUtils } from "../utils/TextUtils";

/**
 * Reads raw values off a request and turns them into typed ones, rejecting
 * anything malformed with a 400. Controllers should never touch `req.body` or
 * `req.params` values directly: reaching for `.trim()` on a missing field is a
 * TypeError, which surfaces as an opaque 500 for what is a client mistake.
 */

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new BadRequestError(`${field} is required and must be a string`);
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new BadRequestError(`${field} must not be empty`);
  }

  return trimmed;
}

export function optionalString(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined || value === null) return undefined;

  return requireString(value, field);
}

export function requireUuid(value: unknown, field: string): string {
  const parsed = requireString(value, field);

  if (!TextUtils.isValidUuid(parsed)) {
    throw new BadRequestError(`${field} must be a valid uuid`);
  }

  return parsed;
}

export function requireInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new BadRequestError(`${field} is required and must be an integer`);
  }

  return value;
}
