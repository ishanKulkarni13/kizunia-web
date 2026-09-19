/**
 * Search Core - Reading and writing filter values (CLIENT-SAFE)
 *
 * =============================================================================
 * Role
 * =============================================================================
 *
 * Everything a filter control needs in order to work, without knowing which
 * filter it is rendering: read the current value out of the URL, write a new
 * one back, report whether the filter is active, and describe its active
 * values as removable chips.
 *
 * Every function here is pure and total. Given a malformed URL they return
 * "no value" rather than throwing — a shared or hand-edited link must render
 * a usable page, never an error boundary.
 *
 * =============================================================================
 * Relationship to the server decoders
 * =============================================================================
 *
 * The server registry decodes the same parameters independently, in
 * `filters/*.ts`. That duplication is intentional and bounded: the server
 * decoder produces a Prisma clause and must run where Prisma exists, while
 * this one produces a value a React control can bind to and must run in the
 * browser.
 *
 * What keeps them consistent is that both are driven by the same `FilterSpec`
 * and both funnel through the same normalisation guards, so the *set of
 * accepted inputs* is defined once. A value this module reads is always a
 * value the server would have decoded identically, and a value it writes is
 * always one the server can read back. The round-trip property is asserted by
 * the search invariant suite rather than left to inspection.
 */

import {
  normalizeInteger,
  normalizeList,
  normalizeScalar,
} from "./guards";
import { PAGE_PARAM, PRESET_PARAM, type ParamPatch } from "./params";
import {
  filterParams,
  type AnyFilterValue,
  type DateRangeValue,
  type FilterOption,
  type FilterSpec,
  type PlaceValue,
  type TeamEntryFormat,
  type TeamSizePolicy,
  type TeamSizeValue,
  type ValueOfSpec,
} from "./spec";
import type { RawSearchParams } from "./types";

// =============================================================================
// Reading
// =============================================================================

/**
 * Validates an ISO date string without converting it to a `Date`.
 *
 * The value stays a string throughout the client layer: converting to `Date`
 * and back would silently reinterpret a bare `2026-01-01` in the viewer's
 * timezone, so a range set in one place would mean something different when
 * the link was opened in another.
 */
function readIsoDate(raw: string | string[] | undefined): string | undefined {
  const value = normalizeScalar(raw);

  if (value === undefined) {
    return undefined;
  }

  return Number.isNaN(new Date(value).getTime()) ? undefined : value;
}

function readDateRange(
  params: RawSearchParams,
  spec: FilterSpec,
): DateRangeValue | undefined {
  const [fromKey, toKey] = filterParams(spec);

  const from = fromKey ? readIsoDate(params[fromKey]) : undefined;
  const to = toKey ? readIsoDate(params[toKey]) : undefined;

  if (from === undefined && to === undefined) {
    return undefined;
  }

  return { from, to };
}

/**
 * Reads one half of a device coordinate.
 *
 * Deliberately not `normalizeInteger` — a coordinate is fractional. Rejects
 * anything non-finite or outside the valid range, so a hand-edited
 * `?lat=999` simply has no centre rather than placing a search somewhere
 * impossible.
 */
function readCoordinate(
  raw: string | string[] | undefined,
  limit: number,
): number | undefined {
  const value = normalizeScalar(raw);

  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < -limit || parsed > limit) {
    return undefined;
  }

  return parsed;
}

/**
 * Reads and bounds the radius.
 *
 * Two different failure modes, deliberately handled differently:
 *
 *   - **Invalid** (`0`, `-5`, `2.5`, `abc`, `NaN`, `Infinity`) is dropped, so
 *     the filter behaves as though no radius were given. That is this
 *     codebase's standing policy for a stale or hand-edited URL: degrade to
 *     something sane rather than render an error page.
 *   - **Too large** is *clamped*, not dropped. Dropping it would silently
 *     narrow a search the user was explicitly trying to widen — the one
 *     direction this must never fail in.
 *
 * Clamping lives here, in the decoder, rather than in the control, because the
 * control is only one of five writers: a preset restored from `localStorage`, a
 * hand-edited URL, a shared link and the API all reach this function too, and
 * only this function is on every one of those paths.
 */
function readRadiusKm(
  params: RawSearchParams,
  spec: Extract<FilterSpec, { kind: "place" }>,
): number | undefined {
  if (!spec.radius) {
    return undefined;
  }

  const requested = normalizeInteger(params[spec.radius.radiusParam]);

  if (requested === undefined) {
    return undefined;
  }

  return Math.min(requested, spec.radius.maxKm);
}

