/**
 * Search Core - Engine
 *
 * Ties filters, scope, sort and pagination together into one Prisma-ready
 * query. This is the only place that composes a `where` clause; modules never
 * build one by hand.
 *
 * Composition order:
 *
 *   composeAnd([
 *     ...baseClauses,          // e.g. deletedAt: null, resolved location
 *     ...filterClauses,        // one per supplied, scope-allowed filter
 *     ...scope.guard(context), // visibility / ownership — always last
 *   ])
 *
 * =============================================================================
 * Purity
 * =============================================================================
 *
 * `buildSearchQuery` is synchronous and pure, and must stay that way. A query
 * builder able to reach a network or a database would be untestable, would
 * make every call site implicitly async, and would put a provider outage
 * inside the one function that must always produce a well-formed query.
 *
 * Filters that genuinely need a lookup are declared separately, as resolvable
 * filters (see `resolve.ts`). They are resolved *before* this function runs,
 * and their clauses arrive as `baseClauses`.
 */

import type { AndComposable } from "./compose";
import { composeAnd } from "./compose";
import { RESERVED_PARAMS, readSortToken } from "./params";
import type { PaginationConfig } from "./pagination";
import { parsePagination, toSkipTake } from "./pagination";
import type { BoundResolvableFilter } from "./resolve";
import type { SearchScope } from "./scope";
import { filterKeysForScope, UnknownScopeError } from "./scope";
import type { SortRegistry } from "./sort";
import { resolveSort } from "./sort";
import type { FilterSpec } from "./spec";
import type { BoundFilter, RawSearchParams } from "./types";

export class InvalidSearchDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSearchDefinitionError";
  }
}

export interface SearchDefinition<TWhere, TOrderBy, TContext> {
  readonly entity: string;

  readonly filters: readonly BoundFilter<TWhere>[];

  /**
   * Filters whose clause requires an asynchronous lookup.
   *
   * Registered here, rather than handled ad hoc in each service, so they are
   * subject to the same duplicate-parameter and scope rules as every other
   * filter — and so the UI, which iterates the registry, can see them. A
   * filter a service applies but the registry does not know about is one the
   * interface cannot display, chip, or clear.
   */
  readonly resolvableFilters?: readonly BoundResolvableFilter<TWhere>[];

  readonly sorts: SortRegistry<TOrderBy>;

  readonly scopes: Readonly<Record<string, SearchScope<TWhere, TContext>>>;

  readonly pagination?: PaginationConfig;
}

export interface SearchQuery<TWhere, TOrderBy> {
  readonly where: TWhere;
  readonly orderBy: TOrderBy[];
  readonly skip: number;
  readonly take: number;
}

/**
 * Validates a definition at construction time rather than at first use, so a
 * mistake surfaces immediately (module load / test run) instead of in a
 * production request.
 */
export function defineSearch<
  TWhere extends AndComposable<TWhere>,
  TOrderBy,
  TContext,
>(
  definition: SearchDefinition<TWhere, TOrderBy, TContext>,
): SearchDefinition<TWhere, TOrderBy, TContext> {
  const seenFilterKeys = new Set<string>();

  // Every URL parameter claimed by any filter. Checked separately from `key`
  // because a filter's owned parameters can be derived rather than equal to
  // its key — a date range owns `<key>From` and `<key>To`, and a place owns
  // three. Two filters could therefore fight over one URL parameter while
  // having distinct keys.
  const seenParams = new Map<string, string>();

  const everyFilter: readonly {
    key: string;
    params: readonly string[];
  }[] = [
    ...definition.filters,
    ...(definition.resolvableFilters ?? []),
  ];

  for (const filter of everyFilter) {
    if (seenFilterKeys.has(filter.key)) {
      throw new InvalidSearchDefinitionError(
        `[${definition.entity}] duplicate filter key "${filter.key}".`,
      );
    }

    seenFilterKeys.add(filter.key);

    for (const param of filter.params) {
      if (RESERVED_PARAMS.has(param)) {
        throw new InvalidSearchDefinitionError(
          `[${definition.entity}] filter "${filter.key}" claims URL parameter "${param}", ` +
            `which is reserved for pagination and sorting.`,
        );
      }

      const owner = seenParams.get(param);

      if (owner !== undefined) {
        throw new InvalidSearchDefinitionError(
          `[${definition.entity}] filters "${owner}" and "${filter.key}" both claim URL parameter "${param}".`,
        );
      }

      seenParams.set(param, filter.key);
    }
  }

  for (const [scopeId, scope] of Object.entries(definition.scopes)) {
    for (const key of scope.guardedKeys ?? []) {
      if (seenFilterKeys.has(key) || seenParams.has(key)) {
        throw new InvalidSearchDefinitionError(
          `[${definition.entity}] scope "${scopeId}" guards "${key}", but a filter of the same key is also registered. ` +
            `Visibility and ownership must be enforced by the scope, not requestable as a filter.`,
        );
      }
    }
  }

  if (Object.keys(definition.scopes).length === 0) {
    throw new InvalidSearchDefinitionError(
      `[${definition.entity}] must declare at least one scope — there is no unscoped entry point.`,
    );
  }

  return definition;
}

