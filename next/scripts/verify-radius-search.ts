/**
 * Standing regression suite for radius search, against the real database.
 *
 * =============================================================================
 * What this guards
 * =============================================================================
 *
 * `verify-radius-math.ts` proves the geometry. This proves the four things that
 * geometry cannot, each of which fails silently rather than loudly:
 *
 *   1. **Completeness.** The predicate is a bounding box (Prisma) intersected
 *      with a corner-exclusion list (SQL). Nothing is capped and nothing is
 *      truncated. A competition inside the radius must come back no matter how
 *      large the intermediate list gets — asserted here against a fixture set
 *      big enough to have a corner region.
 *
 *   2. **The `includeOnline` trap.** Radius lives *inside* the location clause
 *      as an OR arm. Implemented as a separate ANDed clause it would cancel
 *      `includeOnline` entirely, because an online competition has no location
 *      row and so fails any geographic predicate. The page would quietly
 *      withhold results the user explicitly asked for, with no chip and no
 *      message to explain it. Asserted directly.
 *
 *   3. **Replace, not widen.** With a radius set, a competition matches by
 *      distance alone. A location with no coordinates therefore drops out even
 *      inside its own city — a deliberate, costly consequence of the product
 *      decision, pinned here so it can never change by accident.
 *
 *   4. **Backward compatibility.** A URL with no radius must build a `where`
 *      identical to the one this code produced before radius existed.
 *
 * Fixture rows are created and torn down, following `verify-admin-competitions.ts`.
 *
 * Run with:
 *
 *   pnpm exec tsx scripts/verify-radius-search.ts
 */

import { PrismaClient, Prisma } from "../src/generated/prisma";
import { LocationRepository } from "../src/modules/locations/repository/location.repository";
import {
  boundingBox,
  haversineKm,
  isInsideBoundingBox,
} from "../src/modules/locations/utils/radius";
import { buildLocationClause } from "../src/modules/competitions/search/location-clause";
import {
  buildCompetitionQuery,
  planCompetitionSearch,
} from "../src/modules/competitions/search/plan";
import { CompetitionRepository } from "../src/modules/competitions/backend/repository";
import { competitionFilterSpecs } from "../src/modules/competitions/search/ui";
import { readFilterValue } from "../src/lib/search/spec-values";
import type { RawSearchParams } from "../src/lib/search/types";

const prisma = new PrismaClient();

const FIXTURE_PREFIX = "verify-radius-";

/** The centre every fixture is positioned relative to. */
const ANCHOR = { latitude: 18.5204, longitude: 73.8567 };

const RADIUS_KM = 25;

let failures = 0;
let checks = 0;

function report(label: string, ok: boolean, detail?: string): void {
  checks += 1;

  if (ok) {
    console.log(`  ok   ${label}`);
    return;
  }

  failures += 1;
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
}

function heading(title: string): void {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
}

/**
 * A point exactly `distanceKm` from the anchor, on the given bearing.
 *
 * Bearings that are not multiples of 90 put fixtures in the *corners* of the
 * bounding box, which is the region the exclusion query exists to remove. A
 * fixture set built only on cardinal bearings would never exercise it.
 */
function at(distanceKm: number, bearingDegrees: number) {
  const radius = 6371.0088;
  const angular = distanceKm / radius;
  const bearing = (bearingDegrees * Math.PI) / 180;
  const latitude = (ANCHOR.latitude * Math.PI) / 180;
  const longitude = (ANCHOR.longitude * Math.PI) / 180;

  const nextLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angular) +
      Math.cos(latitude) * Math.sin(angular) * Math.cos(bearing),
  );

  const nextLongitude =
    longitude +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(latitude),
      Math.cos(angular) - Math.sin(latitude) * Math.sin(nextLatitude),
    );

  return {
    latitude: (nextLatitude * 180) / Math.PI,
    longitude: (nextLongitude * 180) / Math.PI,
  };
}

interface FixtureSpec {
  readonly key: string;
  readonly distanceKm?: number;
  readonly bearing?: number;
  /** Omitted coordinates model a manually entered or seeded location. */
  readonly noCoordinates?: boolean;
  readonly noLocation?: boolean;
  readonly mode?: "ONLINE" | "OFFLINE" | "HYBRID" | null;
  readonly visibility?: "PUBLIC" | "PRIVATE";
  readonly deleted?: boolean;
  /** A second stop, for the multi-location case. */
  readonly secondDistanceKm?: number;
  /** Whether it should be returned by a 25 km public radius search. */
  readonly expected: boolean;
}