function readPlace(
  params: RawSearchParams,
  spec: Extract<FilterSpec, { kind: "place" }>,
): PlaceValue | undefined {
  const radiusKm = readRadiusKm(params, spec);

  const includeOnline =
    normalizeScalar(params[spec.includeOnlineParam])?.toLowerCase() === "true";

  const id = normalizeScalar(params[spec.idParam]);

  // A selected place takes precedence over a device position. Both can appear
  // together in a stale URL — someone picks a city after having used "near me"
  // — and one of them has to win deterministically, because a radius has
  // exactly one centre. Preferring the place is the honest choice: it is the
  // one the user named, and it is the one that renders as a readable chip.
  if (id !== undefined) {
    return {
      center: {
        kind: "place",
        id,
        label: normalizeScalar(params[spec.labelParam]),
      },

      includeOnline,

      ...(radiusKm !== undefined && { radiusKm }),
    };
  }

  // A device centre has no identity, so it can only ever mean "within X of
  // here". Without a radius there is nothing to ask, which is why — unlike a
  // place — it is not a filter on its own.
  if (spec.radius && radiusKm !== undefined) {
    const latitude = readCoordinate(params[spec.radius.latitudeParam], 90);

    const longitude = readCoordinate(params[spec.radius.longitudeParam], 180);

    if (latitude !== undefined && longitude !== undefined) {
      return {
        center: { kind: "device", latitude, longitude },
        includeOnline,
        radiusKm,
      };
    }
  }

  // No centre means no location filter, regardless of the other parameters. A
  // stray `includeOnline=true`, or a radius with nothing to centre it on, must
  // not become a filter the user never asked for.
  return undefined;
}

const TEAM_SIZE_POLICIES: ReadonlySet<string> = new Set<TeamSizePolicy>([
  "SOLO_ONLY",
  "SOLO_OR_TEAM",
]);

const TEAM_ENTRY_FORMATS: ReadonlySet<string> = new Set<TeamEntryFormat>([
  "SOLO",
  "TEAM",
  "EITHER",
]);

/**
 * Reads a participant's team-size intent, a competition's solo policy, and
 * which of the two the participant's own entry format leaves in play —
 * then normalizes away any combination the three together make contradictory.
 *
 * `min` and `max` are read independently — neither implies the other — which
 * is what lets one pair of parameters express an exact size, a range, or a
 * one-sided bound. See `TeamSizeSpec` for how each combination is meant to be
 * read, and `TeamEntryFormat` for why the normalization below exists: a
 * hand-edited or stale-bookmarked URL can name a size and a policy that
 * cannot both be satisfied, and this is the one place both the interactive
 * control and the query builder decode from — so fixing it here fixes it in
 * both places at once, exactly as the URL round-trip contract in this
 * module's header comment promises.
 */
function readTeamSize(
  params: RawSearchParams,
  spec: Extract<FilterSpec, { kind: "team-size" }>,
): TeamSizeValue | undefined {
  let min = normalizeInteger(params[spec.minParam]);
  let max = normalizeInteger(params[spec.maxParam]);

  // A hand-edited or reordered URL can carry bounds in the wrong order.
  // Swapping keeps the range well-formed without discarding what was set —
  // dropping one side would silently turn a range into a one-sided bound.
  if (min !== undefined && max !== undefined && min > max) {
    [min, max] = [max, min];
  }

  // A lone `min` with no `max` was "At least", which this filter no longer
  // offers — Exact, Range and At most all either set both bounds or set only
  // `max`. A stale bookmark or a hand-edited URL carrying just `min` degrades
  // to no size filter rather than resurrecting one-sided behaviour.
  if (min !== undefined && max === undefined) {
    min = undefined;
  }

  const policyRaw = normalizeScalar(params[spec.policyParam]);

  let policy =
    policyRaw !== undefined && TEAM_SIZE_POLICIES.has(policyRaw)
      ? (policyRaw as TeamSizePolicy)
      : undefined;

  const entryFormatRaw = normalizeScalar(params[spec.entryFormatParam]);

  const entryFormat =
    entryFormatRaw !== undefined && TEAM_ENTRY_FORMATS.has(entryFormatRaw)
      ? (entryFormatRaw as TeamEntryFormat)
      : undefined;

  // A solo entrant has no team size to state, regardless of what a stale or
  // hand-edited URL claims.
  if (entryFormat === "SOLO") {
    min = undefined;
    max = undefined;
  }

  // A team entrant can never be satisfied by a strictly-solo competition —
  // "Solo & team" is the only policy value compatible with requiring a team.
  if (entryFormat === "TEAM") {
    policy = "SOLO_OR_TEAM";
  }

  // A real team size (more than a lone person) can never be satisfied by a
  // strictly-solo competition either, independent of entry format — the two
  // together would match nothing. The size is the more specific request, so
  // the now-contradictory policy is what gives way.
  if (policy === "SOLO_ONLY" && max !== undefined && max > 1) {
    policy = undefined;
  }

  if (
    min === undefined &&
    max === undefined &&
    policy === undefined &&
    entryFormat === undefined
  ) {
    return undefined;
  }

  return { min, max, policy, entryFormat };
}

