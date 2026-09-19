/**
 * Locations - Radius primitives (PURE)
 *
 * =============================================================================
 * Why this is a separate, dependency-free module
 * =============================================================================
 *
 * Everything here is a pure function of its arguments: no database, no network,
 * no clock, no environment. That is the same discipline `extract-search-areas.ts`
 * follows, and for the same reason — the interesting failures of geographic code
 * are *numerical*, and numerical failures are only cheap to find when the code
 * under test can be called ten thousand times in a loop without a fixture.
 *
 * =============================================================================
 * The two halves of a radius query, and why the box exists
 * =============================================================================
 *
 * Prisma cannot express a circle. It has no trigonometric functions and no raw
 * escape inside `where`, so the exact predicate cannot live in the query the
 * competition listing runs.
 *
 * What Prisma *can* express is a latitude/longitude range — a **box**. The box
 * that circumscribes a circle is a strict superset of it, which is the property
 * everything downstream depends on:
 *
 *   - the box is applied in the database, on `@@index([latitude, longitude])`,
 *     as part of the ordinary competition query, so filtering, sorting,
 *     counting and pagination all stay server-side;
 *   - because it is a *superset*, it can never omit a competition that belongs
 *     in the circle;
 *   - the only inaccuracy is over-inclusion, in the four corners, and that is
 *     removed by an exclusion list computed in SQL.
 *
 * Over-inclusion is a recoverable error. Under-inclusion is not — it is a
 * silently incomplete search. The whole design leans on which of the two the
 * box can produce, so `boundingBox` deliberately errs outward: see `PADDING`.
 */

/**
 * Mean Earth radius, in kilometres (IUGG).
 *
 * A sphere, not an ellipsoid. Haversine on a sphere is within ~0.5% of WGS-84,
 * which is ~125 m at 25 km — three orders of magnitude finer than the coarsest
 * distinction any radius step in this product makes.
 */
const EARTH_RADIUS_KM = 6371.0088;

/** Kilometres per degree of latitude. Constant everywhere on a sphere. */
const KM_PER_DEGREE_LATITUDE = (Math.PI * EARTH_RADIUS_KM) / 180;

/**
 * The product ceiling on a search radius.
 *
 * A deliberate product constraint, not a performance workaround: beyond roughly
 * this distance the question stops being "what can I travel to" and becomes
 * "what is in my region", which is what the SearchArea identity filter already
 * answers better.
 */
export const MAX_RADIUS_KM = 200;

/** The smallest radius worth offering. Below this a radius is a pin, not an area. */
export const MIN_RADIUS_KM = 1;

/**
 * The values the interface offers.
 *
 * A UI affordance, not a contract: `clampRadiusKm` accepts any integer in range,
 * so a hand-edited URL asking for 37 km is honoured rather than rejected. Making
 * the steps authoritative would mean a shared link could be silently rewritten.
 */
export const RADIUS_STEPS: readonly number[] = [5, 10, 25, 50, 100, 200];

/**
 * Outward padding applied to every computed box edge, in degrees.
 *
 * ~1 cm. Guarantees the box remains a strict superset of the circle even after
 * the accumulated floating-point error of the trigonometry below, which can
 * otherwise place a point that is exactly on the circle a few ulps outside the
 * box. Erring outward costs a handful of corner rows the exclusion step removes
 * anyway; erring inward would silently drop a valid competition.
 */
const PADDING = 1e-7;

export interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
}

/**
 * The longitude half of a bounding box.
 *
 * Two shapes rather than a min/max pair, because a box spanning the
 * antimeridian genuinely cannot be expressed as one range: near Fiji the box
 * runs from +179 east to -179, and `longitude BETWEEN 179 AND -179` matches
 * nothing at all. Encoding that as a variant makes it impossible for a caller
 * to forget the case — the type will not let them read a `min`/`max` without
 * deciding what `kind` means.
 */
export type LongitudeRange =
  /** `longitude >= min AND longitude <= max` */
  | { readonly kind: "contiguous"; readonly min: number; readonly max: number }
  /** `longitude >= min OR longitude <= max` — the box wraps the antimeridian. */
  | { readonly kind: "wrapped"; readonly min: number; readonly max: number };

export interface BoundingBox {
  readonly minLatitude: number;
  readonly maxLatitude: number;
  readonly longitude: LongitudeRange;
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Whether a pair is a usable point on Earth. Rejects NaN and Infinity. */
export function isValidCoordinates(value: Coordinates): boolean {
  return (
    Number.isFinite(value.latitude) &&
    Number.isFinite(value.longitude) &&
    value.latitude >= -90 &&
    value.latitude <= 90 &&
    value.longitude >= -180 &&
    value.longitude <= 180
  );
}

/**
 * Normalises a radius, or rejects it.
 *
 * Returns `null` for anything that is not a positive integer — `0`, negatives,
 * `2.5`, `NaN`, `Infinity`, `1e999`. A rejected radius makes the filter behave
 * as though no radius were given at all, which is the codebase's standing policy
 * for a hand-edited or stale URL: degrade to something sane, never error.
 *
 * A value above the ceiling is **clamped, not rejected**. Rejecting it would
 * silently *narrow* a search the user was explicitly trying to widen, which is
 * the one direction this function must never fail in.
 */
export function clampRadiusKm(value: number): number | null {
  if (!Number.isSafeInteger(value) || value < MIN_RADIUS_KM) {
    return null;
  }

  return Math.min(value, MAX_RADIUS_KM);
}

/**
 * Great-circle distance between two points, in kilometres.
 *
 * Uses the haversine form with `atan2` rather than the spherical law of
 * cosines. The difference matters at exactly one point that this product hits
 * constantly: **two identical coordinates**. Under the law of cosines the inner
 * term evaluates to 1 ± a few ulps, and `acos` of anything above 1 is `NaN` —
 * so a competition at the precise centre of the search would vanish from its own
 * result set. Haversine's `a` is 0 there, and `atan2(0, 1)` is 0, so the answer
 * is exactly zero by construction rather than by a guard.
 *
 * The equivalent SQL predicate cannot use this form as conveniently and clamps
 * instead; `verify-radius-math.ts` cross-checks the two against each other.
 */
export function haversineKm(from: Coordinates, to: Coordinates): number {
  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);

