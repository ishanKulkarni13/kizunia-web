/**
 * Search Core - Contracts
 *
 * Entity-agnostic building blocks for search, filtering, sorting and
 * pagination. Nothing in `src/lib/search` may reference a concrete domain
 * (Competition, Project, Blog); modules supply that via a registry.
 *
 * =============================================================================
 * One decoder, not two
 * =============================================================================
 *
 * A filter used to carry its own `decode` and `encode`, alongside the UI
 * metadata the client needed. That meant the rules for reading a parameter
 * existed twice — once for the query and once for the control — and the two
 * were free to disagree about what an acceptable value was.
 *
 * They no longer do. `readFilterValue` in `spec-values.ts` is the sole
 * decoder, it is client-safe, and both sides call it. A `FilterDescriptor` now
 * adds exactly one thing the client cannot have: the translation from a
 * decoded value to a Prisma clause.
 *
 * The practical consequence is that a filter declaration is now the spec plus
 * a `toWhere`, and there is no longer a place for the two halves to drift
 * apart.
 */

import type { FilterSpec, ValueOfSpec } from "./spec";

/**
 * Raw query parameters as delivered by Next.js.
 *
 * Repeated parameters (`?modes=ONLINE&modes=HYBRID`) arrive as arrays, so
 * this is deliberately wider than `Record<string, string>`.
 */
export type RawSearchParams = Record<string, string | string[] | undefined>;

/** The subset of parameters a single filter owns. */
export type FilterParams = RawSearchParams;

/**
 * Declares one filter for one entity.
 *
 * @typeParam TWhere the entity's Prisma where-input
 * @typeParam TSpec  this filter's spec, which fixes its value type
 */
export interface FilterDescriptor<
  TWhere,
  TSpec extends FilterSpec = FilterSpec,
> {
  readonly spec: TSpec;

  /**
   * Translates a decoded value into a clause.
   *
   * Only ever invoked with a value `readFilterValue` accepted, so it never
   * has to defend against an empty list, an out-of-range number or an
   * unparseable date — which is what keeps `{ in: [] }` (a clause matching
   * zero rows) from being constructible by accident.
   */
  readonly toWhere: (value: ValueOfSpec<TSpec>) => TWhere;
}

/**
 * A filter with its value type erased, so a registry can hold filters of
 * differing value types without resorting to `any`.
 *
 * The value type survives inside the closure created by `bindFilter`, which
 * is where all type checking actually happens.
 */
export interface BoundFilter<TWhere> {
  readonly spec: FilterSpec;

  /** Convenience mirror of `spec.key`, for registry validation and lookups. */
  readonly key: string;

  /** Every URL parameter this filter owns, per `filterParams(spec)`. */
  readonly params: readonly string[];

  /** `undefined` means the filter contributes no clause. */
  readonly toWhereFromParams: (params: RawSearchParams) => TWhere | undefined;
}

export interface PaginationInput {
  readonly page: number;
  readonly limit: number;
}

export interface PaginationMeta {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;
  readonly hasNextPage: boolean;
  readonly hasPreviousPage: boolean;
}

export interface SearchResult<T> {
  readonly items: T[];
  readonly pagination: PaginationMeta;
}
