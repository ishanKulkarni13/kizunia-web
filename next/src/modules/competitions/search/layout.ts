/**
 * Competitions - Filter layout (CLIENT-SAFE)
 *
 * =============================================================================
 * What this is for
 * =============================================================================
 *
 * The specs in `./ui.ts` declare where each filter sits by default. This module
 * is the layer above them: deployment-level decisions about what the
 * Competition discovery experience should emphasise, expressed as overrides
 * rather than by editing the specs.
 *
 * Keeping them separate matters because they answer different questions. A
 * spec says what a filter *is* — stable, reviewable, and the same everywhere.
 * A layout says what this product wants people to notice first, which is a
 * product decision that will change as user research comes in, and which will
 * eventually vary per person.
 *
 * =============================================================================
 * The precedence this participates in
 * =============================================================================
 *
 *   spec defaults  →  this module  →  user preferences  →  runtime
 *
 * Only the first two exist today. `resolveCompetitionFilterLayout` already
 * accepts further sources, so the preferences phase adds an argument at the
 * call site rather than a rewrite here.
 */

import {
  resolveFilterLayout,
  type FilterLayoutSource,
  type RawSearchParams,
  type ResolvedFilterLayout,
} from "@/lib/search/client";

import {
  ADMIN_FILTER_SPECS,
  COMPETITION_FILTER_SPECS,
  LIFECYCLE_FILTER_SPECS,
} from "./ui";

/** Which spec list and layout a render resolves against. */
export type CompetitionFilterScope = "public" | "admin" | "lifecycle";

/**
 * The order the quick bar leads with.
 *
 * Ordered by what a participant decides on first, which is not the same as
 * what the database emphasises. Someone browsing asks, roughly in this order:
 * what is it about, can I still enter, where is it, what does it cost.
 *
 * Deliberately shorter than the full set of quick-eligible filters. A quick
 * bar that contains everything is not a quick bar — anything past the first
 * row is scrolled past rather than scanned, and the promotion is wasted.
 */
const QUICK_BAR_ORDER: readonly string[] = [
  "search",
  // "categories",
  "modes",
  "location",
  "statuses",
  "registrationFeeTypes",
];

/**
 * Kizunia's default Competition layout.
 *
 * `technologies` and `difficultyLevels` are demoted out of their spec-declared
 * quick placement — not because they do not matter, but because six controls
 * plus a sort and a sheet trigger is already a full row on a laptop, and a
 * seventh pushes the whole bar onto a second line where nothing is scanned.
 *
 * This is exactly the kind of decision that should be revisited once the user
 * research lands, and exactly why it is three lines here rather than a change
 * to the specs.
 */
export const KIZUNIA_COMPETITION_LAYOUT: FilterLayoutSource = {
  id: "kizunia-default",

  pinned: QUICK_BAR_ORDER,

  overrides: [
    { key: "technologies", group: "advanced", weight: 5 },
    { key: "difficultyLevels", group: "advanced", weight: 6 },

    // Presentation only — see the note on `FilterLayoutOverride.hidden`.
    // `registrationTypes` and `teamSize` are declared right next to each
    // other and happen to share a label ("Entry format" vs. `teamSize`'s own
    // nested "Entry format" section), which read as the same control shown
    // twice. `teamSize`'s version is the one wired to the size/policy
    // coordination logic, so it is the one that stays. Hiding here leaves
    // `registrationTypes` itself completely untouched — still a real filter,
    // still applied if a URL names it, and still revealed (via
    // `revealedBecauseActive`) if one does.
    { key: "categories", hidden: true },
    { key: "technologies", hidden: true },
    { key: "difficultyLevels", hidden: true },
    { key: "registrationTypes", hidden: true },
  ],
};

/**
 * Admin adds one quick-bar entry ahead of everything else: Record state,
 * because deciding whether to look at active or deleted rows comes before
 * every other question on that page. This is layered on top of
 * `KIZUNIA_COMPETITION_LAYOUT` rather than folded into it, for the same
 * reason `ADMIN_FILTER_SPECS` is layered on top of `COMPETITION_FILTER_SPECS`
 * in `ui.ts`: composition, so the shared layout stays the one place that
 * describes the shared filters' placement.
 */
const ADMIN_LAYOUT: FilterLayoutSource = {
  id: "kizunia-admin",
  pinned: ["recordState", ...QUICK_BAR_ORDER],
};

/**
 * The lifecycle console leads with the two controls unique to it —
 * automation state first (the axis that decides whether a row can be
 * automated at all), then when registration opens — ahead of the ordinary
 * quick bar.
 */
const LIFECYCLE_LAYOUT: FilterLayoutSource = {
  id: "kizunia-lifecycle",
  pinned: ["automationState", "registrationStartDate", ...QUICK_BAR_ORDER],
};

/**
 * Resolves the layout for one render.
 *
 * `params` is required because a filter hidden by layout but currently holding
 * a value is revealed anyway — a restriction the person cannot see is one they
 * cannot undo.
 *
 * `scope` picks both the spec list and the layout it resolves against —
 * `admin` sees `ADMIN_FILTER_SPECS` (the shared filters plus Record state)
 * under the shared layout plus `ADMIN_LAYOUT`'s one addition; `lifecycle`
 * sees `LIFECYCLE_FILTER_SPECS` under the shared layout plus
 * `LIFECYCLE_LAYOUT`'s two additions; `public` is exactly what this function
 * has always done.
 *
 * No `default` case in the switch below: adding a fourth scope to
 * `CompetitionFilterScope` without a matching branch here is a compile
 * error, not a silent fallback to `public`.
 *
 * @param extraSources further layers, highest precedence last. The seam user
 *        preferences will arrive through.
 */
export function resolveCompetitionFilterLayout(
  params: RawSearchParams,
  scope: CompetitionFilterScope,
  extraSources: readonly FilterLayoutSource[] = [],
): ResolvedFilterLayout {
  switch (scope) {
    case "admin":
      return resolveFilterLayout(ADMIN_FILTER_SPECS, params, [
        KIZUNIA_COMPETITION_LAYOUT,
        ADMIN_LAYOUT,
        ...extraSources,
      ]);

    case "lifecycle":
      return resolveFilterLayout(LIFECYCLE_FILTER_SPECS, params, [
        KIZUNIA_COMPETITION_LAYOUT,
        LIFECYCLE_LAYOUT,
        ...extraSources,
      ]);

    case "public":
      return resolveFilterLayout(COMPETITION_FILTER_SPECS, params, [
        KIZUNIA_COMPETITION_LAYOUT,
        ...extraSources,
      ]);
  }
}