  const deltaLatitude = toRadians(to.latitude - from.latitude);
  const deltaLongitude = toRadians(to.longitude - from.longitude);

  const sinHalfLatitude = Math.sin(deltaLatitude / 2);
  const sinHalfLongitude = Math.sin(deltaLongitude / 2);

  const a =
    sinHalfLatitude * sinHalfLatitude +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      sinHalfLongitude *
      sinHalfLongitude;

  // `a` is mathematically in [0, 1]; floating point can nudge it a hair past 1
  // for antipodal points. Clamping keeps `sqrt(1 - a)` real.
  const bounded = clamp(a, 0, 1);

  return (
    2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(bounded), Math.sqrt(1 - bounded))
  );
}

/**
 * The smallest latitude/longitude box that fully contains the circle.
 *
 * **The postcondition that matters: every point within `radiusKm` of `center`
 * lies inside this box.** The reverse does not hold — the corners of the box are
 * up to √2 × radius from the centre — and removing those corners is the job of
 * the exact distance step, not of this function.
 *
 * Two degenerate cases are handled rather than assumed away:
 *
 *   - **Poles.** Δlongitude scales with `1 / cos(latitude)`, which diverges as
 *     the box reaches a pole. When it does, every meridian is inside the circle,
 *     so the longitude range opens to the whole world and the exact distance
 *     test does the remaining work.
 *   - **Antimeridian.** A box centred near ±180° wraps. It is returned as a
 *     `wrapped` range, which the caller must read as an OR of two ranges. A
 *     naive `BETWEEN` would match nothing and produce a silently empty search
 *     for every user in Fiji or New Zealand.
 */
export function boundingBox(
  center: Coordinates,
  radiusKm: number,
): BoundingBox {
  const deltaLatitude = radiusKm / KM_PER_DEGREE_LATITUDE + PADDING;

  const minLatitude = center.latitude - deltaLatitude;
  const maxLatitude = center.latitude + deltaLatitude;

  // Reaching a pole means the circle encloses one, and every longitude with it.
  if (minLatitude <= -90 || maxLatitude >= 90) {
    return {
      minLatitude: Math.max(-90, minLatitude),
      maxLatitude: Math.min(90, maxLatitude),
      longitude: { kind: "contiguous", min: -180, max: 180 },
    };
  }

  // The widest longitude span occurs at the latitude closest to a pole, not at
  // the centre — using the centre's own cosine would produce a box that is too
  // narrow at its far edge and could clip valid points.
  const widestLatitude = Math.max(Math.abs(minLatitude), Math.abs(maxLatitude));

  const cosine = Math.cos(toRadians(widestLatitude));

  // Guarded even though the pole branch above should have caught it: a cosine
  // at or below zero would divide into Infinity and poison every comparison
  // downstream.
  if (cosine <= Number.EPSILON) {
    return {
      minLatitude,
      maxLatitude,
      longitude: { kind: "contiguous", min: -180, max: 180 },
    };
  }

  const deltaLongitude = radiusKm / (KM_PER_DEGREE_LATITUDE * cosine) + PADDING;

  // A span of half the globe or more in each direction covers everything, and
  // normalising it would otherwise produce a wrapped range that overlaps itself.
  if (deltaLongitude >= 180) {
    return {
      minLatitude,
      maxLatitude,
      longitude: { kind: "contiguous", min: -180, max: 180 },
    };
  }

  const rawMin = center.longitude - deltaLongitude;
  const rawMax = center.longitude + deltaLongitude;

  if (rawMin < -180 || rawMax > 180) {
    return {
      minLatitude,
      maxLatitude,
      longitude: {
        kind: "wrapped",
        min: rawMin < -180 ? rawMin + 360 : rawMin,
        max: rawMax > 180 ? rawMax - 360 : rawMax,
      },
    };
  }

  return {
    minLatitude,
    maxLatitude,
    longitude: { kind: "contiguous", min: rawMin, max: rawMax },
  };
}

/**
 * Whether a point falls inside a box.
 *
 * Exists so the property test can assert the superset postcondition against the
 * same reading of a `wrapped` range that the query layer uses, rather than
 * against a second interpretation written for the test.
 */
export function isInsideBoundingBox(
  box: BoundingBox,
  point: Coordinates,
): boolean {
  if (point.latitude < box.minLatitude || point.latitude > box.maxLatitude) {
    return false;
  }

  return box.longitude.kind === "contiguous"
    ? point.longitude >= box.longitude.min &&
        point.longitude <= box.longitude.max
    : point.longitude >= box.longitude.min ||
        point.longitude <= box.longitude.max;
}

/**
 * Rounds a device coordinate before it is written to a URL.
 *
 * Four decimal places is about 11 m — far finer than any radius this product
 * offers, and coarse enough that a shared or logged link does not carry a
 * person's precise position. Applied where the value is written, never where it
 * is read: rounding on read would silently alter a coordinate someone typed.
 */
export function roundDeviceCoordinate(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