/**
 * Internal, untyped read. One branch per kind.
 *
 * The public `readFilterValue` narrows this result against the spec's kind.
 */
function readAny(
  spec: FilterSpec,
  params: RawSearchParams,
): AnyFilterValue | undefined {
  switch (spec.kind) {
    case "enum-multi": {
      const values = normalizeList(params[spec.key], { case: "upper" });

      if (!values) {
        return undefined;
      }

      // Values outside the declared option set are dropped rather than
      // rendered. A removed enum member lingering in an old bookmark should
      // narrow to what still exists, not display a checkbox for a value the
      // server will ignore.
      const allowed = new Set(spec.options.map((option) => option.value));

      const kept = values.filter((value) => allowed.has(value));

      return kept.length > 0 ? kept : undefined;
    }

    case "relation-multi":
      // Not validated against an option list: taxonomies are open sets loaded
      // separately, and a slug this page has not loaded options for is still a
      // legitimate filter the server will honour.
      return normalizeList(params[spec.key], { case: "lower" });

    case "text-any":
      return normalizeList(params[spec.key]);

    case "text":
      return normalizeScalar(params[spec.key]);

    case "number-bound": {
      const value = normalizeInteger(params[spec.key]);

      if (value === undefined) {
        return undefined;
      }

      if (spec.min !== undefined && value < spec.min) return undefined;
      if (spec.max !== undefined && value > spec.max) return undefined;

      return value;
    }

    case "date-range":
      return readDateRange(params, spec);

    case "boolean":
      return normalizeScalar(params[spec.key])?.toLowerCase() === "true"
        ? true
        : undefined;

    case "place":
      return readPlace(params, spec);

    case "team-size":
      return readTeamSize(params, spec);
  }
}

/**
 * Reads one filter's value out of the current parameters.
 *
 * Returns `undefined` when the filter is absent, empty, or carries a value
 * this spec cannot accept.
 *
 * The single cast below is the boundary between the switch above — which
 * TypeScript cannot correlate with the generic — and the `FilterValueOf`
 * mapping that makes every call site type-safe. It is confined to this one
 * function precisely so no control component needs one.
 */
export function readFilterValue<TSpec extends FilterSpec>(
  spec: TSpec,
  params: RawSearchParams,
): ValueOfSpec<TSpec> | undefined {
  return readAny(spec, params) as ValueOfSpec<TSpec> | undefined;
}

/** Whether a filter currently contributes anything to the search. */
export function isFilterActive(
  spec: FilterSpec,
  params: RawSearchParams,
): boolean {
  return readAny(spec, params) !== undefined;
}

/** How many of `specs` are active. Drives the "Filters (3)" badge. */
export function activeFilterCount(
  specs: readonly FilterSpec[],
  params: RawSearchParams,
): number {
  return specs.reduce(
    (total, spec) => (isFilterActive(spec, params) ? total + 1 : total),
    0,
  );
}

// =============================================================================
// Writing
// =============================================================================

/**
 * Builds the patch that sets a filter to `value`, or clears it when `value`
 * is `undefined`.
 *
 * Always names *every* parameter the filter owns, setting the unused ones to
 * `undefined`. That is what stops a partial write from stranding a parameter:
 * clearing a date range must remove both bounds, and clearing a place must
 * remove its label and its online toggle too, or the URL keeps fragments of a
 * filter that is no longer applied.
 */
