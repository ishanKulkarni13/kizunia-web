/**
 * Competitions - Search planning
 *
 * =============================================================================
 * The invariant this module makes structural
 * =============================================================================
 *
 * A listing runs two queries against the same predicate: one for the rows, one
 * for the total. If the two are built independently, they can differ — and a
 * total that disagrees with the rows produces a pager to a page that does not
 * exist, intermittently and only under the conditions that caused the drift.
 *
 * With a resolvable filter in play, that risk stops being theoretical. Two
 * independent resolutions of the same place could straddle a cache expiry and
 * legitimately return different area sets.
 *
 * So resolution does not happen in the repository. It happens once, here,
 * producing a `CompetitionSearchPlan`; the repository accepts a plan and has
 * no way to obtain raw parameters, and therefore no way to resolve anything a
 * second time. The invariant is enforced by the type, not by remembering.
 *
 * =============================================================================
 * Where failure is handled
 * =============================================================================
 *
 * Planning is the only step that can fail for an external reason, and it fails
 * loudly. A location lookup that could not complete raises
 * `LOCATION_RESOLUTION_FAILED` rather than degrading to an unfiltered or empty
 * search: "we could not find out" must never be presented as "there is nothing
 * there".
 */

import type { Prisma } from "@/generated/prisma";
import { ExternalServiceError } from "@/lib/errors";
import {
  buildSearchQuery,
  dateRangeFilter,
  readFilterValue,
  resolvableFiltersForScope,
  resolveBaseClauses,
  type RawSearchParams,
} from "@/lib/search";

import { CompetitionErrorCode } from "../errors/error-code";
import {
  competitionSearchDefinition,
  dateBounds,
  type CompetitionSearchContext,
} from "./definition";
import {
  AUTOMATION_STATE_SPEC,
  RECORD_STATE_SPEC,
  REGISTRATION_START_DATE_SPEC,
} from "./ui";

type CompetitionWhere = Prisma.CompetitionWhereInput;

/** The scopes the Competition registry declares. */
export type CompetitionSearchScope =
  | "public"
  | "management"
  | "admin"
  | "lifecycle";

/**
 * Matches rows whose status is anything other than CANCELLED — including
 * `null`. Written this way deliberately: `{ status: { not: "CANCELLED" } }`
 * compiles to SQL `status <> 'CANCELLED'`, which is UNKNOWN (and therefore
 * excludes) NULL rows. A null-status competition is "no status yet", not
 * CANCELLED, and automatic lifecycle processing must still be able to
 * propose a status for it — see `resolveAutomaticStatus`'s rule 0.
 */
export const NON_CANCELLED_CLAUSE: CompetitionWhere = {
  OR: [{ status: null }, { status: { not: "CANCELLED" } }],
};

/**
 * Not registered on the definition (see `lifecycleClauses` below), but still
 * built through `dateRangeFilter` so its boundary parsing — inclusive
 * bounds, bare-date end-of-day — comes from the one function that owns
 * those semantics, the same as every registered date-range filter.
 */
const registrationStartDateFilter = dateRangeFilter<Prisma.DateTimeFilter>({
  spec: REGISTRATION_START_DATE_SPEC,
  toWhere: dateBounds,
});

/**
 * Soft-deleted-row visibility, per request.
 *
 * =============================================================================
 * Why this is scope-gated here and not left to the filter registry
 * =============================================================================
 *
 * For `public` and `management` this returns the exact same fixed clause the
 * old `INVARIANT_CLAUSES` constant always did — unconditionally, without ever
 * reading `params`. That last part matters: this function does not decide
 * "is `recordState` an allowed filter for this scope and did the caller
 * supply one" and then act on it. It decides "is this the admin scope" FIRST,
 * and every branch below that check is unreachable for anything else. A
 * request built by hand against `/api/v1/competitions` with
 * `?recordState=DELETED` cannot influence this function at all — the
 * parameter is never even inspected outside the `admin` branch.
 *
 * `RECORD_STATE_SPEC` is also never added to `COMPETITION_FILTER_SPECS`
 * (see `ui.ts`), so it cannot appear in the public/management filter UI or
 * chip list either. The two protections are independent: this function is
 * what stops a crafted request; spec exclusion is what stops the UI from
 * ever offering the control in the first place.
 *
 * Soft-deleted rows are therefore not "filtered out" for non-admin scopes —
 * they are not part of the entity's visible universe at all, which is why
 * this contributes a base clause rather than an ordinary, droppable filter.
 */
function deletionClauses(
  scope: CompetitionSearchScope,
  params: RawSearchParams,
): readonly CompetitionWhere[] {
  if (scope !== "admin") {
    return [{ deletedAt: null }];
  }

  const state = readFilterValue(RECORD_STATE_SPEC, params);

  const wantsActive = state?.includes("ACTIVE") ?? false;
  const wantsDeleted = state?.includes("DELETED") ?? false;

  if (wantsDeleted && !wantsActive) {
    return [{ deletedAt: { not: null } }];
  }

  if (wantsActive && wantsDeleted) {
    // Both explicitly selected: no restriction on deletion state at all.
    return [];
  }

  // Absent, or ACTIVE alone: today's default, unchanged.
  return [{ deletedAt: null }];
}

/**
 * The lifecycle console's two out-of-band filters:
 * `registrationStartDate` range and automation state. Same shape as
 * `deletionClauses` above — scope checked FIRST, so `?registrationStartDateFrom=`
 * or `?automationState=` on any other scope's request is never even
 * inspected, let alone honoured.
 *
 * Neither spec is a registered filter (see `ui.ts`), because every scope
 * here declares `allowedFilters: "all"` — an ordinary registered filter
 * would be reachable from the public listing too.
 */