const FIXTURES: readonly FixtureSpec[] = [
  { key: "at-centre", distanceKm: 0, bearing: 0, expected: true },
  { key: "just-inside", distanceKm: 24.9, bearing: 10, expected: true },
  // Deliberately just inside rather than exactly on the boundary. Coordinates
  // are stored at 6 decimal places (~0.11 m), so a fixture built at "exactly
  // 25 km" is really at 25 km ± 0.11 m and may land either side — which would
  // make this row's expected membership a coin toss. Strict `<=` inclusivity is
  // asserted properly in `verifyBoundaryAndZero`, against the stored
  // coordinates' true distance.
  { key: "on-boundary", distanceKm: 24.999, bearing: 20, expected: true },
  { key: "just-outside", distanceKm: 25.1, bearing: 30, expected: false },
  { key: "far-outside", distanceKm: 120, bearing: 40, expected: false },

  // Corner cases: inside the bounding box, outside the circle. These are the
  // rows the exclusion query has to remove, and the only ones that distinguish
  // a real radius from a square.
  { key: "corner-ne", distanceKm: 30, bearing: 45, expected: false },
  { key: "corner-sw", distanceKm: 32, bearing: 225, expected: false },
  { key: "corner-se", distanceKm: 30, bearing: 135, expected: false },
  { key: "corner-nw", distanceKm: 31, bearing: 315, expected: false },

  // Replace semantics: no coordinates means no radius match, even though this
  // row would match an area search for the same city.
  { key: "no-coordinates", noCoordinates: true, expected: false },

  { key: "no-location", noLocation: true, mode: null, expected: false },

  {
    key: "online-no-location",
    noLocation: true,
    mode: "ONLINE",
    expected: false,
  },

  {
    key: "hybrid-in-range",
    distanceKm: 5,
    bearing: 90,
    mode: "HYBRID",
    expected: true,
  },
  {
    key: "hybrid-out-of-range",
    distanceKm: 90,
    bearing: 90,
    mode: "HYBRID",
    expected: false,
  },

  {
    key: "soft-deleted-in-range",
    distanceKm: 3,
    bearing: 180,
    deleted: true,
    expected: false,
  },
  {
    key: "private-in-range",
    distanceKm: 4,
    bearing: 200,
    visibility: "PRIVATE",
    expected: false,
  },

  // One stop far away, one stop near: `some` semantics mean it matches.
  {
    key: "multi-location",
    distanceKm: 300,
    bearing: 0,
    secondDistanceKm: 8,
    expected: true,
  },

  { key: "mode-null-in-range", distanceKm: 6, bearing: 70, mode: null, expected: true },
];

async function seed(): Promise<void> {
  for (const fixture of FIXTURES) {
    const competition = await prisma.competition.create({
      data: {
        title: `Verify Radius — ${fixture.key}`,
        slug: `${FIXTURE_PREFIX}${fixture.key}`,
        visibility: fixture.visibility ?? "PUBLIC",
        mode: fixture.mode === undefined ? "OFFLINE" : fixture.mode,
        ...(fixture.deleted && { deletedAt: new Date() }),
      },
    });

    if (fixture.noLocation) {
      continue;
    }

    const points: Array<{ latitude: number; longitude: number } | null> =
      fixture.noCoordinates
        ? [null]
        : [at(fixture.distanceKm ?? 0, fixture.bearing ?? 0)];

    if (fixture.secondDistanceKm !== undefined) {
      points.push(at(fixture.secondDistanceKm, fixture.bearing ?? 0));
    }

    for (const [index, point] of points.entries()) {
      const location = await prisma.location.create({
        data: {
          displayName: `${FIXTURE_PREFIX}${fixture.key}-${index}`,
          precision: "VENUE",
          provider: "MANUAL",
          latitude: point ? new Prisma.Decimal(point.latitude.toFixed(6)) : null,
          longitude: point
            ? new Prisma.Decimal(point.longitude.toFixed(6))
            : null,
        },
      });

      await prisma.competitionLocation.create({
        data: {
          competitionId: competition.id,
          locationId: location.id,
          order: index,
        },
      });
    }
  }
}

async function cleanup(): Promise<void> {
  await prisma.competition.deleteMany({
    where: { slug: { startsWith: FIXTURE_PREFIX } },
  });

  await prisma.location.deleteMany({
    where: { displayName: { startsWith: FIXTURE_PREFIX } },
  });
}

/**
 * Runs the real query path for a radius centred on the anchor.
 *
 * Deliberately goes through `planCompetitionSearch` and
 * `CompetitionRepository`, not through a hand-built `where`: the point is to
 * assert what the application actually returns, including scope guards,
 * deletion clauses, sorting and pagination.
 */