export function writeFilterValue<TSpec extends FilterSpec>(
  spec: TSpec,
  value: ValueOfSpec<TSpec> | undefined,
): ParamPatch {
  const cleared = clearFilterPatch(spec);

  if (value === undefined) {
    return cleared;
  }

  switch (spec.kind) {
    case "enum-multi":
    case "relation-multi":
    case "text-any": {
      const values = value as readonly string[];

      return {
        ...cleared,
        [spec.key]: values.length > 0 ? values.join(",") : undefined,
      };
    }

    case "text": {
      const text = (value as string).trim();

      return { ...cleared, [spec.key]: text.length > 0 ? text : undefined };
    }

    case "number-bound":
      return { ...cleared, [spec.key]: String(value as number) };

    case "date-range": {
      const range = value as DateRangeValue;
      const [fromKey, toKey] = filterParams(spec);

      // An empty range is a cleared range, not a range with no bounds.
      if (!range.from && !range.to) {
        return cleared;
      }

      return {
        ...cleared,
        ...(fromKey ? { [fromKey]: range.from } : {}),
        ...(toKey ? { [toKey]: range.to } : {}),
      };
    }

    case "boolean":
      return { ...cleared, [spec.key]: "true" };

    case "place": {
      const place = value as PlaceValue;

      // Exactly one centre reaches the URL. `cleared` already names every
      // parameter this filter owns, so the unused centre's parameters are
      // removed rather than left behind — switching from "near me" to a chosen
      // city cannot strand a stale coordinate that would outlive its chip.
      const center =
        place.center.kind === "place"
          ? {
              [spec.idParam]: place.center.id,
              [spec.labelParam]: place.center.label,
            }
          : {
              [spec.radius!.latitudeParam]: String(place.center.latitude),
              [spec.radius!.longitudeParam]: String(place.center.longitude),
            };

      return {
        ...cleared,
        ...center,
        // Written only when true: `false` is the default, and encoding a
        // default produces a second URL for one view.
        [spec.includeOnlineParam]: place.includeOnline ? "true" : undefined,
        ...(spec.radius && {
          [spec.radius.radiusParam]:
            place.radiusKm !== undefined ? String(place.radiusKm) : undefined,
        }),
      };
    }

    case "team-size": {
      const teamSize = value as TeamSizeValue;

      return {
        ...cleared,
        [spec.minParam]:
          teamSize.min !== undefined ? String(teamSize.min) : undefined,
        [spec.maxParam]:
          teamSize.max !== undefined ? String(teamSize.max) : undefined,
        [spec.policyParam]: teamSize.policy,
        [spec.entryFormatParam]: teamSize.entryFormat,
      };
    }
  }
}

/** The patch that removes every parameter a filter owns. */
export function clearFilterPatch(spec: FilterSpec): ParamPatch {
  const patch: Record<string, undefined> = {};

  for (const param of filterParams(spec)) {
    patch[param] = undefined;
  }

  return patch;
}

/**
 * The patch that clears every registered filter.
 *
 * Only removes parameters the registry actually owns, so an unrelated query
 * parameter — a campaign tag, a referrer — survives a Clear all.
 *
 * Pagination goes with them, in the patch itself rather than by asking callers
 * to pass `resetPage`. Page 3 of a filtered list is not a page of the
 * unfiltered one, and the two server-rendered "Clear filters" links build their
 * hrefs through `buildSearchHref`, which has no `resetPage` unless it is told —
 * so leaving it to the caller meant those two links cleared the filters and
 * left the reader stranded on page 3 of the result. Removing it here is the
 * canonical page 1 that `pagePatch` also produces: no parameter at all, one URL
 * per view.
 *
 * The preset marker goes too. A preset is the starting point a search was built
 * from, so a search with nothing left in it was not started from anywhere —
 * leaving a preset highlighted over an empty filter set would claim a
 * provenance that no longer has any effect on screen.
 *
 * Doing both here rather than at each Clear all means every existing site — the
 * always-available clear control, the sheet footer, the empty-state link, the
 * error-state link — inherits the behaviour without being edited, and a future
 * one cannot forget it.
 */
export function clearAllFiltersPatch(
  specs: readonly FilterSpec[],
): ParamPatch {
  const patch: Record<string, undefined> = {
    [PRESET_PARAM]: undefined,
    [PAGE_PARAM]: undefined,
  };

  for (const spec of specs) {
    for (const param of filterParams(spec)) {
      patch[param] = undefined;
    }
  }

  return patch;
}

