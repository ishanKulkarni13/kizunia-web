/**
 * Search Core - Free-text filter primitives
 *
 * All values are LIKE-escaped before reaching a clause. Prisma does not escape
 * `%` or `_`, so without this a search for "50%" matches every row — verified
 * against the live database, not assumed.
 *
 * Escaping happens here rather than during decoding so the canonical URL and
 * the text shown in the input keep the user's literal input. Only the clause
 * sees the escaped form.
 */

import { escapeLikeWildcards } from "../guards";
import type { TextAnySpec, TextSpec } from "../spec";
import type { FilterDescriptor } from "../types";

/** Case-insensitive `contains` against a single column. */
export function textFilter<TWhere>(config: {
  spec: TextSpec;
  toWhere: (value: string) => TWhere;
}): FilterDescriptor<TWhere, TextSpec> {
  return {
    spec: config.spec,

    toWhere: (value) => config.toWhere(escapeLikeWildcards(value)),
  };
}

/**
 * Case-insensitive `contains` across several columns, OR-ed together.
 *
 * Behaviourally identical to `textFilter` — the caller's `toWhere` is what
 * spans several columns. It exists as a distinct, named export because this
 * is the documented swap point for Postgres full-text search, and grepping
 * for it should find every call site that will need revisiting when a
 * `tsvector` column lands.
 */
export function multiFieldTextFilter<TWhere>(config: {
  spec: TextSpec;
  toWhere: (value: string) => TWhere;
}): FilterDescriptor<TWhere, TextSpec> {
  return textFilter(config);
}

/**
 * Multi-value free text, OR-ed as a set of `contains` predicates — used where
 * `in` cannot apply because the match is a substring.
 *
 * Known limitation: values are comma-separated, so a value legitimately
 * containing a comma ("Acme, Inc") splits into two tokens and matches more
 * broadly than intended. Acceptable for a substring filter, where the two
 * fragments still match the original string; it would not be acceptable for
 * an exact-match filter, and this primitive should not be reused for one.
 */
export function textAnyFilter<TWhere>(config: {
  spec: TextAnySpec;
  toWhere: (values: string[]) => TWhere;
}): FilterDescriptor<TWhere, TextAnySpec> {
  return {
    spec: config.spec,

    toWhere: (values) => config.toWhere(values.map(escapeLikeWildcards)),
  };
}
