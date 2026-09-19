import { CompetitionMode, type Prisma } from "@/generated/prisma";
import type { BoundingBox } from "@/modules/locations";

type CompetitionWhere = Prisma.CompetitionWhereInput;

/**
 * A condition no competition can satisfy.
 *
 * Prisma treats `{ in: [] }` as matching zero rows — the property that makes
 * this work, and the same property that makes an accidental empty `in`
 * elsewhere so dangerous. Here it is exactly what is wanted: a location that
 * resolved successfully but matched no stored area must produce an explicit
 * empty result, not an absent restriction.
 *
 * That is the difference between "no competitions here" and "here is
 * everything", and it is the single most important line in this file.
 */
const MATCHES_NOTHING: CompetitionWhere = { id: { in: [] } };

/**
 * A distance restriction, in the two pieces Prisma and SQL each own.
 *
 * =============================================================================
 * Why a box plus an exclusion list, and not simply a list of matches
 * =============================================================================
 *
 * Prisma cannot express a circle — no trigonometry, and no raw escape inside
 * `where`. Something therefore has to be computed outside the query. The
 * question is only *which* something, and the two candidates fail very
 * differently:
 *
 *   - A list of the locations **inside** the circle is authoritative. Anything
 *     missing from it is a competition that vanishes from the results. It is
 *     also the list that grows with the size of the answer, so it is the one
 *     you are tempted to cap — and capping it yields a search that is quietly
 *     incomplete while looking perfectly normal.
 *
 *   - A **box plus the corners to exclude** cannot fail that way. The box is a
 *     strict superset of the circle and is evaluated by the database on
 *     `@@index([latitude, longitude])`, so no valid competition can be missed
 *     no matter what the exclusion list contains. An incomplete exclusion list
 *     can only admit a competition slightly beyond the radius — visible,
 *     bounded, and recoverable.
 *
 * Completeness is therefore a property of the *shape*, not of a limit being
 * generous enough. There is no cap anywhere on this path.
 */
export interface RadiusRestriction {
  readonly box: BoundingBox;

  /** Locations inside the box but outside the circle. Never truncated. */
  readonly excludedLocationIds: readonly string[];
}

export interface LocationClauseInput {
  /**
   * Search areas the selected place resolved to. May legitimately be empty.
   *
   * Ignored entirely when `radius` is set — see `buildLocationClause`.
   */
  readonly searchAreaIds: readonly string[];

  /** Whether online competitions should be returned alongside the centre. */
  readonly includeOnline: boolean;

  /** Present only when the user asked for a distance. */
  readonly radius?: RadiusRestriction;
}

/**
 * The bounding-box half of a radius, as a Prisma predicate on `Location`.
 *
 * The wrapped case is not an optimisation: a box centred near ±180° runs from
 * +179 east to -179, and `longitude BETWEEN 179 AND -179` matches nothing at
 * all. Expressing it as one range would produce a permanently, silently empty
 * search for everyone near the date line.
 */
function boxPredicate(box: BoundingBox): Prisma.LocationWhereInput {
  const latitude = {
    latitude: { gte: box.minLatitude, lte: box.maxLatitude },
  };

  if (box.longitude.kind === "contiguous") {
    return {
      ...latitude,
      longitude: { gte: box.longitude.min, lte: box.longitude.max },
    };
  }

  return {
    ...latitude,
    OR: [
      { longitude: { gte: box.longitude.min } },
      { longitude: { lte: box.longitude.max } },
    ],
  };
}

function radiusArm(radius: RadiusRestriction): CompetitionWhere {
  return {
    locations: {
      some: {
        location: {
          ...boxPredicate(radius.box),

          // The exact refinement. Omitted when there is nothing to exclude,
          // rather than emitted as an empty `notIn` — which is harmless here
          // but would read as though something were being excluded.
          ...(radius.excludedLocationIds.length > 0 && {
            id: { notIn: [...radius.excludedLocationIds] },
          }),
        },
      },
    },
  };
}

function areaArm(searchAreaIds: readonly string[]): CompetitionWhere {
  return {
    locations: {
      some: {
        location: {
          searchAreas: {
            some: { searchAreaId: { in: [...searchAreaIds] } },
          },
        },
      },
    },
  };
}

/**
 * Builds the restriction for a resolved centre.
 *
 * Always returns a clause. There is no "no restriction" outcome, because this
 * is only ever called once a centre has actually been selected and resolved —
 * `bindResolvableFilter` handles the absent case before reaching here.
 *
 * The clause is applied as a *base* clause rather than a filter clause, so it
 * cannot be dropped by the engine's "empty means absent" rule. See the note in
 * `src/lib/search/resolve.ts` for why that distinction exists.
 *
 * =============================================================================
 * Radius replaces the area match; it does not widen it
 * =============================================================================
 *
 * Without a radius, matching is by search-area id and never by text.
 * Containment was materialized at ingestion, so selecting a city matches every
 * location that recorded a link to it, while selecting a neighbourhood matches
 * only locations linked to that neighbourhood — expansion runs downward, never
 * up or sideways. That behaviour is untouched.
 *
 * With a radius, the area arm is dropped and matching is purely by distance.
 * "Within 25 km" is a question about geography, and answering it partly by
 * stored identity would produce a result set that is neither: a competition
 * tagged "Pune District" but sitting 90 km away would come back from a 25 km
 * search, and nothing on the page would explain why.
 *
 * The deliberate cost is that a competition whose location has no coordinates
 * cannot match a radius search, even one centred on its own city. That is real,
 * and it is why `report-location-coverage.ts` exists — the gap is measured
 * rather than hidden.
 *
 * `includeOnline` stays an OR arm on this same clause in both modes. It has to
 * live here: as a separately ANDed condition it would cancel itself, because an
 * online competition has no location row and so can never satisfy any
 * geographic predicate. Including online results would then silently do nothing
 * the moment a radius was set.
 */
export function buildLocationClause(
  input: LocationClauseInput,
): CompetitionWhere {
  const arms: CompetitionWhere[] = [];

  if (input.radius) {
    arms.push(radiusArm(input.radius));
  } else if (input.searchAreaIds.length > 0) {
    arms.push(areaArm(input.searchAreaIds));
  } else {
    arms.push(MATCHES_NOTHING);
  }

  // Online competitions have no location, so they can never satisfy a
  // geographic condition. Including them is an explicit user choice rather
  // than something the location filter decides on their behalf — and it still
  // holds when the centre matched nothing, which correctly yields online-only
  // results rather than an empty page.
  if (input.includeOnline) {
    arms.push({ mode: CompetitionMode.ONLINE });
  }

  // A single arm is emitted bare rather than wrapped in a one-element `OR`, so
  // that a radius-free search produces a clause byte-identical to the one this
  // module produced before radius existed.
  return arms.length === 1 ? arms[0] : { OR: arms };
}
