/**
 * Competitions - Location as a registered, resolvable filter
 *
 * =============================================================================
 * Why this file exists
 * =============================================================================
 *
 * Location used to be handled by hand inside `CompetitionService.search`:
 * the service read `placeId` straight out of the raw parameters, resolved it,
 * built a clause and passed it along. That worked, and it had three defects
 * that were structural rather than incidental.
 *
 * 1. The registry did not know about it. Anything driven by the registry —
 *    the active-filter chips, Clear all, URL canonicalisation — was blind to
 *    location. A Clear all built on the registry would have left the user
 *    still filtered to a city, with no chip on screen explaining why.
 *
 * 2. Only one of three scopes applied it. `searchManageable` and
 *    `searchAdmin` never called the resolution step, so a `placeId` sent to
 *    the management or admin listing was accepted and silently discarded.
 *    Every new scope would have had to remember to opt in.
 *
 * 3. There was no shape for the next filter like it. Radius search, or any
 *    future filter needing a lookup, would have been a second hand-rolled
 *    special case in the service.
 *
 * Registering it as a resolvable filter fixes all three at once, and does so
 * by removing code rather than adding a special case: the service now resolves
 * whatever the registry declares, and location is simply the one entry that
 * currently exists.
 */

import type { Prisma } from "@/generated/prisma";
import {
  bindResolvableFilter,
  resolutionFailed,
  resolved,
  type BoundResolvableFilter,
  type FilterResolution,
  type PlaceSpec,
  type PlaceValue,
} from "@/lib/search";
import {
  LocationRepository,
  PlaceMatchService,
  boundingBox,
  isValidCoordinates,
  type Coordinates,
} from "@/modules/locations";

import { CompetitionErrorCode } from "../errors/error-code";
import {
  buildLocationClause,
  type RadiusRestriction,
} from "./location-clause";
import { competitionFilterSpecs } from "./ui";

type CompetitionWhere = Prisma.CompetitionWhereInput;

/**
 * What resolving a centre yields.
 *
 * The two fields are mutually exclusive in practice: a radius replaces the area
 * match, so whenever `radius` is set `searchAreaIds` is empty. Keeping them as
 * separate fields rather than a union keeps `buildLocationClause` readable, and
 * that module is where the exclusivity is actually enforced.
 */
interface ResolvedPlace {
  readonly searchAreaIds: readonly string[];

  readonly radius?: RadiusRestriction;
}

/**
 * Turns a centre and a distance into the two pieces the clause needs.
 *
 * Never throws — the resolvable-filter contract forbids it — so a database
 * failure here becomes `STORAGE_UNAVAILABLE` rather than an exception. That
 * matters: a radius that quietly degraded to "no exclusions" would return
 * competitions in the corners of the bounding box as though they were within
 * the radius, which is a wrong answer rather than a missing one.
 */
async function restrictionFor(
  center: Coordinates,
  radiusKm: number,
): Promise<FilterResolution<RadiusRestriction>> {
  if (!isValidCoordinates(center)) {
    return resolutionFailed(CompetitionErrorCode.RADIUS_ANCHOR_UNAVAILABLE);
  }

  try {
    const excludedLocationIds =
      await LocationRepository.findLocationIdsOutsideRadius({
        center,
        radiusKm,
      });

    return resolved({
      box: boundingBox(center, radiusKm),
      excludedLocationIds,
    });
  } catch (error) {
    console.error("Could not compute a radius restriction.", error);

    return resolutionFailed("STORAGE_UNAVAILABLE");
  }
}

/**
 * Consults whatever authority the centre requires.
 *
 * Never throws. A provider outage returns `FAILED` with the provider's own
 * reason, so the caller can distinguish "we could not find out" from "there is
 * nothing there" and answer each honestly. Throwing would collapse that
 * distinction into a generic error, and the most likely handling of a generic
 * error — render an empty list — is precisely the wrong answer.
 *
 * An empty `searchAreaIds` is a *success*. It means the place is real, the
 * lookup worked, and no competition has been recorded there yet. That produces
 * an unsatisfiable clause and an honest empty page.
 *
 * A **device centre consults nothing at all.** It carries its own coordinates,
 * so there is no place to resolve, no provider call to bill, and no cache to
 * consult — and deliberately no reverse geocoding either. A device position is
 * an ephemeral search input, not a place, and turning it into one would create
 * a second way places enter the system.
 */
async function resolvePlace(
  value: PlaceValue,
): Promise<FilterResolution<ResolvedPlace>> {
  const { radiusKm } = value;

  if (value.center.kind === "device") {
    // The decoder guarantees a device centre never exists without a radius —
    // it would mean nothing on its own — so this is unreachable defensively
    // rather than a case with meaningful behaviour.
    if (radiusKm === undefined) {
      return resolved({ searchAreaIds: [] });
    }

    const restriction = await restrictionFor(value.center, radiusKm);

    return restriction.status === "FAILED"
      ? restriction
      : resolved({ searchAreaIds: [], radius: restriction.value });
  }

  const resolution = await PlaceMatchService.resolve({
    placeId: value.center.id,
    // Only asked for when a radius is actually in play, so an ordinary area
    // search neither requests the anchor nor re-resolves a cached row missing
    // one.
    requireAnchor: radiusKm !== undefined,
  });

  if (resolution.status === "RESOLUTION_FAILED") {
    return resolutionFailed(resolution.reason);
  }

  if (radiusKm === undefined) {
    return resolved({ searchAreaIds: resolution.searchAreaIds });
  }

  // The place is real and resolved, but the provider gave no coordinates for
  // it. Falling back to the search-area match would answer a distance question
  // with an identity match and give the user no way to notice — so this fails
  // loudly instead, with a reason that says retrying will not help.
  if (resolution.anchor === null) {
    return resolutionFailed(CompetitionErrorCode.RADIUS_ANCHOR_UNAVAILABLE);
  }

  const restriction = await restrictionFor(resolution.anchor, radiusKm);

  return restriction.status === "FAILED"
    ? restriction
    : // Search areas are deliberately discarded: a radius replaces the area
      // match rather than widening it.
      resolved({ searchAreaIds: [], radius: restriction.value });
}

/**
 * The location filter, bound and ready for the registry.
 *
 * Note that `toWhere` receives both the resolution and the original decoded
 * value. The area ids come from the lookup; `includeOnline` is a modifier the
 * user set that survives resolution untouched. Keeping both available is why
 * `ResolvableFilterDescriptor.toWhere` takes two arguments — a filter's
 * modifiers should not have to be smuggled through its resolution result.
 */
export const competitionLocationFilter: BoundResolvableFilter<CompetitionWhere> =
  bindResolvableFilter<CompetitionWhere, PlaceSpec, ResolvedPlace>({
    spec: competitionFilterSpecs.location,

    resolve: resolvePlace,

    toWhere: (resolvedPlace, value) =>
      buildLocationClause({
        searchAreaIds: resolvedPlace.searchAreaIds,
        includeOnline: value.includeOnline,
        radius: resolvedPlace.radius,
      }),
  });
