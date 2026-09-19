/**
 * Search Core - Scope enforcement
 *
 * A scope is how "public search", "my competitions", "admin search" differ
 * without turning visibility/ownership into a caller-suppliable filter —
 * which is exactly how the Projects module ended up letting an
 * unauthenticated request retrieve non-public projects (see
 * docs/project/feature-specification/search/01-current-state.md §D).
 *
 * Two invariants the engine enforces, not just documents:
 *
 *  1. A query cannot be built without naming a scope. There is no
 *     unscoped entry point.
 *  2. Any filter key not in `allowedFilters` is silently dropped before
 *     composition — never honoured, never an error. A guarded column can
 *     therefore never be reintroduced as a filter by accident.
 */

import type { AndComposable } from "./compose";

/**
 * @typeParam TWhere   the entity's Prisma where-input
 * @typeParam TContext data the guard needs (e.g. the current actor id)
 */
export interface SearchScope<TWhere, TContext> {
  readonly id: string;

  /**
   * Filter keys the caller may supply in this scope. `"all"` permits every
   * registered filter. Prefer `"all"` unless a scope has a specific reason
   * to narrow it (there is no reason to hide, say, `categories` from an
   * admin search).
   */
  readonly allowedFilters: ReadonlySet<string> | "all";

  /**
   * Non-negotiable predicates ANDed into every query in this scope, e.g.
   * `visibility: PUBLIC` or `members: { some: { userId } }`.
   *
   * Returns an array because a scope may need more than one independent
   * predicate — e.g. a future Blogs public scope needs both
   * `visibility: PUBLIC` AND `status: PUBLISHED`.
   */
  readonly guard: (context: TContext) => readonly TWhere[];

  /**
   * Filter keys this scope's `guard` already constrains, e.g. `["visibility"]`.
   *
   * `defineSearch` (see `engine.ts`) rejects a registry where a filter's
   * key appears here — this is the mechanised version of "visibility is a
   * scope, not a filter": the vocabulary to request it does not exist. It
   * is a naming-convention check (it compares filter *keys* against this
   * list, not the actual Prisma columns `toWhere` touches), but it is
   * exactly the check that would have caught the Projects defect, where
   * the filter and the guarded column shared the name `visibility`.
   */
  readonly guardedKeys?: readonly string[];

  /**
   * When non-empty, documents (and lets tooling grep for) the platform
   * permission the caller is expected to already have checked before
   * reaching this scope. The engine does not enforce it — this scope's
   * `guard` may legitimately be empty (e.g. an admin scope with no
   * additional predicate), and authorization stays the caller's
   * responsibility, same as it is today for admin competition search.
   */
  readonly requiresPlatformAction?: string;
}

export class UnknownScopeError extends Error {
  constructor(scopeId: string, entity: string) {
    super(`Unknown search scope "${scopeId}" for entity "${entity}".`);
    this.name = "UnknownScopeError";
  }
}

/**
 * Filters `filterKeys` down to those a scope permits, silently dropping
 * the rest — this is invariant 2 above.
 */
export function filterKeysForScope<TWhere, TContext>(
  scope: SearchScope<TWhere, TContext>,
  filterKeys: readonly string[],
): readonly string[] {
  if (scope.allowedFilters === "all") {
    return filterKeys;
  }

  const allowed = scope.allowedFilters;

  return filterKeys.filter((key) => allowed.has(key));
}

/**
 * Builds a scope whose registry has been validated (see
 * `assertNoGuardedFilterOverlap` in `engine.ts`) to guarantee no filter in
 * `allowedFilters` can touch a column the guard also constrains.
 */
export function defineScope<TWhere extends AndComposable<TWhere>, TContext>(
  scope: SearchScope<TWhere, TContext>,
): SearchScope<TWhere, TContext> {
  return scope;
}
