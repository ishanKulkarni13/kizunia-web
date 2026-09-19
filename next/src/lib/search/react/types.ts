"use client";

/**
 * Search Core (React) - Shared presentation inputs
 *
 * Option lists and result counts are resolved by the page, on the server, and
 * threaded down to whichever control needs them.
 *
 * Keyed by filter key so one object serves every control, and so a filter with
 * no dynamic options simply has no entry rather than needing a placeholder.
 */

import type { FilterOption } from "../spec";

/** Options for relation-backed filters, keyed by filter key. */
export type FilterOptionsMap = Readonly<
  Record<string, readonly FilterOption[]>
>;

/**
 * Result counts, keyed by filter key and then by option value.
 *
 * Counted under the same visibility rules the search itself applies, so a
 * count shown next to an option is a count the person will actually get. An
 * option advertising a number and then returning fewer results reads as a bug
 * in search rather than as a difference in visibility rules.
 */
export type FilterCountsMap = Readonly<
  Record<string, Readonly<Record<string, number>>>
>;