// =============================================================================
// Chips
// =============================================================================

/**
 * One removable token in the active-filter bar.
 *
 * Chips are per *value*, not per filter: a user who selected three categories
 * gets three chips and can drop one without losing the others. A per-filter
 * chip would make removing one value a two-step trip back into the picker.
 */
export interface FilterChip {
  /** Stable across renders; suitable as a React key. */
  readonly id: string;

  readonly filterKey: string;

  /** The filter's name, e.g. "Mode". Used for grouping and screen readers. */
  readonly filterLabel: string;

  /** The value's own label, e.g. "Online". */
  readonly label: string;

  /** The patch that removes exactly this chip and nothing else. */
  readonly remove: ParamPatch;
}

export interface ChipContext {
  /**
   * Labels for relation options, keyed by filter key and then by value.
   *
   * Supplied by the page, which has already loaded the taxonomy in order to
   * render the pickers. Without it a category chip would read "ai" instead of
   * "Artificial Intelligence"; with it, no extra request is needed.
   */
  readonly optionLabels?: Readonly<
    Record<string, Readonly<Record<string, string>>>
  >;

  /**
   * Formats an ISO date for display.
   *
   * Injected rather than chosen here so the caller controls locale, and so
   * server and client render byte-identical text. Calling `toLocaleDateString`
   * inside this module would produce a hydration mismatch whenever the server
   * and the browser disagree about locale or timezone.
   */
  readonly formatDate?: (iso: string) => string;
}

/** Deterministic, locale-free fallback: the date part of the ISO string. */
function defaultFormatDate(iso: string): string {
  return iso.slice(0, 10);
}

function labelForValue(
  spec: FilterSpec,
  value: string,
  context: ChipContext,
): string {
  if (spec.kind === "enum-multi") {
    return (
      spec.options.find((option: FilterOption) => option.value === value)
        ?.label ?? value
    );
  }

  return context.optionLabels?.[spec.key]?.[value] ?? value;
}

function withPrefix(spec: FilterSpec, label: string): string {
  return spec.chipPrefix ? `${spec.chipPrefix} ${label}` : label;
}

/**
 * The size half of a team-size chip: "Solo", "Team of 4", "3–5 people", "At
 * least 3", "At most 4" — one label per shape `min`/`max` can take.
 */
function teamSizeLabel(
  value: TeamSizeValue,
  spec: Extract<FilterSpec, { kind: "team-size" }>,
): string {
  const unit = (count: number) =>
    count === 1 && spec.unitOne ? spec.unitOne : spec.unit;

  const withUnit = (text: string, count: number) => {
    const suffix = unit(count);

    return suffix ? `${text} ${suffix}` : text;
  };

  if (value.min !== undefined && value.max !== undefined) {
    if (value.min === value.max) {
      return value.min === 1 ? "Solo" : withUnit(`Team of ${value.min}`, value.min);
    }

    return withUnit(`${value.min}–${value.max}`, value.max);
  }

  // `min` alone (the old "At least") is normalized away in `readTeamSize`,
  // so `max` is guaranteed set whenever this branch is reached at all.
  return withUnit(`At most ${value.max}`, value.max as number);
}

/**
 * Describes one filter's active values as chips.
 *
 * Returns an empty array when the filter is inactive, so a caller can flat-map
 * across every spec without branching.
 */
