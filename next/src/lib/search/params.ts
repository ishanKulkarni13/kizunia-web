/**
 * Search Core - URL parameter primitives (CLIENT-SAFE)
 *
 * =============================================================================
 * Why this module exists
 * =============================================================================
 *
 * The applied search state lives in the URL. Every surface that reads or
 * writes it — a server-rendered pagination link, a client filter control, a
 * saved search, a canonical redirect — must agree exactly on how parameters
 * are named, encoded and merged, or the same logical search will produce two
 * different URLs and the two will diverge in subtle ways.
 *
 * Concretely, the defect this module prevents: a pagination link built by
 * string concatenation as `?page=2` silently discards every filter the user
 * applied. That is not a hypothetical — it is what the listing page did before
 * this layer existed. The fix is not to remember to append the other
 * parameters at each link site; it is to make "produce a URL for a modified
 * search" a single function that cannot forget them.
 *
 * =============================================================================
 * Guarantees
 * =============================================================================
 *
 * 1. Merging is additive over the current parameters. A patch names only what
 *    changes; everything unnamed survives, including parameters this codebase
 *    does not own (analytics tags, referral markers).
 * 2. `undefined` in a patch removes a parameter. This is the only removal
 *    mechanism, so "clear this filter" and "set this filter" are the same
 *    operation with different values.
 * 3. Output is canonical: keys sorted, repeated values collapsed to the
 *    comma-separated form the decoders expect. Two equivalent searches
 *    therefore serialise identically, which is what will later let a saved
 *    search be compared and de-duplicated by string equality.
 * 4. Changing the result set resets pagination. Page 7 of the previous result
 *    set is meaningless against a new one, and leaving it in place strands the
 *    user on an empty page.
 */

import type { RawSearchParams } from "./types";

// =============================================================================
// Reserved parameter names
// =============================================================================

/**
 * Parameters owned by the engine rather than by any filter.
 *
 * Declared here — the lowest, client-safe layer — rather than inside the
 * engine, so the pagination control, the sort control, the query builder and
 * the registry validator all read the same constants instead of repeating
 * three string literals apiece.
 */
export const PAGE_PARAM = "page";
export const LIMIT_PARAM = "limit";
export const SORT_PARAM = "sort";

/**
 * Which preset the current search was started from.
 *
 * Carries no filtering meaning whatsoever — the engine ignores it, exactly as
 * it ignores any parameter no filter owns. It records *provenance*: that this
 * search began from a named preset, so the interface can keep showing which
 * one while the person refines it.
 *
 * It lives in the URL rather than in client state because everything else
 * about the applied search does. A marker held only in memory would survive a
 * filter change but not a refresh, a shared link or the back button, and the
 * preset shown as active would then disagree with the filters on screen for
 * reasons the user cannot see. See `presets.ts`.
 */
export const PRESET_PARAM = "preset";

/**
 * Every parameter owned by the search subsystem rather than by a filter.
 * `defineSearch` rejects any filter that claims one of these, so a filter can
 * never shadow pagination, sorting, or the preset marker.
 */
export const RESERVED_PARAMS: ReadonlySet<string> = new Set([
  PAGE_PARAM,
  LIMIT_PARAM,
  SORT_PARAM,
  PRESET_PARAM,
]);

// =============================================================================
// Patches
// =============================================================================

/**
 * A set of parameter changes.
 *
 * A key mapped to a string sets that parameter; a key mapped to `undefined`
 * removes it. Keys absent from the patch are left untouched.
 */
export type ParamPatch = Readonly<Record<string, string | undefined>>;

export interface ApplyPatchOptions {
  /**
   * Reset pagination to the first page.
   *
   * Should be `true` for anything that alters which rows match — a filter, a
   * sort, a page-size change — and `false` only for navigation *within* an
   * unchanged result set.
   *
   * Deliberately explicit rather than inferred from the patch's keys.
   * Inferring it would be right most of the time and wrong exactly when a
   * caller does something unanticipated, which is the worst failure mode for
   * a rule about correctness.
   */
  readonly resetPage?: boolean;
}

/**
 * Flattens one raw parameter value into its canonical string form.
 *
 * Next.js delivers a repeated parameter (`?modes=A&modes=B`) as an array. The
 * decoders accept both that and the comma-separated form, but only one of the
 * two can be canonical — and comma is the one every `encode` already emits,
 * and the one that survives `Object.fromEntries` on the API routes without
 * losing values.
 */
