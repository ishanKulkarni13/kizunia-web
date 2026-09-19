/**
 * Search Core - Numeric and date range primitives
 *
 * A date range is the reason a filter owns a *set* of parameters rather than
 * a single one: `<key>From` and `<key>To` belong to one filter, so neither can
 * be set, cleared or canonicalised while forgetting the other.
 */

import type { DateRangeSpec, NumberBoundSpec } from "../spec";
import type { FilterDescriptor } from "../types";

/** A one-sided numeric bound, e.g. `minTeamSize=4`. */
export function numberBoundFilter<TWhere>(config: {
  spec: NumberBoundSpec;
  toWhere: (value: number) => TWhere;
}): FilterDescriptor<TWhere, NumberBoundSpec> {
  return {
    spec: config.spec,

    toWhere: config.toWhere,
  };
}

/** A date range resolved to real boundaries, ready for a Prisma comparison. */
export interface ResolvedDateRange {
  readonly from?: Date;
  readonly to?: Date;
}

/** Matches a bare calendar date with no time component. */
const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Converts one ISO boundary string into an instant.
 *
 * =============================================================================
 * Inclusive upper bound
 * =============================================================================
 *
 * A bare `2026-01-31` parses to midnight at the *start* of the 31st. Used
 * directly as a `lte`, that would exclude almost the entire day the user
 * selected — "up to 31 January" would silently mean "up to 30 January". The
 * upper boundary is therefore pushed to the end of the named day, so a range
 * covers both of its endpoints, which is what a date picker's two handles
 * visibly promise.
 *
 * A value that carries an explicit time is left exactly as given: the caller
 * has been precise, and widening it would override an intent that was clearly
 * expressed.
 *
 * =============================================================================
 * Timezone — a deliberate, deferred decision
 * =============================================================================
 *
 * A bare date is currently interpreted as UTC, because that is what `Date`
 * does with it. For an audience in IST this shifts a boundary by 5h30m, so a
 * competition starting late on the 31st local time falls outside a range that
 * named the 31st.
 *
 * That is a product decision (which zone: the viewer's, the competition's, or
 * a fixed platform zone?) and it is deliberately not being made here. What is
 * being done here is confining it: this function is the only place a date
 * string becomes an instant, so applying that decision later is a change to
 * one function rather than a hunt through every date filter.
 */
function parseBoundary(
  iso: string,
  edge: "lower" | "upper",
): Date | undefined {
  const parsed = new Date(iso);

  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  if (edge === "upper" && BARE_DATE.test(iso)) {
    return new Date(parsed.getTime() + 24 * 60 * 60 * 1000 - 1);
  }

  return parsed;
}

/**
 * A two-key date range owning `<key>From` and `<key>To`.
 *
 * An inverted range (from later than to) is passed through unchanged and
 * yields no results, which is logically honest. The date control is
 * responsible for making one hard to construct; the query layer does not
 * quietly reinterpret what it was given.
 */
export function dateRangeFilter<TWhere>(config: {
  spec: DateRangeSpec;
  toWhere: (range: ResolvedDateRange) => TWhere;
}): FilterDescriptor<TWhere, DateRangeSpec> {
  return {
    spec: config.spec,

    toWhere: (value) => {
      const from = value.from ? parseBoundary(value.from, "lower") : undefined;
      const to = value.to ? parseBoundary(value.to, "upper") : undefined;

      return config.toWhere({ from, to });
    },
  };
}
