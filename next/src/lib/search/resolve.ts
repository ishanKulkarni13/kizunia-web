/**
 * Search Core - Resolvable filters
 *
 * =============================================================================
 * Why a second kind of filter exists
 * =============================================================================
 *
 * An ordinary filter turns URL parameters into a clause synchronously and
 * purely. That is what lets `buildSearchQuery` stay a pure function, and it is
 * a property worth protecting: a query builder that could reach a network or a
 * database would be untestable and unpredictable.
 *
 * Some filters cannot work that way. A location filter carries a provider
 * place id, and the set of rows it matches is only knowable after asking an
 * external service what that place *is*. The work has to happen before the
 * query is built, and it has to be able to fail.
 *
 * This module gives that shape a name, so it can be declared in a registry
 * alongside ordinary filters instead of being special-cased by hand in each
 * service that needs it.
 *
 * =============================================================================
 * The invariant that makes this necessary
 * =============================================================================
 *
 * The engine drops any ordinary filter whose value decodes to `undefined`,
 * and `normalizeList` deliberately maps an empty list to `undefined` — "empty
 * is indistinguishable from absent". That is correct for every ordinary
 * filter and catastrophic for a resolved one:
 *
 *   A user selects a real town. It resolves successfully. It matches zero
 *   stored areas. If that became "no clause", the page would answer
 *   "nowhere has any competitions" by showing every competition on the
 *   platform.
 *
 * So a resolvable filter's `toWhere` is required to return a clause for
 * **every** resolved value, including one that matched nothing — typically a
 * deliberately unsatisfiable clause. The clauses produced here are then passed
 * to the engine as *base* clauses, which `composeAnd` applies unconditionally
 * and no code path is able to discard.
 *
 * =============================================================================
 * Three outcomes, never conflated
 * =============================================================================
 *
 *   ABSENT   the filter was not requested         → contributes no clause
 *   CLAUSE   resolved, possibly to nothing        → contributes a clause
 *   FAILED   the authority could not be consulted → the request fails
 *
 * The third is the one that is easy to get wrong. A provider outage must not
 * render as an empty result set: "we could not find out" and "there is nothing
 * there" are different answers, and showing the second when the first is true
 * tells the user something false.
 */

import { filterParams, type FilterSpec, type ValueOfSpec } from "./spec";
import { readFilterValue } from "./spec-values";
import type { RawSearchParams } from "./types";

// =============================================================================
// Resolution outcomes
// =============================================================================

/**
 * The result of consulting an external authority about one filter value.
 *
 * `RESOLVED` carries whatever the authority returned — which may legitimately
 * be an empty set. Emptiness is a successful answer, not a failure, and the
 * two must stay distinguishable all the way to the caller.
 */
export type FilterResolution<TResolved> =
  | { readonly status: "RESOLVED"; readonly value: TResolved }
  | { readonly status: "FAILED"; readonly reason: string };

/** Convenience constructors, so call sites read as intent rather than shape. */
export const resolved = <T>(value: T): FilterResolution<T> => ({
  status: "RESOLVED",
  value,
});

export const resolutionFailed = <T>(reason: string): FilterResolution<T> => ({
  status: "FAILED",
  reason,
});

// =============================================================================
// Declaration
// =============================================================================

/**
 * Declares one filter whose clause requires an asynchronous lookup.
 *
 * @typeParam TWhere    the entity's Prisma where-input
 * @typeParam TSpec     the filter's spec, which fixes its decoded value type
 * @typeParam TResolved whatever the authority returns
 */
export interface ResolvableFilterDescriptor<
  TWhere,
  TSpec extends FilterSpec,
  TResolved,
> {
  readonly spec: TSpec;

  /**
   * Consults the authority.
   *
   * Must not throw. A lookup that cannot complete returns `FAILED` with a
   * reason, so the caller can distinguish an outage from an empty answer and
   * respond to each correctly. Throwing would collapse that distinction into
   * a generic error.
   */
  readonly resolve: (
    value: ValueOfSpec<TSpec>,
  ) => Promise<FilterResolution<TResolved>>;

  /**
   * Builds the clause from a resolved value.
   *
   * **Must return a clause for every input, including an empty resolution.**
   * Returning something permissive for an empty result would widen the search
   * instead of narrowing it — see the invariant note at the top of this file.
   *
   * The original decoded value is passed alongside the resolution because a
   * filter may carry modifiers that survive resolution: a location's "also
   * include online" toggle affects the clause but not the lookup.
   */
  readonly toWhere: (
    resolvedValue: TResolved,
    value: ValueOfSpec<TSpec>,
  ) => TWhere;
}

/** A resolvable filter with its value and resolution types erased. */
export interface BoundResolvableFilter<TWhere> {
  readonly spec: FilterSpec;

  readonly key: string;

  readonly params: readonly string[];

  readonly resolveClause: (
    params: RawSearchParams,
  ) => Promise<ResolvedClause<TWhere>>;
}

export type ResolvedClause<TWhere> =
  | { readonly status: "ABSENT" }
  | { readonly status: "CLAUSE"; readonly clause: TWhere }
  | { readonly status: "FAILED"; readonly key: string; readonly reason: string };

export function bindResolvableFilter<
  TWhere,
  TSpec extends FilterSpec,
  TResolved,
>(
  descriptor: ResolvableFilterDescriptor<TWhere, TSpec, TResolved>,
): BoundResolvableFilter<TWhere> {
  const { spec } = descriptor;

  return {
    spec,

    key: spec.key,

    params: filterParams(spec),

    resolveClause: async (params) => {
      const value = readFilterValue(spec, params);

      if (value === undefined) {
        return { status: "ABSENT" };
      }

      const resolution = await descriptor.resolve(value);

      if (resolution.status === "FAILED") {
        return { status: "FAILED", key: spec.key, reason: resolution.reason };
      }

      return {
        status: "CLAUSE",
        clause: descriptor.toWhere(resolution.value, value),
      };
    },
  };
}

// =============================================================================
// Resolving a whole registry
// =============================================================================

export type BaseClauseResolution<TWhere> =
  | { readonly status: "RESOLVED"; readonly clauses: readonly TWhere[] }
  | { readonly status: "FAILED"; readonly key: string; readonly reason: string };

/**
 * Resolves every resolvable filter into the base clauses for one request.
 *
 * Runs the lookups concurrently — they are independent, and a page with two
 * resolvable filters should not pay for them serially. The first failure wins:
 * once any authority could not be consulted, the request cannot produce a
 * truthful answer, so there is nothing to be gained from the others.
 *
 * The result must be computed **once per request** and passed to both the row
 * query and the count query. Resolving separately for each would let a cache
 * expiring between the two calls produce a total that disagrees with the rows
 * — a bug that would appear only intermittently and only under load.
 */
export async function resolveBaseClauses<TWhere>(
  filters: readonly BoundResolvableFilter<TWhere>[],
  params: RawSearchParams,
): Promise<BaseClauseResolution<TWhere>> {
  if (filters.length === 0) {
    return { status: "RESOLVED", clauses: [] };
  }

  const outcomes = await Promise.all(
    filters.map((filter) => filter.resolveClause(params)),
  );

  const clauses: TWhere[] = [];

  for (const outcome of outcomes) {
    if (outcome.status === "FAILED") {
      return {
        status: "FAILED",
        key: outcome.key,
        reason: outcome.reason,
      };
    }

    if (outcome.status === "CLAUSE") {
      clauses.push(outcome.clause);
    }
  }

  return { status: "RESOLVED", clauses };
}
