import { Prisma } from "@/generated/prisma";
import prisma from "@/lib/prisma";

import type { NormalizedLocation } from "../utils/normalize";
import {
  boundingBox,
  isValidCoordinates,
  type Coordinates,
} from "../utils/radius";

/**
 * Mean Earth radius in kilometres, matching `radius.ts`.
 *
 * Duplicated as a literal in the SQL below rather than bound as a parameter,
 * because it is a constant of the formula and not an input. It must stay equal
 * to `EARTH_RADIUS_KM`; `verify-radius-search.ts` cross-checks this SQL against
 * the TypeScript implementation on a fixture set precisely so a drift between
 * the two cannot go unnoticed.
 */
const EARTH_RADIUS_KM = 6371.0088;

/**
 * Corner-list size above which something is worth looking at.
 *
 * **Not a cap.** Nothing is truncated, and the query below has no `LIMIT`. This
 * threshold only decides whether a line is logged; the result set is identical
 * either way. A truncated exclusion list would be far worse than a slow one —
 * it would silently *admit* competitions beyond the radius — but an incomplete
 * list can never remove a valid result, which is the whole reason this query
 * returns the corners to exclude rather than the matches to include.
 */
const CORNER_OBSERVABILITY_THRESHOLD = 5_000;

export class LocationRepository {
  /**
   * Database Layer
   *
   * Responsibilities
   * ----------------
   * ✓ Build Prisma queries
   * ✓ Execute database operations
   * ✓ Return Prisma models
   *
   * Does NOT
   * ----------------
   * ✗ Business rules
   * ✗ Authentication
   * ✗ Authorization
   * ✗ DTO Mapping
   */
  static async create(
    data: NormalizedLocation,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ) {
    return db.location.create({
      data,
    });
  }

  static async update(
    id: string,
    data: NormalizedLocation,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ) {
    return db.location.update({
      where: {
        id,
      },
      data,
    });
  }

