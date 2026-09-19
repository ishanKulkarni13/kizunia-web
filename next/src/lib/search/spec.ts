/**
 * Search Core - Filter specifications (CLIENT-SAFE)
 *
 * =============================================================================
 * What this module is
 * =============================================================================
 *
 * The single source of truth for what a filter *is* to a user: its name, the
 * control it renders as, its options, and where it sits in the interface.
 *
 * It contains no Prisma import, no database type and no server-only value, so
 * a `"use client"` component may import it directly. The server registry
 * (`FilterDescriptor`, see `types.ts`) *consumes* these specs rather than
 * declaring a parallel copy of the same metadata.
 *
 * That direction matters. If the server owned the labels and the client owned
 * a duplicate of them, the two would eventually disagree and the UI would
 * offer a filter the query does not apply. Because the dependency points from
 * server to client, there is only one declaration and drift is not merely
 * unlikely — it is unrepresentable.
 *
 * =============================================================================
 * What this module is not
 * =============================================================================
 *
 * Nothing here is entity-specific. Competitions, Projects and Blogs describe
 * their filters with this same vocabulary, and the React controls built on it
 * are shared verbatim between them. A spec that only makes sense for one
 * entity belongs in that entity's own `search/ui.ts`, expressed in terms of
 * the kinds below.
 *
 * See also:
 *   - `spec-values.ts` — reading and writing spec values against a URL
 *   - `layout.ts`      — resolving which filters appear where, per viewer
 *   - `types.ts`       — the server-side descriptor that consumes a spec
 */

// =============================================================================
// Kinds
// =============================================================================

/**
 * Which control a filter renders as, and therefore what shape its decoded
 * value has (see `FilterValueOf`).
 *
 * Adding a kind means adding one control component and one branch each in
 * `readFilterValue` / `writeFilterValue` / `describeFilterChips`. It never
 * means editing a panel, a chip list, or an entity's registry — which is the
 * property that keeps "add a new filter" from becoming a UI rewrite.
 */
export type FilterKind =
  | "enum-multi"
  | "relation-multi"
  | "text"
  | "text-any"
  | "number-bound"
  | "date-range"
  | "boolean"
  | "place"
  | "team-size";

/**
 * Default placement. A layout resolver may override this per deployment or
 * per user at render time (see `layout.ts`); the spec only states the
 * out-of-the-box position, never the final one.
 */
export type FilterGroup = "quick" | "advanced";

export interface FilterOption<TValue extends string = string> {
  readonly value: TValue;

  readonly label: string;

  /** Secondary text shown beneath the label in wide controls. */
  readonly hint?: string;
}

// =============================================================================
// Common spec fields
// =============================================================================

interface FilterSpecBase {
  /**
   * Stable identifier, unique within an entity's filter set.
   *
   * Also the default URL parameter name for single-parameter kinds. It is
   * *not* automatically the parameter name for multi-parameter kinds — see
   * `filterParams`.
   */
  readonly key: string;

  readonly label: string;

  /**
   * Default group. Advisory: `layout.ts` has the last word.
   */
  readonly group: FilterGroup;

  /**
   * Default ordering weight within a group; lower sorts earlier. Also
   * advisory.
   *
   * Declared in steps of ten so a filter can be inserted between two others
   * without renumbering the rest.
   */
  readonly weight: number;

  /** Explanatory text for the advanced panel and tooltips. */
  readonly description?: string;

  /**
   * Prefix for value chips where the bare value would be ambiguous.
   *
   * "Beginner" reads fine alone; "≥ 4" does not, and needs "Min team".
   */
  readonly chipPrefix?: string;

  /**
   * Overrides the parameters this filter owns.
   *
   * Needed only where a filter's URL contract was fixed before its spec
   * existed and the derived default would break existing links. Prefer the
   * derivation — an override is a compatibility concession, not a style
   * choice.
   */
  readonly params?: readonly string[];
}

// =============================================================================
// Kind-specific specs
// =============================================================================

/**
 * A fixed, known set of values, backed by an enum on the server.
 *
 * Option values are declared here as plain strings rather than derived from
 * the Prisma enum, because deriving them would require importing the enum and
 * that is precisely what this module may not do. The server registry asserts
 * exhaustiveness against the real enum when it consumes the spec, so a member
 * added to the database and forgotten here fails at module load rather than
 * silently vanishing from the UI.
 */
