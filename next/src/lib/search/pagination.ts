/**
 * Search Core - Pagination
 *
 * `page`/`limit` are clamped, never rejected: an out-of-range value in a
 * shared or hand-edited URL should degrade to a sane default, not produce
 * an error page (see docs/.../07-implementation-design.md §3).
 */

import type { PaginationInput, PaginationMeta, RawSearchParams } from "./types";
import { normalizeScalar } from "./guards";
import { LIMIT_PARAM, PAGE_PARAM } from "./params";

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/** Upper bound purely as a sanity clamp against absurd input like `1e999`. */
const MAX_PAGE = 100_000;

export interface PaginationConfig {
  readonly defaultLimit: number;
  readonly maxLimit: number;
}

export const DEFAULT_PAGINATION_CONFIG: PaginationConfig = {
  defaultLimit: DEFAULT_LIMIT,
  maxLimit: MAX_LIMIT,
};

function clampInt(
  raw: string | string[] | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = normalizeScalar(raw);

  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

export function parsePagination(
  params: RawSearchParams,
  config: PaginationConfig = DEFAULT_PAGINATION_CONFIG,
): PaginationInput {
  const page = clampInt(params[PAGE_PARAM], DEFAULT_PAGE, 1, MAX_PAGE);
  const limit = clampInt(
    params[LIMIT_PARAM],
    config.defaultLimit,
    1,
    config.maxLimit,
  );

  return { page, limit };
}

export function buildPaginationMeta(
  input: PaginationInput,
  total: number,
): PaginationMeta {
  const totalPages = Math.ceil(total / input.limit);

  return {
    page: input.page,
    limit: input.limit,
    total,
    totalPages,
    hasNextPage: input.page < totalPages,
    hasPreviousPage: input.page > 1,
  };
}

export function toSkipTake(input: PaginationInput): {
  skip: number;
  take: number;
} {
  return {
    skip: (input.page - 1) * input.limit,
    take: input.limit,
  };
}
