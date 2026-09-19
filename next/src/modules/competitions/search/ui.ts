/**
 * Competitions - Filter specifications (CLIENT-SAFE)
 *
 * =============================================================================
 * What lives here
 * =============================================================================
 *
 * Every Competition filter, described as the person using the page
 * experiences it: its name, the control it renders as, its options, and where
 * it sits by default.
 *
 * This module must remain importable from a `"use client"` component, which
 * means it must never import `@/generated/prisma`, directly or through a
 * barrel. Enum option values are therefore written out as strings rather than
 * derived from the Prisma enums.
 *
 * Imports are limited to `@/lib/search/client` and to individually named pure
 * modules that reach nothing — currently only `@/modules/locations/utils/radius`,
 * deep-imported so the locations barrel and its repositories stay out of the
 * client bundle. A module qualifies only if it has no imports of its own.
 *
 * That is safe because `definition.ts` — which does have the enums — asserts
 * at module load that every list here matches its database enum exactly. A
 * value added to the schema and forgotten here fails on startup rather than
 * quietly disappearing from the interface. See `assertEnumSpecCoverage`.
 *
 * =============================================================================
 * Labels are product copy
 * =============================================================================
 *
 * Options are labelled the way a participant would describe them, not the way
 * the column stores them. `NON_PROFIT` reads as "Non-profit"; `REGISTRATION_OPEN`
 * reads as "Registration open". Mechanically title-casing the enum would be
 * less code and consistently worse writing, and this is the surface where the
 * platform's vocabulary is set.
 *
 * =============================================================================
 * Groups and weights are defaults, not decisions
 * =============================================================================
 *
 * `group` and `weight` say where a filter sits out of the box. A deployment
 * or a user may override both at render time through `resolveFilterLayout`, so
 * nothing here needs changing to promote a filter or reorder the quick bar.
 *
 * Quick placement follows what a participant decides on first: what it is
 * about, where it is, what it costs, how hard it is. Everything else — the
 * platform it is hosted on, the certificate it issues — is real information
 * that very few people filter by, and it belongs behind a disclosure rather
 * than in front of everyone.
 */

import {
  assertUniqueFilterParams,
  type DateRangeSpec,
  type EnumMultiSpec,
  type FilterSpec,
  type PlaceSpec,
  type RelationMultiSpec,
  type TeamSizeSpec,
  type TextAnySpec,
  type TextSpec,
} from "@/lib/search/client";
// Deep import, never the `@/modules/locations` barrel: the barrel re-exports
// repositories that pull in `@/generated/prisma`, which would drag the Prisma
// client into every client bundle importing this file. `utils/radius` is a
// pure module with no imports of its own, so it is safe here.
import { MAX_RADIUS_KM, RADIUS_STEPS } from "@/modules/locations/utils/radius";

// =============================================================================
// Option value unions
// =============================================================================
//
// Declared as literal unions rather than imported enums. They are structurally
// identical to the Prisma enums, and `definition.ts` proves it on startup.

export type CompetitionModeValue = "ONLINE" | "OFFLINE" | "HYBRID";

export type CompetitionStatusValue =
  | "UPCOMING"
  | "REGISTRATION_OPEN"
  | "REGISTRATION_CLOSED"
  | "ONGOING"
  | "COMPLETED"
  | "CANCELLED";

export type RegistrationPlatformValue =
  | "KIZUNIA"
  | "UNSTOP"
  | "DEVPOST"
  | "DEVFOLIO"
  | "DORAHACKS"
  | "HACK2SKILL"
  | "HACKEREARTH"
  | "TAIKAI"
  | "LUMA"
  | "GOOGLE_FORM"
  | "TYPEFORM"
  | "CUSTOM"
  | "OFFLINE"
  | "OTHER";

export type RegistrationTypeValue = "INDIVIDUAL" | "TEAM" | "BOTH";

export type RegistrationFeeTypeValue = "FREE" | "PAID" | "CONDITIONAL";

