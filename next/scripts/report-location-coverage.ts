/**
 * Location data coverage report.
 *
 * =============================================================================
 * Why this exists
 * =============================================================================
 *
 * Radius search matches by distance and nothing else. A competition whose
 * `Location` carries no coordinates cannot match a radius search — not even one
 * centred on its own city — because there is no point to measure from.
 *
 * That is a deliberate product decision (radius *replaces* SearchArea matching
 * rather than widening it), and it means coordinate coverage, not distance
 * maths, is the ceiling on how useful the feature is. Before this report that
 * ceiling was a guess. After it, it is a number.
 *
 * Three ingestion paths write a `Location`, and they do not agree:
 *
 *   - the place picker  → `placeDetailsToLocationInput` copies the provider's
 *     coordinates, so these rows are covered
 *   - manual admin entry → `LocationInputSchema` makes the pair optional, so
 *     these rows are usually not
 *   - the seeder → bare display names, so these rows never are
 *
 * =============================================================================
 * What this is not
 * =============================================================================
 *
 * Read-only. It writes nothing, geocodes nothing, and fixes nothing. Bulk
 * geocoding a free-text display name ("Multiple cities, India" is a real seed
 * value) would produce confident, wrong coordinates, and a wrong coordinate is
 * worse than a missing one: missing is visibly incomplete, wrong is invisibly
 * false. This report makes the gap visible so it can be owned as an editorial
 * problem rather than papered over as a technical one.
 *
 * It is also not a prerequisite for radius search. Run it before and after.
 *
 * Run with:
 *
 *   pnpm exec tsx scripts/report-location-coverage.ts
 */

import { PrismaClient } from "../src/generated/prisma";
// The widest radius the product allows, and therefore the widest question this
// report asks. Imported rather than restated so the report can never describe a
// ceiling the search does not actually enforce.
import { MAX_RADIUS_KM } from "../src/modules/locations/utils/radius";

const prisma = new PrismaClient();

function heading(title: string): void {
  console.log(`\n${title}`);
  console.log("=".repeat(title.length));
}

/**
 * Renders a count alongside what it is a share of.
 *
 * A bare "17 search areas have no coordinates" invites the wrong reaction
 * depending on whether the total is 20 or 20 000, so the denominator is never
 * omitted.
 */
function line(label: string, value: number, total?: number): void {
  const share =
    total !== undefined && total > 0
      ? ` (${((value / total) * 100).toFixed(1)}% of ${total})`
      : "";

  console.log(`  ${label.padEnd(52)} ${String(value).padStart(7)}${share}`);
}

/**
 * A coordinate pair is usable only when both halves are present.
 *
 * `LocationInputSchema` already rejects a half-set pair on the write path, but
 * this reads rows that predate that rule and rows written by the seeder, so the
 * check is made here rather than assumed.
 */
function missingCoordinatesWhere() {
  return { OR: [{ latitude: null }, { longitude: null }] };
}

async function reportLocations(): Promise<void> {
  heading("Locations");

  const total = await prisma.location.count();

  const missingCoordinates = await prisma.location.count({
    where: missingCoordinatesWhere(),
  });

  const missingSearchAreas = await prisma.location.count({
    where: { searchAreas: { none: {} } },
  });

  // The two gaps are independent, and a row with both is the least reachable
  // row in the database: invisible to area search and to radius search alike.
  const missingBoth = await prisma.location.count({
    where: { AND: [missingCoordinatesWhere(), { searchAreas: { none: {} } }] },
  });

  line("Total", total);
  line("Without coordinates (radius-invisible)", missingCoordinates, total);
  line("Without search areas (area-invisible)", missingSearchAreas, total);
  line("Without either (unreachable by location)", missingBoth, total);

  const byProvider = await prisma.location.groupBy({
    by: ["provider"],
    _count: { _all: true },
  });

  for (const row of byProvider) {
    const missing = await prisma.location.count({
      where: { AND: [{ provider: row.provider }, missingCoordinatesWhere()] },
    });

    line(
      `  provider ${row.provider}: without coordinates`,
      missing,
      row._count._all,
    );
  }
}

async function reportSearchAreas(): Promise<void> {
  heading("Search areas");

  const total = await prisma.searchArea.count();

  const missingCoordinates = await prisma.searchArea.count({
    where: missingCoordinatesWhere(),
  });

  line("Total", total);
  line("Without coordinates", missingCoordinates, total);

  // Expected to be high, and not a defect: Google returns no coordinates for an
  // address component, and address components are the only way a city, state or
  // country acquires an identity at all. Recorded so the number is never
  // mistaken for a regression — and as the evidence that `SearchArea` is the
  // wrong place to read an anchor coordinate from.
  console.log(
    "\n  Note: ADDRESS_COMPONENT-sourced areas never carry coordinates by",
  );
  console.log(
    "  design. A high share here is expected and is why radius anchors come",
  );
  console.log("  from place_resolution rather than from search_area.");
}

async function reportCompetitions(): Promise<void> {
  heading("Competitions");

  const total = await prisma.competition.count({ where: { deletedAt: null } });

  const withoutLocations = await prisma.competition.count({
    where: { deletedAt: null, locations: { none: {} } },
  });

  // The population radius search can actually reach: a live competition with at
  // least one location that has a usable coordinate pair.
  const radiusReachable = await prisma.competition.count({
    where: {
      deletedAt: null,
      locations: {
        some: { location: { latitude: { not: null }, longitude: { not: null } } },
      },
    },
  });

  const publicRadiusReachable = await prisma.competition.count({
    where: {
      deletedAt: null,
      visibility: "PUBLIC",
      locations: {
        some: { location: { latitude: { not: null }, longitude: { not: null } } },
      },
    },
  });

  line("Total (not deleted)", total);
  line("Without any location", withoutLocations, total);
  line("Reachable by radius search", radiusReachable, total);
  line("  ...and PUBLIC (what a visitor can find)", publicRadiusReachable, total);

  const byMode = await prisma.competition.groupBy({
    by: ["mode"],
    where: { deletedAt: null },
    _count: { _all: true },
  });

  console.log("");

  for (const row of byMode) {
    // `mode` is nullable and independent of `locations` — zero locations means
    // "unknown", never "online". Printed as-is rather than folded into a
    // derived online/offline split that the schema does not support.
    line(`  mode ${row.mode ?? "(null)"}`, row._count._all, total);
  }
}

async function reportAnchors(): Promise<void> {
  heading("Place resolution cache (radius anchors)");

  const total = await prisma.placeResolution.count();

  const resolved = await prisma.placeResolution.count({
    where: { status: "RESOLVED" },
  });

  line("Total cached resolutions", total);
  line("RESOLVED", resolved, total);

  // Written before this report ships, the anchor columns do not exist yet; once
  // Phase 1 lands, an uncovered row simply re-resolves the next time someone
  // asks for a radius around it, at no extra provider cost.
  console.log(
    "\n  Anchor coordinates are added in Phase 1. Rows cached before that",
  );
  console.log(
    "  migration carry none and re-resolve on first radius use, which is why",
  );
  console.log("  no backfill is required.");
}

async function main(): Promise<void> {
  console.log("Location data coverage");
  console.log(`Generated ${new Date().toISOString()}`);
  console.log(`Radius product ceiling: ${MAX_RADIUS_KM} km`);

  await reportLocations();
  await reportSearchAreas();
  await reportCompetitions();
  await reportAnchors();

  console.log(
    "\nRead-only: nothing was written, geocoded, or modified.\n",
  );
}

main()
  .catch((error) => {
    console.error("Coverage report failed.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