export interface EnumMultiSpec<TValue extends string = string>
  extends FilterSpecBase {
  readonly kind: "enum-multi";

  readonly options: readonly FilterOption<TValue>[];

  /**
   * "pills"    — a row of toggles, for short lists scanned at a glance
   * "checkbox" — a scrollable list, for longer sets
   *
   * Defaults to pills at four options or fewer. Centralised here so the
   * threshold is one number rather than a judgement repeated at every
   * declaration site.
   */
  readonly display?: "pills" | "checkbox";
}

/**
 * A set whose options come from the database rather than an enum —
 * categories, technologies, authors.
 *
 * Options are *supplied to* the control rather than fetched by it, so a
 * server component can resolve them during render and the picker is populated
 * on first paint instead of flashing empty. `optionsEndpoint` exists for the
 * cases that genuinely need a client-side refresh; it is never called during
 * server rendering.
 */
export interface RelationMultiSpec extends FilterSpecBase {
  readonly kind: "relation-multi";

  readonly optionsEndpoint: string;

  readonly searchPlaceholder?: string;

  /**
   * Above this many options the control switches from a plain list to a
   * search-first experience. Taxonomies grow; the control should not have to
   * be swapped out when they do.
   */
  readonly searchThreshold?: number;
}

/** A single free-text value. */
export interface TextSpec extends FilterSpecBase {
  readonly kind: "text";

  readonly placeholder?: string;
}

/** Several free-text values, matched as OR-ed substrings. */
export interface TextAnySpec extends FilterSpecBase {
  readonly kind: "text-any";

  readonly placeholder?: string;
}

/** A one-sided numeric bound. */
export interface NumberBoundSpec extends FilterSpecBase {
  readonly kind: "number-bound";

  readonly min?: number;

  readonly max?: number;

  /** Rendered after the value in chips and controls, e.g. "members". */
  readonly unit?: string;

  /**
   * Singular form of `unit`, used when the value is exactly 1.
   *
   * Only worth setting where 1 is selectable — otherwise it can never render.
   * "1 person" rather than "1 people" is the difference between copy that was
   * written and copy that was generated.
   */
  readonly unitOne?: string;

  /**
   * Whether `max` should read as "this many or more".
   *
   * A range has to stop somewhere, and a filter that silently excludes the
   * long tail is worse than one that says it is a ceiling. Presentation only —
   * the stored value and the clause are unchanged.
   */
  readonly openEndedMax?: boolean;

  /**
   * Whether parking the handle at `min` means "no restriction".
   *
   * Defaults to `true`, which suits a bound whose lowest value is a no-op:
   * "minimum team size is at least 1" excludes nothing, so spending the
   * bottom of the range on it costs nothing and buys a clear gesture.
   *
   * Set `false` where `min` is a real, selectable answer. "A team of 1" is the
   * whole solo case, and "maximum team size at most 1" is how solo-only
   * competitions are found — with the default those would be unreachable, and
   * the filter would silently lack its most meaningful value. Such controls
   * offer an explicit Clear instead.
   */
  readonly clearAtMin?: boolean;
}

/**
 * A date range owning two parameters.
 *
 * By default it owns `<key>From` and `<key>To`, matching the server-side
 * `dateRangeFilter` contract exactly.
 */
export interface DateRangeSpec extends FilterSpecBase {
  readonly kind: "date-range";

  /** Named shortcuts offered above the calendar, e.g. "Next 30 days". */
  readonly presets?: readonly DateRangePreset[];
}

/**
 * A relative shortcut, resolved against "today" at the moment it is clicked.
 *
 * Stored relatively rather than absolutely so a preset cannot go stale: a
 * saved search using "the next 30 days" should mean the next 30 days whenever
 * it is re-run, not the 30 days after the date it was saved. The *applied*
 * value is always absolute, because the URL must stay unambiguous.
 */
export interface DateRangePreset {
  readonly id: string;

  readonly label: string;

  /** Days from today. `fromDays: 0, toDays: 30` is "the next 30 days". */
  readonly fromDays?: number;

  readonly toDays?: number;
}

/**
 * A flag that narrows results when set.
 *
 * Absence and an explicit "false" both mean unset. There is deliberately no
 * way to request `false`: no current column needs it, and supporting it would
 * double the parameter's states for no use case.
 */
export interface BooleanSpec extends FilterSpecBase {
  readonly kind: "boolean";
}

// -----------------------------------------------------------------------------
// Place
// -----------------------------------------------------------------------------