export type OrganizerTypeValue =
  | "COLLEGE"
  | "COMPANY"
  | "COMMUNITY"
  | "GOVERNMENT"
  | "NON_PROFIT"
  | "STARTUP"
  | "INDIVIDUAL"
  | "OPEN_SOURCE";

export type DifficultyLevelValue =
  | "BEGINNER"
  | "INTERMEDIATE"
  | "ADVANCED"
  | "OPEN";

export type CertificateTypeValue = "NONE" | "PARTICIPATION" | "WINNER";

export type EligibilityTypeValue =
  | "SCHOOL"
  | "UNDERGRADUATE"
  | "POSTGRADUATE"
  | "PHD"
  | "FRESHER"
  | "PROFESSIONAL"
  | "ENGINEERING"
  | "MANAGEMENT"
  | "DESIGN"
  | "SCIENCE"
  | "COMMERCE"
  | "ARTS"
  | "MEDICAL"
  | "LAW"
  | "OPEN"
  | "OTHER";

// =============================================================================
// Quick filters
// =============================================================================

const search: TextSpec = {
  kind: "text",
  key: "search",
  label: "Search",
  placeholder: "Search competitions or organizers",
  group: "quick",
  weight: 0,
  description:
    "Matches the competition title and the organizer's name. Substring, case-insensitive.",
};

const modes: EnumMultiSpec<CompetitionModeValue> = {
  kind: "enum-multi",
  key: "modes",
  label: "Mode",
  group: "quick",
  weight: 10,
  display: "pills",
  options: [
    { value: "ONLINE", label: "Online" },
    { value: "OFFLINE", label: "In person" },
    { value: "HYBRID", label: "Hybrid" },
  ],
};

const categories: RelationMultiSpec = {
  kind: "relation-multi",
  key: "categories",
  label: "Category",
  // group: "quick",
  group: "advanced",
  weight: 20,
  optionsEndpoint: "/api/v1/categories",
  searchPlaceholder: "Search categories",
  description: "The themes a competition is about.",
};

const technologies: RelationMultiSpec = {
  kind: "relation-multi",
  key: "technologies",
  label: "Technology",
  group: "quick",
  weight: 30,
  optionsEndpoint: "/api/v1/technologies",
  searchPlaceholder: "Search technologies",
  description: "Tools and stacks a competition is built around.",
};

/**
 * Location.
 *
 * Owns its three parameters by explicit name because that URL contract
 * predates this spec layer and existing links must keep resolving.
 *
 * Unlike every other filter here, its clause cannot be computed from the URL
 * alone — the place id has to be resolved against the provider first. That is
 * why `definition.ts` registers it as a *resolvable* filter. To the interface
 * it is simply another filter, which is the point: nothing in the UI layer has
 * to know how its clause is produced.
 *
 * `radius` turns distance search on. Setting that one field was the whole
 * wiring: everything registry-driven — chips, Clear all, presets, URL
 * canonicalisation, duplicate-parameter detection — picked the three new
 * parameters up from `filterParams` without another module changing.
 */
const location: PlaceSpec = {
  kind: "place",
  key: "location",
  label: "Location",
  group: "quick",
  weight: 40,
  idParam: "placeId",
  labelParam: "placeLabel",
  includeOnlineParam: "includeOnline",
  includeOnlineLabel: "Including online",
  suggestEndpoint: "/api/v1/places/autocomplete",
  placeholder: "Search for a city or place",
  description:
    "Matches competitions held in the selected place or anywhere inside it. Add a distance to search by how far away they are instead. Online competitions have no location, so include them explicitly if you want both.",

  // Setting this is what enables radius search for Competitions. Everything
  // registry-driven — clearing, chips, presets, duplicate-parameter detection —
  // picks the new parameters up from `filterParams` without further wiring.
  radius: {
    radiusParam: "radius",
    latitudeParam: "lat",
    longitudeParam: "lng",

    // Seeds the control only; never written to the URL on its own, for the same
    // reason `page=1` and the default sort are not written.
    defaultKm: 25,

    // Taken from the radius module rather than restated here. The ceiling and
    // the offered distances are the same facts the query layer clamps and
    // measures against, and two copies of a fact drift: a step the interface
    // offers but `clampRadiusKm` rejects would be a control that silently does
    // nothing. `verify-radius-math.ts` asserts these stay identical.
    maxKm: MAX_RADIUS_KM,

    steps: RADIUS_STEPS,
  },
};