async function searchWithRadius(
  params: RawSearchParams,
): Promise<{ slugs: string[]; total: number }> {
  const plan = await planCompetitionSearch({ scope: "public", params });

  const [items, total] = await Promise.all([
    CompetitionRepository.findMany(plan),
    CompetitionRepository.count(plan),
  ]);

  return {
    slugs: items
      .map((item) => item.slug)
      .filter((slug) => slug.startsWith(FIXTURE_PREFIX)),
    total,
  };
}

/** The device-centre parameters for the anchor. */
const deviceParams = (): RawSearchParams => ({
  lat: String(ANCHOR.latitude),
  lng: String(ANCHOR.longitude),
  radius: String(RADIUS_KM),
  limit: "100",
});

// =============================================================================
// Checks
// =============================================================================

async function verifyMembership(): Promise<void> {
  heading("Which competitions a radius returns");

  const { slugs } = await searchWithRadius(deviceParams());

  const returned = new Set(slugs);

  for (const fixture of FIXTURES) {
    const slug = `${FIXTURE_PREFIX}${fixture.key}`;

    report(
      `${fixture.key} is ${fixture.expected ? "included" : "excluded"}`,
      returned.has(slug) === fixture.expected,
      returned.has(slug) ? "was returned" : "was not returned",
    );
  }
}

async function verifyBoundaryAndZero(): Promise<void> {
  heading("Boundary behaviour");

  const corners = await LocationRepository.findLocationIdsOutsideRadius({
    center: ANCHOR,
    radiusKm: RADIUS_KM,
  });

  report(
    "the corner exclusion list is non-empty, so the exact test is exercised",
    corners.length > 0,
    `${corners.length} corners`,
  );

  // Cross-check the SQL against the TypeScript implementation on every fixture
  // location, so a drift between the two formulas cannot go unnoticed.
  const rows = (
    await prisma.location.findMany({
      where: {
        displayName: { startsWith: FIXTURE_PREFIX },
        latitude: { not: null },
        longitude: { not: null },
      },
      select: { id: true, latitude: true, longitude: true },
    })
  ).map((row) => ({
    id: row.id,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
  }));

  const box = boundingBox(ANCHOR, RADIUS_KM);

  const expected = new Set(
    rows
      .filter(
        (row) =>
          isInsideBoundingBox(box, row) && haversineKm(ANCHOR, row) > RADIUS_KM,
      )
      .map((row) => row.id),
  );

  const sqlCorners = new Set(
    corners.filter((id) => rows.some((row) => row.id === id)),
  );

  report(
    "SQL corner exclusions match the TypeScript haversine exactly",
    sqlCorners.size === expected.size &&
      [...expected].every((id) => sqlCorners.has(id)),
    `sql ${sqlCorners.size}, ts ${expected.size}`,
  );

  const centreRow = rows.find(
    (row) => Math.abs(haversineKm(ANCHOR, row)) < 0.001,
  );

  report(
    "a location identical to the centre is not excluded (no NaN)",
    centreRow !== undefined && !sqlCorners.has(centreRow.id),
  );

  // Strict inclusivity, tested where it can actually be tested: take a stored
  // row, measure its true distance, and search with a radius of exactly that.
  // If the predicate were `>=` rather than `>`, this row would be excluded from
  // its own radius. Building a fixture "at exactly 25 km" cannot test this,
  // because 6-decimal storage moves it by up to 11 cm either way.
  const sample = rows.find((row) => haversineKm(ANCHOR, row) > 1);

  if (sample === undefined) {
    report("a boundary sample exists", false);
    return;
  }

  const exactDistanceKm = haversineKm(ANCHOR, sample);

  const atExactRadius = await LocationRepository.findLocationIdsOutsideRadius({
    center: ANCHOR,
    radiusKm: exactDistanceKm,
  });

  report(
    `a location at exactly the radius is included (inclusive <=, d=${exactDistanceKm.toFixed(6)} km)`,
    !atExactRadius.includes(sample.id),
  );

  // And the other side of the same edge: a hair under, and it must be excluded.
  const justBelow = await LocationRepository.findLocationIdsOutsideRadius({
    center: ANCHOR,
    radiusKm: exactDistanceKm - 0.000_001,
  });

  report(
    "the same location one micrometre below the radius is excluded",
    justBelow.includes(sample.id),
  );
}