/**
 * Configuration for radius search on a place filter.
 *
 * Setting this field is what turns the feature on for an entity: `filterParams`
 * below then reports the radius and device-centre parameters as owned, and
 * clearing, chip rendering, preset capture and duplicate-parameter detection all
 * become radius-aware with no further edits.
 *
 * =============================================================================
 * One correction to an earlier note, because it mattered
 * =============================================================================
 *
 * This interface was originally reserved with a comment predicting that radius
 * would "change the resolution result, not the clause shape: the resolver would
 * return a wider set of search-area ids, and `toWhere` would be untouched."
 *
 * **That prediction was wrong, and acting on it would have produced a subtly
 * broken feature.** A circle does not correspond to any set of stored
 * `SearchArea` rows, and it especially does not at the top of the hierarchy:
 * address-component areas — which is how every city, state and country acquires
 * an identity — carry no coordinates at all, so the areas nearest to what people
 * actually search for are the ones a distance test can say least about.
 *
 * What is true instead:
 *
 *   - Radius is a property of the selected *centre*, not a separate filter. A
 *     radius with no centre is meaningless, so it can never be an independent
 *     registry entry. (This half of the original note was right.)
 *   - Radius resolves to **Location ids**, not search-area ids, and it therefore
 *     *does* change the clause: `toWhere` builds a different predicate.
 *   - When a radius is active it **replaces** the search-area arm rather than
 *     widening it. "Within 25 km" is a question about distance, and answering it
 *     partly by identity would make the answer neither one thing nor the other.
 *   - `includeOnline` remains an OR arm on the same clause. It has to live
 *     inside this one clause: as a separately ANDed condition it would cancel
 *     itself, because an online competition has no location row and so can never
 *     satisfy a geographic predicate.
 */
export interface PlaceRadiusConfig {
  /** Distance parameter, in kilometres. */
  readonly radiusParam: string;

  /**
   * Parameters carrying a device-supplied centre.
   *
   * Bare coordinates, deliberately. A device position has no provider identity
   * and is never reverse geocoded into one — it is an ephemeral search input,
   * not a place, and it is never persisted.
   */
  readonly latitudeParam: string;

  readonly longitudeParam: string;

  /** Seeds the control only. Never written to the URL on its own. */
  readonly defaultKm: number;

  /** Hard ceiling. A larger value in a URL is clamped to this, never dropped. */
  readonly maxKm: number;

  /**
   * The values the interface offers.
   *
   * An affordance, not a contract: an off-step value in a hand-edited or shared
   * URL is honoured so long as it is in range.
   */
  readonly steps: readonly number[];
}

/**
 * A geographic place chosen from a provider's suggestions.
 *
 * Owns its parameters by explicit name rather than by derivation, because its
 * URL contract (`placeId`, `placeLabel`, `includeOnline`) predates this spec
 * layer and existing links must keep working. Naming them individually also
 * removes any guesswork about which parameter carries which meaning.
 *
 * `labelParam` carries a human-readable name purely so chips, the browser
 * title and the back button can render without a provider round trip. It is
 * presentation data and never reaches a query — a hand-edited URL that omits
 * it, or lies in it, changes nothing about which competitions match.
 *
 * `includeOnlineParam` widens the result set to online entries, which by
 * definition have no location and could never satisfy a geographic condition.
 * It belongs to this spec rather than standing alone because an "include
 * online" toggle with no place selected has no meaning.
 */
export interface PlaceSpec extends FilterSpecBase {
  readonly kind: "place";

  /** Provider place id. The only parameter that affects matching. */
  readonly idParam: string;

  /** Display label. Presentation only. */
  readonly labelParam: string;

  /** Whether locationless online entries are included alongside the place. */
  readonly includeOnlineParam: string;

  readonly includeOnlineLabel: string;

  readonly suggestEndpoint: string;

  readonly placeholder?: string;

  /** Present when the filter offers a distance. See `PlaceRadiusConfig`. */
  readonly radius?: PlaceRadiusConfig;
}

// -----------------------------------------------------------------------------
// Team size
// -----------------------------------------------------------------------------

/**
 * What a competition itself declares about solo participation.
 *
 * A second axis from `min`/`max` below, not a redundant one. `min`/`max`
 * describe the size the *participant* intends to bring; this describes what
 * the *competition* allows regardless of size. "I can bring three people" and
 * "does this competition let me enter alone" are different questions, and
 * collapsing them into one boolean would make one of the two unaskable.
 */
export type TeamSizePolicy = "SOLO_ONLY" | "SOLO_OR_TEAM";