const registrationFeeTypes: EnumMultiSpec<RegistrationFeeTypeValue> = {
  kind: "enum-multi",
  key: "registrationFeeTypes",
  label: "Entry fee",
  group: "quick",
  weight: 50,
  display: "pills",
  options: [
    { value: "FREE", label: "Free" },
    { value: "PAID", label: "Paid" },
    {
      value: "CONDITIONAL",
      label: "Conditional",
      hint: "Free for some participants",
    },
  ],
};

const difficultyLevels: EnumMultiSpec<DifficultyLevelValue> = {
  kind: "enum-multi",
  key: "difficultyLevels",
  label: "Difficulty",
  group: "quick",
  weight: 60,
  display: "pills",
  options: [
    { value: "BEGINNER", label: "Beginner" },
    { value: "INTERMEDIATE", label: "Intermediate" },
    { value: "ADVANCED", label: "Advanced" },
    { value: "OPEN", label: "All levels" },
  ],
};

const statuses: EnumMultiSpec<CompetitionStatusValue> = {
  kind: "enum-multi",
  key: "statuses",
  label: "Stage",
  group: "quick",
  weight: 70,
  display: "checkbox",
  options: [
    { value: "UPCOMING", label: "Upcoming" },
    { value: "REGISTRATION_OPEN", label: "Registration open" },
    { value: "REGISTRATION_CLOSED", label: "Registration closed" },
    { value: "ONGOING", label: "Ongoing" },
    { value: "COMPLETED", label: "Completed" },
    { value: "CANCELLED", label: "Cancelled" },
  ],
  description:
    "Where a competition is in its lifecycle. Promoted to the quick bar because “registration still open” is the single most common thing people are actually looking for.",
};

// =============================================================================
// Advanced filters
// =============================================================================

const registrationDeadline: DateRangeSpec = {
  kind: "date-range",
  key: "registrationDeadline",
  label: "Registration deadline",
  group: "advanced",
  weight: 100,
  chipPrefix: "Deadline",
  presets: [
    { id: "next-7", label: "Next 7 days", fromDays: 0, toDays: 7 },
    { id: "next-30", label: "Next 30 days", fromDays: 0, toDays: 30 },
    { id: "next-90", label: "Next 3 months", fromDays: 0, toDays: 90 },
  ],
};

const startDate: DateRangeSpec = {
  kind: "date-range",
  key: "startDate",
  label: "Starts",
  group: "advanced",
  weight: 110,
  chipPrefix: "Starts",
  presets: [
    { id: "next-30", label: "Next 30 days", fromDays: 0, toDays: 30 },
    { id: "next-90", label: "Next 3 months", fromDays: 0, toDays: 90 },
  ],
};

const endDate: DateRangeSpec = {
  kind: "date-range",
  key: "endDate",
  label: "Ends",
  group: "advanced",
  weight: 120,
  chipPrefix: "Ends",
};

const eligibilities: EnumMultiSpec<EligibilityTypeValue> = {
  kind: "enum-multi",
  key: "eligibilities",
  label: "Eligibility",
  group: "advanced",
  weight: 130,
  display: "checkbox",
  description: "Who a competition is open to.",
  options: [
    { value: "SCHOOL", label: "School students" },
    { value: "UNDERGRADUATE", label: "Undergraduates" },
    { value: "POSTGRADUATE", label: "Postgraduates" },
    { value: "PHD", label: "PhD candidates" },
    { value: "FRESHER", label: "Freshers" },
    { value: "PROFESSIONAL", label: "Working professionals" },
    { value: "ENGINEERING", label: "Engineering" },
    { value: "MANAGEMENT", label: "Management" },
    { value: "DESIGN", label: "Design" },
    { value: "SCIENCE", label: "Science" },
    { value: "COMMERCE", label: "Commerce" },
    { value: "ARTS", label: "Arts" },
    { value: "MEDICAL", label: "Medical" },
    { value: "LAW", label: "Law" },
    { value: "OPEN", label: "Open to everyone" },
    { value: "OTHER", label: "Other" },
  ],
};

