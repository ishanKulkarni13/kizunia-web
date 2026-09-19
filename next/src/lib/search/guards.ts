/**
 * Search Core - Input normalisation guards
 *
 * Every multi-value filter funnels through `normalizeList`, which is what
 * makes the most dangerous edge case in this subsystem unreachable:
 *
 *   Prisma `{ col: { in: [] } }` and `{ OR: [] }` match ZERO rows, not
 *   "no filter". Verified against the live database.
 *
 * `?modes=` therefore must NOT reach `toWhere` as an empty array, or the
 * page silently returns nothing. `normalizeList` returns `undefined` for an
 * empty result, and `bindFilter` treats `undefined` as "contributes no
 * clause" — so a filter author cannot reintroduce the bug.
 */

import type { FilterParams } from "./types";

/** Upper bound on values in a single multi-value filter (DoS guard). */
export const MAX_FILTER_VALUES = 50;

/** Upper bound on a free-text filter's length. */
export const MAX_TEXT_LENGTH = 200;

export type ListCase = "upper" | "lower" | "preserve";

/**
 * Flattens a raw parameter into a plain list of strings.
 *
 * Handles both encodings a multi-value filter can arrive in:
 * - comma-separated: `?modes=ONLINE,HYBRID`
 * - repeated keys:   `?modes=ONLINE&modes=HYBRID`  (Next.js gives an array)
 */
export function normalizeList(
  raw: string | string[] | undefined,
  options: { case?: ListCase; max?: number } = {},
): string[] | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const casing = options.case ?? "preserve";
  const max = options.max ?? MAX_FILTER_VALUES;

  const source = Array.isArray(raw) ? raw : [raw];

  const values: string[] = [];
  const seen = new Set<string>();

  for (const entry of source) {
    if (typeof entry !== "string") {
      continue;
    }

    for (const part of entry.split(",")) {
      const trimmed = part.trim();

      if (!trimmed) {
        continue;
      }

      const cased =
        casing === "upper"
          ? trimmed.toUpperCase()
          : casing === "lower"
            ? trimmed.toLowerCase()
            : trimmed;

      if (seen.has(cased)) {
        continue;
      }

      seen.add(cased);
      values.push(cased);

      if (values.length >= max) {
        break;
      }
    }

    if (values.length >= max) {
      break;
    }
  }

  // Empty is indistinguishable from absent, and must never become `in: []`.
  return values.length > 0 ? values : undefined;
}

/** Reads a single string value, taking the first when repeated. */
export function normalizeScalar(
  raw: string | string[] | undefined,
): string | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const value = Array.isArray(raw) ? raw[0] : raw;

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Escapes SQL LIKE wildcards in user input.
 *
 * Prisma does NOT escape these: `contains: "ET%26"` matched
 * "ETHGlobal New Delhi 2026" against the live database, because `%` was
 * treated as a wildcard. Not an injection risk (Prisma parameterises), but
 * a correctness bug — a user searching "50%" would otherwise match
 * everything.
 */
export function escapeLikeWildcards(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/** Normalises and truncates a free-text search value. */
export function normalizeText(
  raw: string | string[] | undefined,
  max: number = MAX_TEXT_LENGTH,
): string | undefined {
  const value = normalizeScalar(raw);

  if (value === undefined) {
    return undefined;
  }

  return value.slice(0, max);
}

/** Parses a positive integer, returning undefined for anything else. */
export function normalizeInteger(
  raw: string | string[] | undefined,
): number | undefined {
  const value = normalizeScalar(raw);

  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

/** Parses a date, returning undefined for anything unparseable. */
export function normalizeDate(
  raw: string | string[] | undefined,
): Date | undefined {
  const value = normalizeScalar(raw);

  if (value === undefined) {
    return undefined;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** Reads one owned parameter out of a filter's parameter bag. */
export function pick(
  params: FilterParams,
  key: string,
): string | string[] | undefined {
  return params[key];
}