/**
 * What the *participant* wants, as distinct from `min`/`max` (their possible
 * size) and `policy` (what the competition permits).
 *
 * This is the coordinating axis: it decides whether `min`/`max` apply at all
 * (a solo entrant has no team size to state) and which `policy` values remain
 * reachable (a team entrant cannot ask for a solo-only competition). It reads
 * and writes its own parameter so a shared link remembers which of the three
 * questions the participant actually answered, but — deliberately — it has no
 * Prisma clause of its own: everything it implies is already expressible
 * through `min`/`max` and `policy`, which remain the only two axes
 * `buildTeamSizeClause` reads. See `readTeamSize` in `spec-values.ts` for the
 * normalisation this enables (clearing a size that is no longer applicable,
 * or a policy that has become contradictory) and `TeamSizeControl` for the
 * interactive form of the same rules.
 */
export type TeamEntryFormat = "SOLO" | "TEAM" | "EITHER";

/**
 * "Can I enter with the people I have?" — as one filter.
 *
 * =============================================================================
 * Why this is one spec and not several
 * =============================================================================
 *
 * Team size used to be four separate filters: two bounds on the
 * *competition's* declared limits, plus a participant-facing exact size and a
 * solo flag added alongside them. In practice nobody asks four independent
 * questions about team size — a person has one team-size situation ("I have
 * four people", "I'm going alone", "I can do three to five") and wants one
 * control that answers it, however it is phrased.
 *
 * `min` and `max` are both optional and independently meaningful, which is
 * what lets one pair of fields express every shape a participant's intent
 * takes:
 *
 *   exact N       min = N,   max = N
 *   range [N, M]  min = N,   max = M
 *   at most N     min = undefined, max = N
 *
 * There is deliberately no "at least N": an open-ended lower bound has no
 * well-defined competition to contain it — any finite competition maximum
 * would fail a team that turned out larger — so the control does not offer
 * it, and a value with `min` set but `max` unset is never produced or read.
 *
 * `policy` is the orthogonal question about the competition's own rules, and
 * sits in the same filter because it is asked in the same breath ("a
 * hackathon that lets me go solo, or bring my team of four") rather than as a
 * second, separate decision.
 */
export interface TeamSizeSpec extends FilterSpecBase {
  readonly kind: "team-size";

  readonly minParam: string;

  readonly maxParam: string;

  readonly policyParam: string;

  readonly entryFormatParam: string;

  /** UI bounds for the size pickers. */
  readonly min?: number;

  readonly max?: number;

  /** Whether `max` should read as "this many or more" in the control. */
  readonly openEndedMax?: boolean;

  /** Rendered after a value, e.g. "people". */
  readonly unit?: string;

  /** Singular form, used when a picked value is exactly 1. */
  readonly unitOne?: string;
}

export type FilterSpec =
  | EnumMultiSpec
  | RelationMultiSpec
  | TextSpec
  | TextAnySpec
  | NumberBoundSpec
  | DateRangeSpec
  | BooleanSpec
  | PlaceSpec
  | TeamSizeSpec;

// =============================================================================
// Value shapes
// =============================================================================

export interface DateRangeValue {
  /**
   * ISO 8601. Kept as a string rather than a `Date` so a value survives the
   * server/client boundary unchanged and round-trips through a URL without a
   * timezone being invented for it along the way.
   */
  readonly from?: string;

  readonly to?: string;
}

/**
 * Where a radius is measured from.
 *
 * A discriminated union rather than a bag of optional fields, because "a radius
 * has exactly one centre" is a rule worth making *unrepresentable* to break
 * rather than one to check at runtime. There is no value of this type that
 * carries both a place and a device position, so no code path has to decide
 * which of the two wins — the decoder settles it once, when it builds the value.
 *
 * The two kinds are genuinely different, not two encodings of one thing:
 *
 *   - `place` carries a provider identity. It resolves to search areas *and* to
 *     an anchor, it renders as a readable chip, and it survives being shared.
 *   - `device` carries a bare coordinate. It is ephemeral: never reverse
 *     geocoded, never persisted as a Location, and never given an identity. It
 *     exists only for the length of one URL.
 */
export type SearchCenter =
  | {
      readonly kind: "place";

      readonly id: string;

      /** Presentation only; absent on a hand-edited or truncated URL. */
      readonly label?: string;
    }
  | {
      readonly kind: "device";

      readonly latitude: number;

      readonly longitude: number;
    };

export interface PlaceValue {
  readonly center: SearchCenter;

  readonly includeOnline: boolean;

  /**
   * Distance in kilometres. Absent means today's behaviour exactly: match by
   * stored search area, not by distance.
   *
   * Always already validated and clamped — the decoder is the only thing that
   * ever constructs this, so nothing downstream re-checks it.
   */
  readonly radiusKm?: number;
}

/**
 * A participant's team-size intent, a competition's solo policy, or both.
 *
 * At least one field is set whenever this value exists at all — an empty
 * `{}` is never produced; the decoder returns `undefined` instead. `min` and
 * `max` are independently optional, which is what lets one shape express
 * exact, ranged, and one-sided intents without a discriminated union: see
 * `TeamSizeSpec` for how each combination reads.
 */