const registrationTypes: EnumMultiSpec<RegistrationTypeValue> = {
  kind: "enum-multi",
  key: "registrationTypes",
  label: "Entry format",
  group: "advanced",
  weight: 140,
  display: "pills",
  options: [
    { value: "INDIVIDUAL", label: "Solo" },
    { value: "TEAM", label: "Team" },
    { value: "BOTH", label: "Either" },
  ],
};

/**
 * "Can I enter with the people I have?" — every team-size question, one filter.
 *
 * =============================================================================
 * Why this replaced four separate filters
 * =============================================================================
 *
 * Team size used to be an exact-size filter, a solo flag, and two bounds on
 * the *competition's* own declared limits — four controls a person had to
 * already know how to choose between before they could ask their actual
 * question. Nobody has four independent team-size questions; they have one
 * team-size situation, phrased any of several ways:
 *
 *   "I can make a team of 5"            → exact
 *   "I can make a team of 3 to 5"       → range
 *   "I can make a team of at most 4"    → at most
 *   "I want to go solo"                 → exact, 1
 *   "I want a hackathon for only solo"  → policy: SOLO_ONLY
 *   "I want one that allows solo or team" → policy: SOLO_OR_TEAM
 *
 * `min`/`max` alone express the first four: exact is `min === max`, a range is
 * both set to different values, and at most leaves `min` unset (a floor of 1).
 * There is no "at least N" — an open-ended lower bound has no competition that
 * could honestly be said to contain it. `policy` is a genuinely separate axis
 * — a question about what the *competition* permits rather than what the
 * participant brings — and lives in the same filter because it is asked in
 * the same breath, not as a second decision. See `TeamSizeSpec` for the full
 * mapping.
 *
 * A competition accepting 1-4 people allows solo entry *and* teams — someone
 * entering alone and someone bringing four both belong in its results, which
 * is exactly the case a one-sided bound alone could never express.
 *
 * A third field, `entryFormat`, coordinates the other two without adding a
 * clause of its own: "Solo" clears `min`/`max` (a solo entrant has no team
 * size to state), and "Team" rules out `policy: SOLO_ONLY` (a strictly-solo
 * competition can never satisfy a team entrant). See `TeamEntryFormat` in
 * `@/lib/search/spec` for the full reasoning.
 */
const teamSize: TeamSizeSpec = {
  kind: "team-size",
  key: "teamSize",
  label: "Team size",
  group: "advanced",
  weight: 140,
  chipPrefix: "Team",
  minParam: "teamSizeMin",
  maxParam: "teamSizeMax",
  policyParam: "teamPolicy",
  entryFormatParam: "entryFormat",
  unit: "people",
  unitOne: "person",
  min: 1,
  max: 8,
  openEndedMax: true,
  description: "Choose the team size a competition should accommodate.",
};

const organizerTypes: EnumMultiSpec<OrganizerTypeValue> = {
  kind: "enum-multi",
  key: "organizerTypes",
  label: "Organizer type",
  group: "advanced",
  weight: 170,
  display: "checkbox",
  options: [
    { value: "COLLEGE", label: "College" },
    { value: "COMPANY", label: "Company" },
    { value: "COMMUNITY", label: "Community" },
    { value: "GOVERNMENT", label: "Government" },
    { value: "NON_PROFIT", label: "Non-profit" },
    { value: "STARTUP", label: "Startup" },
    { value: "INDIVIDUAL", label: "Individual" },
    { value: "OPEN_SOURCE", label: "Open source" },
  ],
};