function lifecycleClauses(
  scope: CompetitionSearchScope,
  params: RawSearchParams,
): readonly CompetitionWhere[] {
  if (scope !== "lifecycle") {
    return [];
  }

  const clauses: CompetitionWhere[] = [];

  const range = readFilterValue(REGISTRATION_START_DATE_SPEC, params);
  if (range) {
    clauses.push({
      registrationStartDate: registrationStartDateFilter.toWhere(range),
    });
  }

  const automationState = readFilterValue(AUTOMATION_STATE_SPEC, params);
  const wantsEnabled = automationState?.includes("ENABLED") ?? false;
  const wantsDisabled = automationState?.includes("DISABLED") ?? false;

  if (wantsDisabled && !wantsEnabled) {
    clauses.push({ automaticStatusUpdatesDisabled: true });
  } else if (wantsEnabled && !wantsDisabled) {
    clauses.push({ automaticStatusUpdatesDisabled: false });
  }
  // Both, or neither: no restriction from this filter.

  return clauses;
}

/**
 * The lifecycle console's mandatory eligibility clauses — not a filter the
 * admin can toggle, but the business rule that automation may never propose
 * a change for a CANCELLED or automation-disabled competition. Always
 * applied for the `lifecycle` scope, regardless of what `automationState`
 * (above) is set to: selecting "Disabled" there narrows the *rows shown* for
 * inspection, while this clause is what guarantees the *actionable* set
 * those rows produce is always empty — the two compose via a plain AND,
 * which is exactly the "excluded from preview is not the same as excluded
 * from automation" distinction the feature specification draws.
 */
function automationEligibilityClauses(
  scope: CompetitionSearchScope,
): readonly CompetitionWhere[] {
  if (scope !== "lifecycle") {
    return [];
  }

  return [{ automaticStatusUpdatesDisabled: false }, NON_CANCELLED_CLAUSE];
}

/**
 * A fully resolved, ready-to-execute search.
 *
 * Deliberately carries no raw parameters beyond what the pure builder still
 * needs, and carries its base clauses already computed. Handing this to two
 * repository methods guarantees they build byte-identical `where` clauses.
 */
export interface CompetitionSearchPlan {
  readonly scope: CompetitionSearchScope;

  readonly params: RawSearchParams;

  readonly context: CompetitionSearchContext;

  /** Invariants plus every resolved clause, in composition order. */
  readonly baseClauses: readonly CompetitionWhere[];
}

export interface PlanCompetitionSearchArgs {
  readonly scope: CompetitionSearchScope;

  readonly params: RawSearchParams;

  readonly context?: CompetitionSearchContext;
}

/**
 * Resolves every resolvable filter for one request and returns an executable
 * plan.
 *
 * Scope-aware: `resolvableFiltersForScope` applies the same `allowedFilters`
 * rule to resolvable filters as to ordinary ones, so a scope that narrows what
 * may be filtered narrows both kinds consistently. With all three Competition
 * scopes currently allowing everything, location applies uniformly — which is
 * the intended behaviour and no longer something each service method has to
 * opt into.
 *
 * @throws ExternalServiceError when a lookup could not be completed.
 */
export async function planCompetitionSearch(
  args: PlanCompetitionSearchArgs,
): Promise<CompetitionSearchPlan> {
  const context = args.context ?? {};

  const resolvable = resolvableFiltersForScope(
    competitionSearchDefinition,
    args.scope,
  );

  const resolution = await resolveBaseClauses(resolvable, args.params);

  if (resolution.status === "FAILED") {
    // Two failures that must not share a message. Every other reason means "we
    // could not find out", and retrying genuinely may work. A missing radius
    // anchor means we *did* find out and there is no centre to measure from —
    // telling that user to try again in a moment would be false, and they would
    // keep trying.
    const anchorUnavailable =
      resolution.reason === CompetitionErrorCode.RADIUS_ANCHOR_UNAVAILABLE;

    throw new ExternalServiceError({
      code: anchorUnavailable
        ? CompetitionErrorCode.RADIUS_ANCHOR_UNAVAILABLE
        : CompetitionErrorCode.LOCATION_RESOLUTION_FAILED,
      message: anchorUnavailable
        ? "We don't have coordinates for that place, so we can't search by distance around it. Try a nearby city, or search without a distance."
        : "We could not look that location up right now. Please try again in a moment.",
      // The machine-readable half of that same distinction. `ExternalServiceError`
      // defaults to retryable, which is right for a lookup that failed and wrong
      // for a place that simply has no coordinates: a client honouring the flag
      // would retry forever against an answer that will never change.
      retryable: !anchorUnavailable,
      details: { filter: resolution.key, reason: resolution.reason },
    });
  }

  return {
    scope: args.scope,
    params: args.params,
    context,
    baseClauses: [
      ...deletionClauses(args.scope, args.params),
      ...lifecycleClauses(args.scope, args.params),
      ...automationEligibilityClauses(args.scope),
      ...resolution.clauses,
    ],
  };
}

/**
 * Turns a plan into a Prisma query.
 *
 * Pure and synchronous. Calling it twice with the same plan yields identical
 * output, which is exactly what the row query and the count query rely on.
 */
export function buildCompetitionQuery(plan: CompetitionSearchPlan) {
  return buildSearchQuery({
    definition: competitionSearchDefinition,
    params: plan.params,
    scope: plan.scope,
    context: plan.context,
    baseClauses: plan.baseClauses,
  });
}