export interface BuildSearchQueryArgs<TWhere, TOrderBy, TContext> {
  readonly definition: SearchDefinition<TWhere, TOrderBy, TContext>;
  readonly params: RawSearchParams;
  readonly scope: string;
  readonly context: TContext;

  /**
   * Always ANDed first — the entity's own invariants (`deletedAt: null`) plus
   * anything produced by `resolveBaseClauses`.
   *
   * Unlike filter clauses these are never dropped, which is exactly why a
   * resolved-to-nothing location belongs here rather than in the filter list.
   */
  readonly baseClauses?: readonly TWhere[];
}

export function buildSearchQuery<
  TWhere extends AndComposable<TWhere>,
  TOrderBy,
  TContext,
>(
  args: BuildSearchQueryArgs<TWhere, TOrderBy, TContext>,
): SearchQuery<TWhere, TOrderBy> {
  const { definition, params, context } = args;

  const scope = definition.scopes[args.scope];

  if (!scope) {
    throw new UnknownScopeError(args.scope, definition.entity);
  }

  const allowedKeySet = new Set(
    filterKeysForScope(
      scope,
      definition.filters.map((filter) => filter.key),
    ),
  );

  const filterClauses: TWhere[] = [];

  for (const filter of definition.filters) {
    if (!allowedKeySet.has(filter.key)) {
      continue;
    }

    const clause = filter.toWhereFromParams(params);

    if (clause !== undefined) {
      filterClauses.push(clause);
    }
  }

  const where = composeAnd<TWhere>([
    ...(args.baseClauses ?? []),
    ...filterClauses,
    ...scope.guard(context),
  ]);

  const orderBy = resolveSort(definition.sorts, readSortToken(params));

  const pagination = parsePagination(params, definition.pagination);
  const { skip, take } = toSkipTake(pagination);

  return { where, orderBy, skip, take };
}

/**
 * The ordinary filters a caller may use in a given scope, in registry order.
 *
 * Excludes anything the scope has stripped via `allowedFilters`.
 */
export function filtersForScope<TWhere, TOrderBy, TContext>(
  definition: SearchDefinition<TWhere, TOrderBy, TContext>,
  scopeId: string,
): readonly BoundFilter<TWhere>[] {
  const scope = requireScope(definition, scopeId);

  const allowed = new Set(
    filterKeysForScope(
      scope,
      definition.filters.map((filter) => filter.key),
    ),
  );

  return definition.filters.filter((filter) => allowed.has(filter.key));
}

/**
 * The resolvable filters a caller may use in a given scope.
 *
 * Scope-filtered on the same basis as ordinary filters, so a scope that
 * disallows a key disallows it regardless of which kind of filter it is.
 */
export function resolvableFiltersForScope<TWhere, TOrderBy, TContext>(
  definition: SearchDefinition<TWhere, TOrderBy, TContext>,
  scopeId: string,
): readonly BoundResolvableFilter<TWhere>[] {
  const scope = requireScope(definition, scopeId);

  const resolvable = definition.resolvableFilters ?? [];

  const allowed = new Set(
    filterKeysForScope(
      scope,
      resolvable.map((filter) => filter.key),
    ),
  );

  return resolvable.filter((filter) => allowed.has(filter.key));
}

/**
 * Every filter spec a caller may see in a scope — ordinary and resolvable
 * together, which is what the interface iterates.
 *
 * Returning both kinds from one function is the point: to the person using
 * the page, location is simply another filter. That it needs a lookup is an
 * implementation detail of how its clause is produced, and nothing in the UI
 * layer should have to know it.
 */
export function filterSpecsForScope<TWhere, TOrderBy, TContext>(
  definition: SearchDefinition<TWhere, TOrderBy, TContext>,
  scopeId: string,
): readonly FilterSpec[] {
  return [
    ...filtersForScope(definition, scopeId),
    ...resolvableFiltersForScope(definition, scopeId),
  ].map((filter) => filter.spec);
}

function requireScope<TWhere, TOrderBy, TContext>(
  definition: SearchDefinition<TWhere, TOrderBy, TContext>,
  scopeId: string,
): SearchScope<TWhere, TContext> {
  const scope = definition.scopes[scopeId];

  if (!scope) {
    throw new UnknownScopeError(scopeId, definition.entity);
  }

  return scope;
}