const organizers: TextAnySpec = {
  kind: "text-any",
  key: "organizers",
  label: "Organizer",
  group: "advanced",
  weight: 180,
  placeholder: "Add an organizer name",
  chipPrefix: "By",
  description:
    "Matches organizer names containing what you type. Add several to match any of them.",
};

const certificateTypes: EnumMultiSpec<CertificateTypeValue> = {
  kind: "enum-multi",
  key: "certificateTypes",
  label: "Certificate",
  group: "advanced",
  weight: 190,
  display: "pills",
  options: [
    { value: "PARTICIPATION", label: "For participating" },
    { value: "WINNER", label: "For winning" },
    { value: "NONE", label: "None offered" },
  ],
};

const registrationPlatforms: EnumMultiSpec<RegistrationPlatformValue> = {
  kind: "enum-multi",
  key: "registrationPlatforms",
  label: "Hosted on",
  group: "advanced",
  weight: 200,
  display: "checkbox",
  description: "The platform registration happens through.",
  options: [
    { value: "KIZUNIA", label: "Kizunia" },
    { value: "UNSTOP", label: "Unstop" },
    { value: "DEVPOST", label: "Devpost" },
    { value: "DEVFOLIO", label: "Devfolio" },
    { value: "DORAHACKS", label: "DoraHacks" },
    { value: "HACK2SKILL", label: "Hack2skill" },
    { value: "HACKEREARTH", label: "HackerEarth" },
    { value: "TAIKAI", label: "TAIKAI" },
    { value: "LUMA", label: "Luma" },
    { value: "GOOGLE_FORM", label: "Google Form" },
    { value: "TYPEFORM", label: "Typeform" },
    { value: "CUSTOM", label: "Its own site" },
    { value: "OFFLINE", label: "In person" },
    { value: "OTHER", label: "Other" },
  ],
};

// =============================================================================
// Registry
// =============================================================================

/**
 * Every Competition filter, addressable by name.
 *
 * `definition.ts` reads from this object when declaring the server registry,
 * so a filter's key, label and options exist in exactly one place. Referencing
 * a spec that does not exist here is a compile error there.
 */
export const competitionFilterSpecs = {
  search,
  modes,
  categories,
  technologies,
  location,
  registrationFeeTypes,
  difficultyLevels,
  statuses,
  registrationDeadline,
  startDate,
  endDate,
  eligibilities,
  registrationTypes,
  teamSize,
  organizerTypes,
  organizers,
  certificateTypes,
  registrationPlatforms,
} as const;

export type CompetitionFilterKey = keyof typeof competitionFilterSpecs;

/**
 * The specs in declaration order, validated for parameter collisions.
 *
 * The assertion runs at module load, so two filters accidentally claiming the
 * same URL parameter is a startup failure rather than one silently
 * overwriting the other's value in production.
 *
 * This is the list the interface iterates. It includes location, which is
 * resolvable rather than ordinary — a distinction that matters to the query
 * layer and to nothing above it.
 */
export const COMPETITION_FILTER_SPECS: readonly FilterSpec[] =
  assertUniqueFilterParams(Object.values(competitionFilterSpecs));

// =============================================================================
// Admin-only additions
// =============================================================================

/**
 * Whether a row is active or soft-deleted — never to be confused with
 * `statuses` above, which is the competition's own lifecycle stage
 * (upcoming, ongoing, completed...). A competition can be `COMPLETED` and
 * active, or `UPCOMING` and deleted; the two axes are independent.
 *
 * Admin-only by construction, not by convention: this spec is deliberately
 * kept out of `COMPETITION_FILTER_SPECS`, so it can never reach the public or
 * management filter bar even if a future change loosened those scopes'
 * `allowedFilters`. `definition.ts` additionally gates it at the query layer
 * — see `deletionClauses` in `plan.ts` — so the safety does not rest on the
 * UI alone.
 */
export const RECORD_STATE_SPEC: EnumMultiSpec<"ACTIVE" | "DELETED"> = {
  kind: "enum-multi",
  key: "recordState",
  label: "Record state",
  group: "quick",
  weight: -10,
  display: "pills",
  options: [
    { value: "ACTIVE", label: "Active" },
    { value: "DELETED", label: "Deleted" },
  ],
  description:
    "Whether to show active competitions, soft-deleted ones, or both.",
};