export interface TeamSizeValue {
  readonly min?: number;

  readonly max?: number;

  readonly policy?: TeamSizePolicy;

  readonly entryFormat?: TeamEntryFormat;
}

/**
 * The decoded value type for each kind.
 *
 * This mapping is what lets a control component be type-safe without a cast:
 * once a spec is narrowed to `EnumMultiSpec`, its value is statically known to
 * be `readonly string[]`, and a control that tried to treat it as a `Date`
 * would not compile.
 */
export type FilterValueOf<TKind extends FilterKind> = TKind extends
  | "enum-multi"
  | "relation-multi"
  | "text-any"
  ? readonly string[]
  : TKind extends "text"
    ? string
    : TKind extends "number-bound"
      ? number
      : TKind extends "date-range"
        ? DateRangeValue
        : TKind extends "boolean"
          ? true
          : TKind extends "place"
            ? PlaceValue
            : TKind extends "team-size"
              ? TeamSizeValue
              : never;

/** The value type a given spec decodes to. */
export type ValueOfSpec<TSpec extends FilterSpec> = FilterValueOf<TSpec["kind"]>;

/** Any decoded filter value, for code that handles specs generically. */
export type AnyFilterValue = FilterValueOf<FilterKind>;

// =============================================================================
// Parameter ownership
// =============================================================================

/**
 * Every URL parameter a filter owns.
 *
 * Derived from the kind rather than declared per filter, so a date range
 * cannot be given a single key by mistake and a place cannot forget one of
 * its three. `spec.params` overrides the derivation where a pre-existing URL
 * contract requires it.
 *
 * This function is the authority on ownership. Clearing, canonicalising and
 * conflict detection all go through it, so a filter that is added correctly
 * here is automatically handled correctly everywhere else.
 */
export function filterParams(spec: FilterSpec): readonly string[] {
  if (spec.params) {
    return spec.params;
  }

  switch (spec.kind) {
    case "date-range":
      return [`${spec.key}From`, `${spec.key}To`];

    case "place":
      return spec.radius
        ? [
            spec.idParam,
            spec.labelParam,
            spec.includeOnlineParam,
            spec.radius.radiusParam,
            spec.radius.latitudeParam,
            spec.radius.longitudeParam,
          ]
        : [spec.idParam, spec.labelParam, spec.includeOnlineParam];

    case "team-size":
      return [
        spec.minParam,
        spec.maxParam,
        spec.policyParam,
        spec.entryFormatParam,
      ];

    default:
      return [spec.key];
  }
}

/**
 * Every parameter owned by any of `specs`, deduplicated and in declaration
 * order.
 */
export function allFilterParams(
  specs: readonly FilterSpec[],
): readonly string[] {
  const seen = new Set<string>();

  for (const spec of specs) {
    for (const param of filterParams(spec)) {
      seen.add(param);
    }
  }

  return [...seen];
}

/**
 * Asserts that no two specs claim the same URL parameter.
 *
 * Called once when an entity's spec list is declared, so a collision is a
 * module-load failure during development rather than one filter silently
 * overwriting another's value in production.
 */
export class DuplicateFilterParamError extends Error {
  constructor(param: string, first: string, second: string) {
    super(
      `Filters "${first}" and "${second}" both claim URL parameter "${param}".`,
    );

    this.name = "DuplicateFilterParamError";
  }
}

export function assertUniqueFilterParams(
  specs: readonly FilterSpec[],
): readonly FilterSpec[] {
  const owner = new Map<string, string>();

  for (const spec of specs) {
    for (const param of filterParams(spec)) {
      const existing = owner.get(param);

      if (existing !== undefined) {
        throw new DuplicateFilterParamError(param, existing, spec.key);
      }

      owner.set(param, spec.key);
    }
  }

  return specs;
}

// =============================================================================
// Presentation helpers
// =============================================================================

/** Whether an enum filter should render as pills rather than a checkbox list. */
export function usesPillDisplay(spec: EnumMultiSpec): boolean {
  return spec.display ? spec.display === "pills" : spec.options.length <= 4;
}

/** Whether a relation filter's option list warrants a search box. */
export function usesOptionSearch(
  spec: RelationMultiSpec,
  optionCount: number,
): boolean {
  return optionCount > (spec.searchThreshold ?? 8);
}

/** Looks up an option's label, falling back to the raw value. */
export function optionLabel(
  options: readonly FilterOption[],
  value: string,
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}