  /**
   * Deletes a location that is no longer referenced by any competition.
   *
   * Locations are private to the competition that created them, so an unlinked
   * row is unreachable rather than merely unused. The reference count is still
   * checked because a caller could pass an id that a future feature shares.
   */
  static async deleteIfOrphaned(
    id: string,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<boolean> {
    const references = await db.competitionLocation.count({
      where: {
        locationId: id,
      },
    });

    if (references > 0) {
      return false;
    }

    await db.location.delete({
      where: {
        id,
      },
    });

    return true;
  }

  // ==========================================================================
  // Radius search
  // ==========================================================================

  /**
   * Location ids inside the bounding box but **outside** the circle.
   *
   * =========================================================================
   * Why this returns the exclusions and not the matches
   * =========================================================================
   *
   * Prisma cannot express a circle: it has no trigonometric functions and no
   * raw escape inside `where`. So the exact predicate cannot live in the
   * competition query, and something has to cross from SQL into TypeScript.
   *
   * The obvious choice — return the ids *inside* the circle and filter with
   * `locationId: { in: … }` — is the wrong one, and dangerously so. That list
   * is authoritative: anything missing from it is a competition that silently
   * disappears from the results. It grows with the size of the answer, so it is
   * exactly the list one is tempted to cap, and capping it produces a search
   * that is quietly incomplete while looking entirely normal.
   *
   * Returning the *corners* inverts every one of those properties:
   *
   *   - the caller pairs it with the bounding box, which Prisma **can** express
   *     and which the database evaluates on `@@index([latitude, longitude])`;
   *   - the box is a strict superset of the circle, so no valid competition can
   *     ever be missed regardless of what this returns;
   *   - an incomplete exclusion list can only *over*-include a competition just
   *     beyond the radius — a visible, bounded, recoverable error rather than an
   *     invisible one;
   *   - the corner region is the box minus the circle, about 21% of box hits
   *     against 79% for the inside set, so the list is roughly four times
   *     smaller as well.
   *
   * Completeness is therefore structural. It does not depend on a cap being
   * generous enough, and there is no cap.
   *
   * =========================================================================
   * The predicate
   * =========================================================================
   *
   * Every interpolation is a bind parameter via `Prisma.sql`; there is no string
   * concatenation anywhere and `$queryRawUnsafe` is not used. `LEAST`/`GREATEST`
   * clamp the `acos` argument into [-1, 1] — without it, floating-point drift on
   * a location identical to the anchor pushes the argument past 1 and yields
   * `NaN`, which compares false and would drop the very competition at the
   * centre of the search.
   *
   * The comparison is strict (`>`), so a location at exactly the radius is
   * **not** excluded: "within 25 km" includes 25.000 km.
   *
   * =========================================================================
   * Which side of the bounding-box comparison carries the cast
   * =========================================================================
   *
   * `latitude` and `longitude` are `Decimal(9,6)` — `numeric` — and
   * `@@index([latitude, longitude])` is on those native columns. A predicate
   * written as `"latitude"::float8 BETWEEN …` is therefore **not sargable**:
   * the index is on the column, not on that expression, and Postgres falls
   * back to a sequential scan over the whole table.
   *
   * So the bounding box compares the **bare column** against a bound cast to
   * `numeric`. Casting the bound is not cosmetic — Prisma binds a JavaScript
   * number as `double precision`, and `numeric_column >= $1::float8` makes
   * Postgres promote the *column* to `float8` implicitly, which is the same
   * defect written a different way. Both sides must be `numeric` for the
   * index to be usable.
   *
   * The `::float8` casts inside the distance expression below stay: `numeric`
   * has no `sin`/`cos`/`radians`, and that term is evaluated per surviving
   * candidate row rather than used to find rows, so it costs no index.
   */
  static async findLocationIdsOutsideRadius(params: {
    center: Coordinates;
    radiusKm: number;
  }): Promise<string[]> {
    // A malformed anchor should never have reached here — the decoder and the
    // resolver both guard — but an unguarded NaN would make every comparison
    // below false and silently turn the radius off.
    if (!isValidCoordinates(params.center) || !(params.radiusKm > 0)) {
      return [];
    }

    const box = boundingBox(params.center, params.radiusKm);

    // A box spanning the antimeridian cannot be one range: `BETWEEN 179 AND
    // -179` matches nothing, which would silently empty the search for every
    // user near the date line.
    const longitudePredicate =
      box.longitude.kind === "wrapped"
        ? Prisma.sql`("longitude" >= ${box.longitude.min}::numeric OR "longitude" <= ${box.longitude.max}::numeric)`
        : Prisma.sql`("longitude" BETWEEN ${box.longitude.min}::numeric AND ${box.longitude.max}::numeric)`;

    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id"
      FROM "location"
      WHERE "latitude" IS NOT NULL
        AND "longitude" IS NOT NULL
        AND "latitude" BETWEEN ${box.minLatitude}::numeric AND ${box.maxLatitude}::numeric
        AND ${longitudePredicate}
        AND ${EARTH_RADIUS_KM} * acos(
              LEAST(1, GREATEST(-1,
                sin(radians(${params.center.latitude}::float8)) * sin(radians("latitude"::float8))
                + cos(radians(${params.center.latitude}::float8)) * cos(radians("latitude"::float8))
                  * cos(radians("longitude"::float8) - radians(${params.center.longitude}::float8))
              ))
            ) > ${params.radiusKm}::float8
    `;

    if (rows.length >= CORNER_OBSERVABILITY_THRESHOLD) {
      // Logged, never acted on. The complete list is returned regardless — see
      // the note on CORNER_OBSERVABILITY_THRESHOLD.
      console.error(
        `Radius search produced ${rows.length} corner exclusions ` +
          `(threshold ${CORNER_OBSERVABILITY_THRESHOLD}) for a ${params.radiusKm} km ` +
          "radius. Results are complete; this is a signal that the location " +
          "table has grown enough to justify an indexed spatial predicate.",
      );
    }

    return rows.map((row) => row.id);
  }
}