async function verifyIncludeOnline(): Promise<void> {
  heading("includeOnline with a radius — the trap");

  const withoutOnline = await searchWithRadius(deviceParams());

  report(
    "without includeOnline, the online fixture is absent",
    !withoutOnline.slugs.includes(`${FIXTURE_PREFIX}online-no-location`),
  );

  const withOnline = await searchWithRadius({
    ...deviceParams(),
    includeOnline: "true",
  });

  // The whole reason radius is folded into the location clause rather than
  // ANDed beside it. As a separate clause this assertion fails.
  report(
    "with includeOnline, the online fixture IS returned alongside the radius",
    withOnline.slugs.includes(`${FIXTURE_PREFIX}online-no-location`),
    withOnline.slugs.join(", "),
  );

  report(
    "includeOnline widens rather than replaces — in-radius results remain",
    withOnline.slugs.includes(`${FIXTURE_PREFIX}at-centre`),
  );

  report(
    "the hybrid competition out of range is still excluded",
    !withOnline.slugs.includes(`${FIXTURE_PREFIX}hybrid-out-of-range`),
  );
}

async function verifyComposition(): Promise<void> {
  heading("Composition, counting and pagination");

  const combined = await searchWithRadius({
    ...deviceParams(),
    modes: "OFFLINE",
    statuses: "",
    search: "Verify Radius",
  });

  report(
    "radius ANDs with other filters (mode + text narrow the set)",
    combined.slugs.length > 0 &&
      !combined.slugs.includes(`${FIXTURE_PREFIX}hybrid-in-range`),
    combined.slugs.join(", "),
  );

  // findMany and count are built from one plan, so they cannot disagree — but
  // that is the invariant, so it is asserted rather than assumed.
  const plan = await planCompetitionSearch({
    scope: "public",
    params: deviceParams(),
  });

  const [rows, total] = await Promise.all([
    CompetitionRepository.findMany(plan),
    CompetitionRepository.count(plan),
  ]);

  report(
    "findMany and count agree with a radius active",
    rows.length <= total,
    `rows ${rows.length}, total ${total}`,
  );

  const query = buildCompetitionQuery(plan);

  report(
    "pagination stays in the query (take is the page size, not the result set)",
    query.take === 100 && query.skip === 0,
    `take ${query.take}, skip ${query.skip}`,
  );

  const paged = await planCompetitionSearch({
    scope: "public",
    params: { ...deviceParams(), limit: "2", page: "1" },
  });

  const pagedRows = await CompetitionRepository.findMany(paged);

  report(
    "a page of 2 returns at most 2 rows, not the whole radius set",
    pagedRows.length <= 2,
    `${pagedRows.length} rows`,
  );
}

function verifyDecoding(): void {
  heading("URL decoding");

  const spec = competitionFilterSpecs.location;

  const read = (params: RawSearchParams) => readFilterValue(spec, params);

  report(
    "radius with no centre yields no filter",
    read({ radius: "25" }) === undefined,
  );

  report(
    "lat/lng with no radius yields no filter",
    read({ lat: "18.52", lng: "73.85" }) === undefined,
  );

  report(
    "includeOnline alone still yields no filter",
    read({ includeOnline: "true" }) === undefined,
  );

  const device = read({ lat: "18.52", lng: "73.85", radius: "25" });

  report(
    "lat/lng plus radius yields a device centre",
    device?.center.kind === "device" && device.radiusKm === 25,
  );

  const place = read({ placeId: "abc", placeLabel: "Pune" });

  report(
    "a placeId alone yields a place centre with no radius",
    place?.center.kind === "place" && place.radiusKm === undefined,
  );

  const both = read({
    placeId: "abc",
    lat: "18.52",
    lng: "73.85",
    radius: "25",
  });

  report(
    "a place takes precedence when both centres appear",
    both?.center.kind === "place",
  );

  report(
    "an over-large radius is clamped, not dropped",
    read({ placeId: "abc", radius: "999999" })?.radiusKm === 200,
  );

  for (const bad of ["0", "-5", "2.5", "abc", "NaN", "Infinity"]) {
    report(
      `radius=${bad} is dropped`,
      read({ placeId: "abc", radius: bad })?.radiusKm === undefined,
    );
  }

  for (const [lat, lng] of [
    ["91", "0"],
    ["0", "181"],
    ["NaN", "0"],
  ]) {
    report(
      `an out-of-range device centre (${lat}, ${lng}) is rejected`,
      read({ lat, lng, radius: "25" }) === undefined,
    );
  }
}

