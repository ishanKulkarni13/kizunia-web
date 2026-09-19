/**
 * Standing regression suite for the radius primitives.
 *
 * =============================================================================
 * What this guards
 * =============================================================================
 *
 * The radius query is split across two languages: a bounding box evaluated by
 * Prisma, and an exact distance evaluated by Postgres. That split is only safe
 * because of one postcondition — **the box is a strict superset of the circle**
 * — and if that ever stops holding, the failure is a competition quietly missing
 * from a search. No error, no log, no empty page: just slightly wrong results
 * that look completely plausible.
 *
 * So the superset property is asserted here as a property test over thousands of
 * random anchors, not as a handful of hand-picked examples. Hand-picked cases
 * would never have found the two bugs this file exists to prevent: the widest
 * longitude being taken at the centre's latitude rather than the box's far edge,
 * and a box near the antimeridian expressed as an unsatisfiable `BETWEEN`.
 *
 * Pure. No database, no network, no clock.
 *
 * Run with:
 *
 *   pnpm exec tsx scripts/verify-radius-math.ts
 */

import {
  MAX_RADIUS_KM,
  RADIUS_STEPS,
  boundingBox,
  clampRadiusKm,
  haversineKm,
  isInsideBoundingBox,
  isValidCoordinates,
  roundDeviceCoordinate,
  type Coordinates,
} from "../src/modules/locations/utils/radius";
import { competitionFilterSpecs } from "../src/modules/competitions/search/ui";

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

/** Deterministic PRNG, so a property-test failure is reproducible. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

// =============================================================================
// Distance
// =============================================================================

function verifyHaversine(): void {
  heading("Haversine");

  const pune: Coordinates = { latitude: 18.5204, longitude: 73.8567 };
  const mumbai: Coordinates = { latitude: 19.076, longitude: 72.8777 };
  const pimpri: Coordinates = { latitude: 18.6298, longitude: 73.7997 };
  const lonavala: Coordinates = { latitude: 18.7546, longitude: 73.4062 };

  const within = (actual: number, expected: number, tolerance = 0.01) =>
    Math.abs(actual - expected) / expected <= tolerance;

  const puneMumbai = haversineKm(pune, mumbai);
  const punePimpri = haversineKm(pune, pimpri);
  const puneLonavala = haversineKm(pune, lonavala);

  report(
    `Pune to Mumbai is about 120 km (got ${puneMumbai.toFixed(2)})`,
    within(puneMumbai, 120, 0.05),
  );

  report(
    `Pune to Pimpri-Chinchwad is about 14 km (got ${punePimpri.toFixed(2)})`,
    within(punePimpri, 14, 0.15),
  );

  report(
    `Pune to Lonavala is about 51 km (got ${puneLonavala.toFixed(2)})`,
    within(puneLonavala, 51, 0.15),
  );

  // The case that motivated choosing haversine over the law of cosines: a
  // competition at the exact centre of the search must not vanish from it.
  const self = haversineKm(pune, pune);

  report(
    "distance to self is exactly 0, not NaN",
    Object.is(self, 0),
    `got ${self}`,
  );

  report(
    "distance to self is 0 at the equator",
    haversineKm(
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 0 },
    ) === 0,
  );

  report(
    "distance to self is 0 at a pole",
    haversineKm(
      { latitude: 90, longitude: 0 },
      { latitude: 90, longitude: 0 },
    ) === 0,
  );

  report(
    "symmetry: d(a,b) === d(b,a)",
    haversineKm(pune, mumbai) === haversineKm(mumbai, pune),
  );

  const antipodal = haversineKm(
    { latitude: 0, longitude: 0 },
    { latitude: 0, longitude: 180 },
  );

  report(
    `antipodal points are half the circumference (got ${antipodal.toFixed(0)})`,
    Number.isFinite(antipodal) && within(antipodal, 20_015, 0.01),
  );

  // Crossing the antimeridian must be a short hop, not a trip round the world.
  const acrossDateLine = haversineKm(
    { latitude: 0, longitude: 179.9 },
    { latitude: 0, longitude: -179.9 },
  );

  report(
    `179.9E to 179.9W is about 22 km (got ${acrossDateLine.toFixed(1)})`,
    within(acrossDateLine, 22.24, 0.02),
  );

  let anyNaN = false;
  const random = makeRandom(7);

  for (let index = 0; index < 20_000; index += 1) {
    const a: Coordinates = {
      latitude: random() * 180 - 90,
      longitude: random() * 360 - 180,
    };

    const b: Coordinates = {
      latitude: random() * 180 - 90,
      longitude: random() * 360 - 180,
    };

    if (!Number.isFinite(haversineKm(a, b))) {
      anyNaN = true;
      break;
    }
  }

  report("never returns NaN over 20 000 random pairs", !anyNaN);
}

// =============================================================================
// Bounding box — the superset postcondition
// =============================================================================

/**
 * Walks the circle's rim and asserts every sample lands inside the box.
 *
 * The rim is where the property is tight; interior points would pass trivially
 * and prove nothing. Bearings are swept all the way round so the corners, the
 * cardinal extremes and everything between are all covered.
 */