/**
 * The admin filter vocabulary: every public filter, plus the one admin-only
 * addition above. Composition, not a second registry — there is exactly one
 * place each shared filter is declared, and this list is that list plus one
 * more entry.
 */
export const ADMIN_FILTER_SPECS: readonly FilterSpec[] =
  assertUniqueFilterParams([...COMPETITION_FILTER_SPECS, RECORD_STATE_SPEC]);

// =============================================================================
// Lifecycle-only additions
// =============================================================================

/**
 * When registration opens — distinct from `registrationDeadline` above,
 * which is when it closes. Lifecycle-only by construction, for the same
 * reason `RECORD_STATE_SPEC` is admin-only: kept out of
 * `COMPETITION_FILTER_SPECS` so it can never reach the public filter bar,
 * and gated a second, independent time at the query layer — see
 * `lifecycleClauses` in `plan.ts`. Not promoted to a public filter in this
 * change; see the "registrationStartDate is admin-only for now" note in the
 * lifecycle feature's implementation plan.
 */
export const REGISTRATION_START_DATE_SPEC: DateRangeSpec = {
  kind: "date-range",
  key: "registrationStartDate",
  label: "Registration opens",
  group: "quick",
  weight: -5,
  chipPrefix: "Opens",
};

/**
 * Whether automatic lifecycle status management is turned on for a
 * competition — `automaticStatusUpdatesDisabled`, inverted for the label a
 * person filtering actually thinks in. Lifecycle-only by construction, same
 * two independent protections as `RECORD_STATE_SPEC` and the spec above.
 */
export const AUTOMATION_STATE_SPEC: EnumMultiSpec<"ENABLED" | "DISABLED"> = {
  kind: "enum-multi",
  key: "automationState",
  label: "Automatic updates",
  group: "quick",
  weight: -8,
  display: "pills",
  options: [
    { value: "ENABLED", label: "Enabled" },
    { value: "DISABLED", label: "Disabled" },
  ],
  description:
    "Whether automatic lifecycle status management is turned on for a competition. Automation never proposes a change for a competition where this is off — filtering to \"Disabled\" here will always show zero actionable rows.",
};

/**
 * The lifecycle console's filter vocabulary: every public filter, plus the
 * two lifecycle-only additions above. Deliberately composed from the public
 * list rather than from `ADMIN_FILTER_SPECS` — `RECORD_STATE_SPEC` has no
 * meaning here (the lifecycle console only ever considers active rows; see
 * `deletionClauses` in `plan.ts`), so including it would offer a control
 * that silently does nothing.
 */
export const LIFECYCLE_FILTER_SPECS: readonly FilterSpec[] =
  assertUniqueFilterParams([
    ...COMPETITION_FILTER_SPECS,
    AUTOMATION_STATE_SPEC,
    REGISTRATION_START_DATE_SPEC,
  ]);

/**
 * Sort options, as plain data for the sort control.
 *
 * Mirrors the keys in `definition.ts`'s sort registry, which remains the
 * authority: an unknown token degrades to the default there, so a stale entry
 * here would produce a harmless no-op rather than an error. The registry
 * cannot be exported to the client directly because its `orderBy` entries are
 * Prisma types.
 */
export const COMPETITION_SORT_OPTIONS = [
  { key: "newest", label: "Newest" },
  { key: "registration-deadline-asc", label: "Deadline soonest" },
  { key: "start-date-asc", label: "Starting soonest" },
  { key: "start-date-desc", label: "Starting latest" },
  { key: "registration-deadline-desc", label: "Deadline latest" },
  { key: "oldest", label: "Oldest" },
  { key: "alphabetical-asc", label: "Title A–Z" },
  { key: "alphabetical-desc", label: "Title Z–A" },
] as const;

/** The sort applied when the URL names none. Must match the server registry. */
export const COMPETITION_DEFAULT_SORT = "newest";