function canonicalValue(value: string | string[] | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const flattened = Array.isArray(value) ? value.join(",") : value;

  const trimmed = flattened.trim();

  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Merges a patch into the current parameters, producing a canonical,
 * serialisable parameter map.
 *
 * Keys are sorted so that two equivalent searches always produce byte-identical
 * output regardless of the order in which their filters were applied.
 */
export function applyParamPatch(
  current: RawSearchParams,
  patch: ParamPatch = {},
  options: ApplyPatchOptions = {},
): Record<string, string> {
  const merged = new Map<string, string>();

  for (const [key, raw] of Object.entries(current)) {
    const value = canonicalValue(raw);

    if (value !== undefined) {
      merged.set(key, value);
    }
  }

  for (const [key, raw] of Object.entries(patch)) {
    const value = canonicalValue(raw);

    if (value === undefined) {
      merged.delete(key);
      continue;
    }

    merged.set(key, value);
  }

  if (options.resetPage) {
    merged.delete(PAGE_PARAM);
  }

  return Object.fromEntries(
    [...merged.entries()].sort(([a], [b]) => a.localeCompare(b)),
  );
}

/**
 * Serialises parameters into a query string, without the leading `?`.
 *
 * Returns an empty string when there is nothing to encode, so a caller can
 * build a clean path with no trailing punctuation.
 */
export function toQueryString(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

/**
 * Builds an href for a modified search.
 *
 * This is the function every link that changes the search must go through —
 * pagination, sort, a chip's remove action, Clear all. Nothing else should
 * concatenate a query string by hand.
 */
export function buildSearchHref(
  pathname: string,
  current: RawSearchParams,
  patch: ParamPatch = {},
  options: ApplyPatchOptions = {},
): string {
  const query = toQueryString(applyParamPatch(current, patch, options));

  return query.length > 0 ? `${pathname}?${query}` : pathname;
}

// =============================================================================
// Pagination
// =============================================================================

/**
 * The patch that moves to a given page.
 *
 * Page 1 is expressed by *removing* the parameter rather than setting it to
 * "1", so the first page of a search has exactly one URL. Two URLs for one
 * view would split analytics, weaken caching and make saved-search equality
 * unreliable.
 */
export function pagePatch(page: number): ParamPatch {
  return { [PAGE_PARAM]: page <= 1 ? undefined : String(page) };
}

/**
 * An href for a page of the *current* search.
 *
 * `resetPage` is deliberately not applied: this is navigation within an
 * unchanged result set, which is the one case where the existing page value
 * is not stale.
 */
export function pageHref(
  pathname: string,
  current: RawSearchParams,
  page: number,
): string {
  return buildSearchHref(pathname, current, pagePatch(page));
}

// =============================================================================
// Sorting
// =============================================================================

/**
 * The patch that applies a sort.
 *
 * Passing the registry's default key removes the parameter, for the same
 * one-URL-per-view reason as page 1. Callers that do not know the default may
 * omit it; the parameter is then always written.
 */
export function sortPatch(
  sortKey: string,
  defaultSortKey?: string,
): ParamPatch {
  return {
    [SORT_PARAM]: sortKey === defaultSortKey ? undefined : sortKey,
  };
}

/** Reads the active sort token, tolerating a repeated parameter. */
export function readSortToken(params: RawSearchParams): string | undefined {
  return canonicalValue(params[SORT_PARAM]);
}

// =============================================================================
// Comparison
// =============================================================================

/**
 * Whether two parameter sets describe the same search.
 *
 * Compares canonical forms, so `?modes=A,B` and `?modes=B&modes=A&page=1` are
 * recognised as equal despite differing textually. This is the primitive a
 * saved-search feature will compare against, and the reason canonicalisation
 * is done here rather than at each call site.
 *
 * Pagination is excluded: page 3 of a search is the same search.
 */
export function isSameSearch(
  a: RawSearchParams,
  b: RawSearchParams,
): boolean {
  const normalize = (params: RawSearchParams): string => {
    const applied = applyParamPatch(params, { [PAGE_PARAM]: undefined });

    return toQueryString(applied);
  };

  return normalize(a) === normalize(b);
}