function rimEscapesBox(center: Coordinates, radiusKm: number): boolean {
  const box = boundingBox(center, radiusKm);

  for (let bearing = 0; bearing < 360; bearing += 1) {
    const point = destination(center, radiusKm, bearing);

    if (!isInsideBoundingBox(box, point)) {
      return true;
    }
  }

  return false;
}

/** Standard forward geodesic on a sphere — an independent check on the box. */
function destination(
  origin: Coordinates,
  distanceKm: number,
  bearingDegrees: number,
): Coordinates {
  const radius = 6371.0088;
  const angular = distanceKm / radius;

  const bearing = (bearingDegrees * Math.PI) / 180;
  const latitude = (origin.latitude * Math.PI) / 180;
  const longitude = (origin.longitude * Math.PI) / 180;

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

  // Renormalise into [-180, 180], the range every stored coordinate uses.
  const degrees = (nextLongitude * 180) / Math.PI;

  return {
    latitude: (nextLatitude * 180) / Math.PI,
    longitude: ((((degrees + 180) % 360) + 360) % 360) - 180,
  };
}

function verifyBoundingBox(): void {
  heading("Bounding box");

  const random = makeRandom(42);

  let escapes = 0;
  let worst: string | null = null;

  for (let index = 0; index < 4_000; index += 1) {
    const center: Coordinates = {
      latitude: random() * 180 - 90,
      longitude: random() * 360 - 180,
    };

    const radiusKm = RADIUS_STEPS[Math.floor(random() * RADIUS_STEPS.length)];

    if (rimEscapesBox(center, radiusKm)) {
      escapes += 1;

      worst ??= `lat ${center.latitude.toFixed(4)}, lng ${center.longitude.toFixed(4)}, r ${radiusKm}`;
    }
  }

  report(
    "box contains the whole circle rim over 4 000 random anchors",
    escapes === 0,
    worst ? `first escape at ${worst}` : undefined,
  );

  // Named cases, so a regression names the scenario rather than a seed.
  const cases: ReadonlyArray<[string, Coordinates]> = [
    ["equator", { latitude: 0, longitude: 0 }],
    ["Pune", { latitude: 18.5204, longitude: 73.8567 }],
    ["high latitude (Tromso)", { latitude: 69.6496, longitude: 18.956 }],
    ["antimeridian east (Fiji)", { latitude: -17.7134, longitude: 178.065 }],
    ["antimeridian west", { latitude: -17.7134, longitude: -178.065 }],
    ["exactly on the antimeridian", { latitude: 0, longitude: 180 }],
    ["near the north pole", { latitude: 89.5, longitude: 30 }],
    ["north pole", { latitude: 90, longitude: 0 }],
    ["south pole", { latitude: -90, longitude: 0 }],
  ];

  for (const [name, center] of cases) {
    report(
      `${name}: rim stays inside the box at ${MAX_RADIUS_KM} km`,
      !rimEscapesBox(center, MAX_RADIUS_KM),
    );
  }

  const fiji = boundingBox({ latitude: -17.7, longitude: 179.9 }, 200);

  report(
    "a box spanning the antimeridian is reported as wrapped",
    fiji.longitude.kind === "wrapped",
    `got ${fiji.longitude.kind}`,
  );

  const pole = boundingBox({ latitude: 89.9, longitude: 0 }, 200);

  report(
    "a box reaching the pole opens to every longitude",
    pole.longitude.kind === "contiguous" &&
      pole.longitude.min === -180 &&
      pole.longitude.max === 180,
  );

  report(
    "a box never exceeds the poles in latitude",
    pole.maxLatitude <= 90 && pole.minLatitude >= -90,
  );

  const pune = boundingBox({ latitude: 18.5204, longitude: 73.8567 }, 25);

  report(
    "an ordinary box is contiguous",
    pune.longitude.kind === "contiguous",
  );

  // Sanity on magnitude: 25 km is roughly a quarter of a degree of latitude.
  report(
    "a 25 km box spans roughly 0.45 degrees of latitude",
    Math.abs(pune.maxLatitude - pune.minLatitude - 0.4498) < 0.01,
    `got ${(pune.maxLatitude - pune.minLatitude).toFixed(4)}`,
  );
}

// =============================================================================
// Radius validation
// =============================================================================