export function describeFilterChips(
  spec: FilterSpec,
  params: RawSearchParams,
  context: ChipContext = {},
): readonly FilterChip[] {
  const value = readAny(spec, params);

  if (value === undefined) {
    return [];
  }

  const base = {
    filterKey: spec.key,
    filterLabel: spec.label,
  } as const;

  switch (spec.kind) {
    case "enum-multi":
    case "relation-multi":
    case "text-any": {
      const values = value as readonly string[];

      return values.map((entry) => ({
        ...base,
        id: `${spec.key}:${entry}`,
        label: withPrefix(spec, labelForValue(spec, entry, context)),

        // Removing one value rewrites the parameter with the rest, rather
        // than clearing the filter outright.
        remove: writeFilterValue(
          spec,
          values.filter(
            (candidate) => candidate !== entry,
          ) as ValueOfSpec<typeof spec>,
        ),
      }));
    }

    case "text":
      return [
        {
          ...base,
          id: spec.key,
          label: withPrefix(spec, `“${value as string}”`),
          remove: clearFilterPatch(spec),
        },
      ];

    case "number-bound": {
      const unit = spec.unit ? ` ${spec.unit}` : "";

      return [
        {
          ...base,
          id: spec.key,
          label: withPrefix(spec, `${value as number}${unit}`),
          remove: clearFilterPatch(spec),
        },
      ];
    }

    case "date-range": {
      const range = value as DateRangeValue;
      const format = context.formatDate ?? defaultFormatDate;

      const text =
        range.from && range.to
          ? `${format(range.from)} – ${format(range.to)}`
          : range.from
            ? `from ${format(range.from)}`
            : `until ${format(range.to as string)}`;

      return [
        {
          ...base,
          id: spec.key,
          label: withPrefix(spec, text),
          remove: clearFilterPatch(spec),
        },
      ];
    }

    case "boolean":
      return [
        {
          ...base,
          id: spec.key,
          label: spec.label,
          remove: clearFilterPatch(spec),
        },
      ];

    case "place": {
      const place = value as PlaceValue;

      const chips: FilterChip[] = [
        {
          ...base,
          id: spec.idParam,
          label: withPrefix(
            spec,
            place.center.kind === "device"
              ? // Never the raw coordinates. They are unreadable, they are the
                // person's position, and they are not what they asked for —
                // they asked to search near themselves.
                "Near me"
              : // A URL that lost its label still produces a usable, removable chip.
                (place.center.label ?? "Selected place"),
          ),
          remove: clearFilterPatch(spec),
        },
      ];

      // Separately removable, for the same reason the online toggle is:
      // narrowing "Pune within 25 km" back to "Pune" should not require
      // clearing the place and picking it again.
      //
      // Not offered for a device centre, because removing the radius there
      // would leave a centre that means nothing on its own — `readPlace` would
      // drop the whole filter, so the chip would appear to clear two things.
      // The single "Near me" chip already clears it as one unit.
      if (place.radiusKm !== undefined && place.center.kind === "place") {
        chips.push({
          ...base,
          id: spec.radius!.radiusParam,
          label: `Within ${place.radiusKm} km`,
          remove: { [spec.radius!.radiusParam]: undefined },
        });
      }

      // The online toggle is a separate chip because it is separately
      // removable: a user narrowing to "Pune only" should not have to clear
      // the place and re-pick it.
      if (place.includeOnline) {
        chips.push({
          ...base,
          id: spec.includeOnlineParam,
          label: spec.includeOnlineLabel,
          remove: { [spec.includeOnlineParam]: undefined },
        });
      }

      return chips;
    }

    case "team-size": {
      const teamSize = value as TeamSizeValue;

      const chips: FilterChip[] = [];

      // Independently removable from size and policy, same reasoning as
      // place's id and includeOnline: removing just the entry-format chip
      // never strands a contradiction — dropping "Solo" leaves no size
      // behind to conflict with anything, and dropping "Team" leaves
      // "Solo & team" behind, which stays valid on its own.
      if (teamSize.entryFormat) {
        chips.push({
          ...base,
          id: spec.entryFormatParam,
          label:
            teamSize.entryFormat === "SOLO"
              ? "Solo"
              : teamSize.entryFormat === "TEAM"
                ? "Team"
                : "Solo or team",
          remove: { [spec.entryFormatParam]: undefined },
        });
      }

      // Two independently removable chips, same reasoning as place's id and
      // includeOnline: a person narrowing "solo only, and my team is 4" to
      // just one half should not have to clear both and re-pick the other.
      if (teamSize.min !== undefined || teamSize.max !== undefined) {
        chips.push({
          ...base,
          id: `${spec.minParam}:${spec.maxParam}`,
          label: withPrefix(spec, teamSizeLabel(teamSize, spec)),
          remove: {
            [spec.minParam]: undefined,
            [spec.maxParam]: undefined,
          },
        });
      }

      if (teamSize.policy) {
        chips.push({
          ...base,
          id: spec.policyParam,
          label:
            teamSize.policy === "SOLO_ONLY"
              ? "Solo only"
              : "Solo & team allowed",
          remove: { [spec.policyParam]: undefined },
        });
      }

      return chips;
    }
  }
}

/** Every active chip across every filter, in registry order. */
export function describeAllChips(
  specs: readonly FilterSpec[],
  params: RawSearchParams,
  context: ChipContext = {},
): readonly FilterChip[] {
  return specs.flatMap((spec) => describeFilterChips(spec, params, context));
}