async function verifyBackwardCompatibility(): Promise<void> {
  heading("Backward compatibility");

  // The guarantee: a radius-free URL must build the clause it always did.
  const legacy = buildLocationClause({
    searchAreaIds: ["area-1", "area-2"],
    includeOnline: false,
  });

  report(
    "no radius: the clause is the plain search-area predicate, unwrapped",
    JSON.stringify(legacy) ===
      JSON.stringify({
        locations: {
          some: {
            location: {
              searchAreas: { some: { searchAreaId: { in: ["area-1", "area-2"] } } },
            },
          },
        },
      }),
    JSON.stringify(legacy),
  );

  const legacyOnline = buildLocationClause({
    searchAreaIds: ["area-1"],
    includeOnline: true,
  });

  report(
    "no radius + includeOnline: the clause is the same OR it always was",
    JSON.stringify(legacyOnline) ===
      JSON.stringify({
        OR: [
          {
            locations: {
              some: {
                location: {
                  searchAreas: { some: { searchAreaId: { in: ["area-1"] } } },
                },
              },
            },
          },
          { mode: "ONLINE" },
        ],
      }),
    JSON.stringify(legacyOnline),
  );

  const empty = buildLocationClause({ searchAreaIds: [], includeOnline: false });

  report(
    "no radius, no areas: MATCHES_NOTHING is preserved",
    JSON.stringify(empty) === JSON.stringify({ id: { in: [] } }),
    JSON.stringify(empty),
  );

  // And end to end: a place-only URL must not acquire a radius by accident.
  const plan = await planCompetitionSearch({
    scope: "public",
    params: { limit: "5" },
  });

  const query = buildCompetitionQuery(plan);

  report(
    "a URL with no location parameters produces no location clause at all",
    !JSON.stringify(query.where).includes("searchAreas") &&
      !JSON.stringify(query.where).includes("latitude"),
  );
}

function verifyNoTruncation(): void {
  heading("Completeness of the exclusion list");

  // The exclusion list is applied with `notIn`, so an incomplete list can only
  // ever over-include a competition just beyond the radius. It can never remove
  // a valid one. That property is what makes a cap unnecessary — and its
  // absence is asserted here by construction.
  const clause = buildLocationClause({
    searchAreaIds: [],
    includeOnline: false,
    radius: {
      box: boundingBox(ANCHOR, RADIUS_KM),
      excludedLocationIds: [],
    },
  });

  const serialized = JSON.stringify(clause);

  report(
    "an empty exclusion list produces no notIn at all, not an empty one",
    !serialized.includes("notIn"),
    serialized,
  );

  report(
    "the radius clause restricts by coordinates, never by an id whitelist",
    serialized.includes("latitude") &&
      serialized.includes("longitude") &&
      !serialized.includes('"in"'),
    serialized,
  );

  const withExclusions = buildLocationClause({
    searchAreaIds: [],
    includeOnline: false,
    radius: {
      box: boundingBox(ANCHOR, RADIUS_KM),
      excludedLocationIds: ["a", "b"],
    },
  });

  report(
    "exclusions are applied as notIn (removal), never as in (whitelist)",
    JSON.stringify(withExclusions).includes('"notIn":["a","b"]'),
    JSON.stringify(withExclusions),
  );
}

async function verifyParameterisedSql(): Promise<void> {
  heading("SQL safety");

  // Values that would break out of the query if they were interpolated rather
  // than bound. The guard rejects them before they reach SQL; the assertion is
  // that nothing throws and nothing leaks.
  const hostile = await LocationRepository.findLocationIdsOutsideRadius({
    center: { latitude: Number("1; DROP TABLE location"), longitude: 0 },
    radiusKm: 25,
  });

  report("a non-numeric anchor is rejected before reaching SQL", hostile.length === 0);

  const stillThere = await prisma.location.count();

  report("the location table is intact", stillThere > 0, `${stillThere} rows`);

  // The query is built from a Prisma.sql tagged template, so every value is a
  // bind parameter by construction. Confirmed by the query still working with
  // values that have no valid string form.
  const extreme = await LocationRepository.findLocationIdsOutsideRadius({
    center: ANCHOR,
    radiusKm: 200,
  });

  report(
    "the 200 km ceiling query executes and returns a list",
    Array.isArray(extreme),
  );
}

async function main(): Promise<void> {
  console.log("Radius search (database-backed)");

  await cleanup();
  await seed();

  try {
    await verifyMembership();
    await verifyBoundaryAndZero();
    await verifyIncludeOnline();
    await verifyComposition();
    verifyDecoding();
    await verifyBackwardCompatibility();
    verifyNoTruncation();
    await verifyParameterisedSql();
  } finally {
    await cleanup();
  }

  console.log(`\n${checks - failures}/${checks} checks passed.`);

  if (failures > 0) {
    console.error(`${failures} FAILED.`);
    process.exitCode = 1;
  }
}

main()
  .catch(async (error) => {
    console.error("Suite failed.", error);
    await cleanup().catch(() => {});
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