function verifyClamp(): void {
  heading("Radius validation");

  const rejected: ReadonlyArray<[string, number]> = [
    ["zero", 0],
    ["negative", -5],
    ["non-integer", 2.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["1e999 (parses to Infinity)", Number("1e999")],
    ["beyond safe integer range", 1e21],
  ];

  for (const [name, value] of rejected) {
    report(`${name} is rejected`, clampRadiusKm(value) === null);
  }

  report("1 km is accepted", clampRadiusKm(1) === 1);
  report("25 km is accepted unchanged", clampRadiusKm(25) === 25);

  report(
    "an off-step value is accepted, not rejected",
    clampRadiusKm(37) === 37,
  );

  report(
    `${MAX_RADIUS_KM} km is accepted unchanged`,
    clampRadiusKm(MAX_RADIUS_KM) === MAX_RADIUS_KM,
  );

  // Clamping rather than rejecting: dropping an over-large radius would narrow
  // a search the user was explicitly widening.
  report(
    "999999 clamps to the ceiling rather than being dropped",
    clampRadiusKm(999_999) === MAX_RADIUS_KM,
  );

  report(
    `every declared step is accepted (${RADIUS_STEPS.join(", ")})`,
    RADIUS_STEPS.every((step) => clampRadiusKm(step) === step),
  );

  report(
    "no declared step exceeds the ceiling",
    RADIUS_STEPS.every((step) => step <= MAX_RADIUS_KM),
  );

  report("the ceiling is the product's 200 km", MAX_RADIUS_KM === 200);
}

/**
 * The Competition spec must offer exactly what the query layer enforces.
 *
 * These are two ends of the same fact. Restating the ceiling or the step list
 * in the spec would let them drift apart, and the drift would be invisible from
 * either side: an interface offering a distance `clampRadiusKm` rejects is a
 * control that does nothing, and a ceiling the spec sets lower than the query
 * layer's silently narrows a search the user asked to widen.
 *
 * The spec now imports both constants, so this cannot fail today. It is here to
 * fail the moment someone types a literal back into `ui.ts`.
 */
function verifyCompetitionSpecReusesConstants(): void {
  heading("Competition radius config matches the canonical constants");

  const radius = competitionFilterSpecs.location.radius;

  if (!radius) {
    report("the Competition location spec declares a radius", false);

    return;
  }

  report(
    `maxKm is MAX_RADIUS_KM (${MAX_RADIUS_KM})`,
    radius.maxKm === MAX_RADIUS_KM,
    String(radius.maxKm),
  );

  report(
    `steps are RADIUS_STEPS (${RADIUS_STEPS.join(", ")})`,
    radius.steps.length === RADIUS_STEPS.length &&
      radius.steps.every((step, index) => step === RADIUS_STEPS[index]),
    radius.steps.join(", "),
  );

  // Not one of the canonical constants — it is a product default — but it seeds
  // the control, so a value the control cannot land on would render a slider
  // starting off its own scale.
  report(
    `defaultKm (${radius.defaultKm}) is one of the offered steps`,
    RADIUS_STEPS.includes(radius.defaultKm),
  );

  report(
    "defaultKm does not exceed the ceiling",
    radius.defaultKm <= MAX_RADIUS_KM,
  );
}

function verifyCoordinateGuards(): void {
  heading("Coordinate guards");

  const invalid: ReadonlyArray<[string, Coordinates]> = [
    ["latitude above 90", { latitude: 90.1, longitude: 0 }],
    ["latitude below -90", { latitude: -90.1, longitude: 0 }],
    ["longitude above 180", { latitude: 0, longitude: 180.1 }],
    ["longitude below -180", { latitude: 0, longitude: -180.1 }],
    ["NaN latitude", { latitude: Number.NaN, longitude: 0 }],
    ["NaN longitude", { latitude: 0, longitude: Number.NaN }],
    ["infinite latitude", { latitude: Number.POSITIVE_INFINITY, longitude: 0 }],
  ];

  for (const [name, value] of invalid) {
    report(`${name} is rejected`, !isValidCoordinates(value));
  }

  const valid: ReadonlyArray<[string, Coordinates]> = [
    ["Pune", { latitude: 18.5204, longitude: 73.8567 }],
    ["null island", { latitude: 0, longitude: 0 }],
    ["north pole", { latitude: 90, longitude: 0 }],
    ["antimeridian", { latitude: 0, longitude: 180 }],
    ["antimeridian west", { latitude: 0, longitude: -180 }],
  ];

  for (const [name, value] of valid) {
    report(`${name} is accepted`, isValidCoordinates(value));
  }
}

function verifyRounding(): void {
  heading("Device coordinate rounding");

  report(
    "rounds to 4 decimal places",
    roundDeviceCoordinate(18.520430123) === 18.5204,
  );

  report(
    "rounds negatives correctly",
    roundDeviceCoordinate(-73.856774999) === -73.8568,
  );

  report(
    "leaves an already-short value alone",
    roundDeviceCoordinate(18.5) === 18.5,
  );

  // ~11 m at the equator, which is far finer than the smallest radius offered
  // and coarse enough not to publish someone's doorstep in a shared link.
  const error = Math.abs(roundDeviceCoordinate(18.52043) - 18.52043);

  report("rounding error stays under 0.0001 degrees", error <= 0.0001);
}

function main(): void {
  console.log("Radius primitives");

  verifyHaversine();
  verifyBoundingBox();
  verifyClamp();
  verifyCompetitionSpecReusesConstants();
  verifyCoordinateGuards();
  verifyRounding();

  console.log(`\n${checks - failures}/${checks} checks passed.`);

  if (failures > 0) {
    console.error(`${failures} FAILED.`);
    process.exitCode = 1;
  }
}

main();
