/**
 * Standing regression suite for place resolution: cost, validation, failure
 * classification and cache policy.
 *
 * =============================================================================
 * What this guards
 * =============================================================================
 *
 * `verify-location-identity.ts` proves the identity join is correct.
 * `verify-search-invariants.ts` proves the search engine treats a resolved
 * location correctly. Neither says anything about what resolution *costs* or
 * how it behaves when things go wrong — and those are the properties that were
 * unsafe:
 *
 *   - a single cold Competition search issuing up to seven billed provider
 *     requests, six of which it then discarded
 *   - a user-controlled `placeId` reaching a billed endpoint unvalidated
 *   - a permanent miss never being remembered, so a dead id cost a lookup on
 *     every request forever
 *   - stale cached data standing in for *any* failure, including ones that
 *     mean the place no longer exists
 *
 * Provider behaviour is asserted against a stubbed `fetch`, so the request
 * count and the field masks are observed directly rather than reasoned about.
 * Nothing here reaches Google.
 *
 * Run with:
 *
 *   pnpm exec tsx scripts/verify-place-resolution.ts
 */

import { PlaceResolutionStatus, PrismaClient } from "../src/generated/prisma";

// The provider factory reads this at call time. Set before anything resolves,
// and paired with the stubbed fetch below so no request can leave the process.
process.env.GOOGLE_MAPS_API_KEY = "test-key-not-used";

import { GooglePlaceProvider } from "../src/modules/locations/providers/google.provider";
import {
  PlaceMatchService,
  isTransientResolutionFailure,
  type PlaceResolutionFailure,
} from "../src/modules/locations/services/place-match.service";
import { PlaceIdSchema } from "../src/modules/locations/schemas/location-search";
import { PlaceProviderError } from "../src/modules/locations/types/place";
import { EXTRACTION_VERSION } from "../src/modules/locations/utils/extract-search-areas";

const prisma = new PrismaClient();

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

// =============================================================================
// fetch stub
// =============================================================================

interface RecordedRequest {
  url: string;
  fieldMask: string | null;
}

const recorded: RecordedRequest[] = [];

const realFetch = globalThis.fetch;

/**
 * Replaces `fetch` with a scripted responder and records every request.
 *
 * @param respond returns the response for the nth request, by URL
 */
function stubFetch(respond: (url: string) => Response): void {
  recorded.length = 0;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();

    const headers = new Headers(init?.headers);

    recorded.push({ url, fieldMask: headers.get("X-Goog-FieldMask") });

    return respond(url);
  }) as typeof fetch;
}

function restoreFetch(): void {
  globalThis.fetch = realFetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A place-details payload with descriptor areas worth fanning out over. */
function detailsPayload(id: string) {
  return {
    id,
    displayName: { text: "Pune" },
    formattedAddress: "Pune, Maharashtra, India",
    types: ["locality", "political"],
    location: { latitude: 18.52, longitude: 73.85 },
    addressComponents: [
      { longText: "Pune", shortText: "Pune", types: ["locality", "political"] },
      {
        longText: "Maharashtra",
        shortText: "MH",
        types: ["administrative_area_level_1", "political"],
      },
      { longText: "India", shortText: "IN", types: ["country", "political"] },
    ],
    addressDescriptor: {
      areas: [
        { placeId: "area-1", displayName: { text: "A" }, containment: "WITHIN" },
        { placeId: "area-2", displayName: { text: "B" }, containment: "WITHIN" },
        { placeId: "area-3", displayName: { text: "C" }, containment: "WITHIN" },
      ],
    },
  };
}

// =============================================================================
// P0.1 — search must not fan out
// =============================================================================

async function verifyNoSearchFanOut(): Promise<void> {
  console.log(
    "\n== Invariant: search resolution issues exactly one provider request ==",
  );

  const provider = new GooglePlaceProvider("k", "https://stub.invalid/v1");

  const controller = new AbortController();

  stubFetch((url) =>
    json(url.includes("area-") ? { id: "area", displayName: { text: "A" }, types: ["locality"] } : detailsPayload("place-1")),
  );

  await provider.resolveIdentity({
    placeId: "place-1",
    signal: controller.signal,
  });

  report(
    "resolveIdentity makes exactly 1 request",
    recorded.length === 1,
    `made ${recorded.length}: ${recorded.map((r) => r.url).join(", ")}`,
  );

  report(
    "resolveIdentity does not request the billed addressDescriptor field group",
    !(recorded[0]?.fieldMask ?? "").includes("addressDescriptor"),
    recorded[0]?.fieldMask ?? "(no mask)",
  );

  report(
    "resolveIdentity pins a language, so identity cannot drift with locale",
    recorded[0]?.url.includes("languageCode=") ?? false,
    recorded[0]?.url ?? "(no url)",
  );

  // ---- ingestion, by contrast, is allowed to fan out ----

  stubFetch((url) =>
    json(
      url.includes("area-")
        ? {
            id: "area",
            displayName: { text: "Bibwewadi" },
            types: ["sublocality_level_1", "political"],
            addressComponents: [],
          }
        : detailsPayload("place-1"),
    ),
  );

  await provider.resolveForIngestion({
    placeId: "place-1",
    signal: controller.signal,
  });

  report(
    "resolveForIngestion does fan out over descriptor areas",
    recorded.length === 4,
    `made ${recorded.length} (expected 1 + 3 areas)`,
  );

  report(
    "resolveForIngestion requests addressDescriptor",
    (recorded[0]?.fieldMask ?? "").includes("addressDescriptor"),
    recorded[0]?.fieldMask ?? "(no mask)",
  );

  restoreFetch();
}

// =============================================================================
// P0.2 — validation
// =============================================================================

function verifyPlaceIdValidation(): void {
  console.log("\n== Invariant: malformed place ids never reach the provider ==");

  const rejected: [string, string][] = [
    ["", "empty"],
    ["   ", "whitespace only"],
    ["a".repeat(513), "over the length ceiling"],
    ["has space", "contains a space"],
    ["日本語", "non-ASCII"],
    ["with\nnewline", "control character"],
    ["tab\there", "tab"],
  ];

  for (const [value, why] of rejected) {
    report(
      `rejected: ${why}`,
      !PlaceIdSchema.safeParse(value).success,
      `accepted ${JSON.stringify(value.slice(0, 40))}`,
    );
  }

  const accepted = [
    "ChIJARFGZy6_wjsRQ-Oenb9DjYI",
    "ChIJjXaFQJfqwjsRduKkb30_fRY",
    "a".repeat(512),
  ];

  for (const value of accepted) {
    report(
      `accepted: a realistic id (${value.slice(0, 24)}${value.length > 24 ? "…" : ""})`,
      PlaceIdSchema.safeParse(value).success,
    );
  }
}

async function verifyInvalidIdMakesNoProviderCall(): Promise<void> {
  console.log(
    "\n== Invariant: an invalid id costs nothing, not a billed lookup ==",
  );

  stubFetch(() => {
    throw new Error("the provider must not be reached for an invalid id");
  });

  const result = await PlaceMatchService.resolve({ placeId: "not a place id" });

  report(
    "an invalid id resolves to PLACE_NOT_FOUND",
    result.status === "RESOLUTION_FAILED" &&
      result.reason === "PLACE_NOT_FOUND",
    JSON.stringify(result),
  );

  report(
    "and makes zero provider requests",
    recorded.length === 0,
    `made ${recorded.length}`,
  );

  restoreFetch();
}

// =============================================================================
// P0.9 — HTTP failure classification
// =============================================================================

async function verifyErrorClassification(): Promise<void> {
  console.log(
    "\n== Invariant: provider failures are classified by status, not by message ==",
  );

  const provider = new GooglePlaceProvider("k", "https://stub.invalid/v1");

  const cases: [number, string][] = [
    [400, "NOT_FOUND"],
    [404, "NOT_FOUND"],
    [429, "RATE_LIMITED"],
    [500, "UNAVAILABLE"],
    [503, "UNAVAILABLE"],
  ];

  for (const [status, expected] of cases) {
    stubFetch(() => new Response("{}", { status }));

    try {
      await provider.resolveIdentity({
        placeId: "x",
        signal: new AbortController().signal,
      });

      report(`HTTP ${status} throws`, false, "no error thrown");
    } catch (error) {
      report(
        `HTTP ${status} classifies as ${expected}`,
        error instanceof PlaceProviderError && error.kind === expected,
        error instanceof PlaceProviderError
          ? `got ${error.kind}`
          : String(error),
      );
    }
  }

  // A 2xx whose payload is unusable is a different failure from an outage.
  stubFetch(() => json({ id: "x" }));

  try {
    await provider.resolveIdentity({
      placeId: "x",
      signal: new AbortController().signal,
    });

    report("a response with no display name throws", false);
  } catch (error) {
    report(
      "a 200 with no display name classifies as MALFORMED",
      error instanceof PlaceProviderError && error.kind === "MALFORMED",
      String(error),
    );
  }

  restoreFetch();
}

function verifyTransientClassification(): void {
  console.log("\n== Invariant: transient and permanent failures are separated ==");

  const transient: PlaceResolutionFailure[] = [
    "PROVIDER_UNAVAILABLE",
    "PROVIDER_TIMEOUT",
    "PROVIDER_RATE_LIMITED",
    "STORAGE_UNAVAILABLE",
  ];

  const permanent: PlaceResolutionFailure[] = [
    "PLACE_NOT_FOUND",
    "MALFORMED_RESPONSE",
  ];

  for (const reason of transient) {
    report(`${reason} is transient (stale cache may stand in)`, isTransientResolutionFailure(reason));
  }

  for (const reason of permanent) {
    report(
      `${reason} is NOT transient (stale cache must not stand in)`,
      !isTransientResolutionFailure(reason),
    );
  }
}

// =============================================================================
// P0.2 / P0.8 — cache policy, end to end against the real table
// =============================================================================

const FIXTURE_PREFIX = "kizunia-verify-";

async function cleanupFixtures(): Promise<void> {
  await prisma.placeResolution.deleteMany({
    where: { placeId: { startsWith: FIXTURE_PREFIX } },
  });
}

async function verifyNegativeCache(): Promise<void> {
  console.log("\n== Invariant: a permanent miss is remembered ==");

  const placeId = `${FIXTURE_PREFIX}not-found`;

  await prisma.placeResolution.deleteMany({ where: { placeId } });

  // First attempt: the provider refuses the id.
  stubFetch(() => new Response("{}", { status: 404 }));

  const first = await PlaceMatchService.resolve({ placeId });

  report(
    "a 404 resolves to PLACE_NOT_FOUND",
    first.status === "RESOLUTION_FAILED" && first.reason === "PLACE_NOT_FOUND",
    JSON.stringify(first),
  );

  report("the first attempt did call the provider", recorded.length === 1, `made ${recorded.length}`);

  const row = await prisma.placeResolution.findUnique({ where: { placeId } });

  report(
    "the miss was written to the cache",
    row?.status === PlaceResolutionStatus.NOT_FOUND,
    JSON.stringify(row),
  );

  report(
    "and it carries no identity keys",
    (row?.identityKeys.length ?? -1) === 0,
    JSON.stringify(row?.identityKeys),
  );

  // Second attempt: must be served from the cache, with no provider request.
  stubFetch(() => {
    throw new Error("a cached permanent miss must not re-hit the provider");
  });

  const second = await PlaceMatchService.resolve({ placeId });

  report(
    "a repeat resolves to PLACE_NOT_FOUND again",
    second.status === "RESOLUTION_FAILED" &&
      second.reason === "PLACE_NOT_FOUND",
    JSON.stringify(second),
  );

  report(
    "and makes zero provider requests",
    recorded.length === 0,
    `made ${recorded.length}`,
  );

  restoreFetch();
  await prisma.placeResolution.deleteMany({ where: { placeId } });
}

async function verifyTransientIsNotCached(): Promise<void> {
  console.log("\n== Invariant: a transient failure is never cached ==");

  const placeId = `${FIXTURE_PREFIX}transient`;

  await prisma.placeResolution.deleteMany({ where: { placeId } });

  stubFetch(() => new Response("{}", { status: 503 }));

  const result = await PlaceMatchService.resolve({ placeId });

  report(
    "a 503 with no cached entry surfaces the failure",
    result.status === "RESOLUTION_FAILED" &&
      result.reason === "PROVIDER_UNAVAILABLE",
    JSON.stringify(result),
  );

  const row = await prisma.placeResolution.findUnique({ where: { placeId } });

  report(
    "nothing was written, so an outage cannot freeze into a permanent answer",
    row === null,
    JSON.stringify(row),
  );

  restoreFetch();
}

async function verifyStaleCachePolicy(): Promise<void> {
  console.log(
    "\n== Invariant: stale data stands in for outages, never for a refusal ==",
  );

  const placeId = `${FIXTURE_PREFIX}stale`;

  /** Older than the 30-day TTL, so every read treats it as stale. */
  const staleAt = new Date(Date.now() - 60 * 24 * 60 * 60 * 1_000);

  async function seedStale(): Promise<void> {
    await prisma.placeResolution.upsert({
      where: { placeId },
      create: {
        placeId,
        status: PlaceResolutionStatus.RESOLVED,
        identityKeys: ["component:locality:stalefixture:nowhere"],
        displayName: "Stale Fixture",
        contextLabel: null,
        extractionVersion: EXTRACTION_VERSION,
        resolvedAt: staleAt,
      },
      update: {
        status: PlaceResolutionStatus.RESOLVED,
        identityKeys: ["component:locality:stalefixture:nowhere"],
        displayName: "Stale Fixture",
        extractionVersion: EXTRACTION_VERSION,
        resolvedAt: staleAt,
      },
    });
  }

  // --- transient failure: stale data is acceptable ---
  await seedStale();

  stubFetch(() => new Response("{}", { status: 503 }));

  const transient = await PlaceMatchService.resolve({ placeId });

  report(
    "a provider outage falls back to the stale entry",
    transient.status === "RESOLVED" &&
      transient.displayName === "Stale Fixture",
    JSON.stringify(transient),
  );

  // --- permanent failure: stale data must NOT be presented as current ---
  await seedStale();

  stubFetch(() => new Response("{}", { status: 404 }));

  const permanent = await PlaceMatchService.resolve({ placeId });

  report(
    "a refusal does NOT fall back to the stale entry",
    permanent.status === "RESOLUTION_FAILED" &&
      permanent.reason === "PLACE_NOT_FOUND",
    JSON.stringify(permanent),
  );

  const row = await prisma.placeResolution.findUnique({ where: { placeId } });

  report(
    "and the row is rewritten as a permanent miss",
    row?.status === PlaceResolutionStatus.NOT_FOUND,
    JSON.stringify(row),
  );

  restoreFetch();
  await prisma.placeResolution.deleteMany({ where: { placeId } });
}

async function verifyExtractionVersionInvalidates(): Promise<void> {
  console.log("\n== Invariant: a version mismatch is treated as a cache miss ==");

  const placeId = `${FIXTURE_PREFIX}version`;

  await prisma.placeResolution.upsert({
    where: { placeId },
    create: {
      placeId,
      status: PlaceResolutionStatus.RESOLVED,
      identityKeys: ["component:locality:oldrules:nowhere"],
      displayName: "Old Rules",
      contextLabel: null,
      // Deliberately behind the current ruleset.
      extractionVersion: EXTRACTION_VERSION - 1,
      resolvedAt: new Date(),
    },
    update: {
      extractionVersion: EXTRACTION_VERSION - 1,
      resolvedAt: new Date(),
    },
  });

  stubFetch(() => json(detailsPayload(placeId)));

  const result = await PlaceMatchService.resolve({ placeId });

  report(
    "an entry from an older ruleset is re-resolved rather than trusted",
    recorded.length === 1,
    `made ${recorded.length} provider requests`,
  );

  report(
    "and the refreshed result is returned",
    result.status === "RESOLVED" && result.displayName === "Pune",
    JSON.stringify(result),
  );

  const row = await prisma.placeResolution.findUnique({ where: { placeId } });

  report(
    "the cache is rewritten at the current version",
    row?.extractionVersion === EXTRACTION_VERSION,
    JSON.stringify(row?.extractionVersion),
  );

  restoreFetch();
  await prisma.placeResolution.deleteMany({ where: { placeId } });
}

// =============================================================================

/**
 * Radius anchors: fetched free, persisted, and re-resolved only when needed.
 *
 * =============================================================================
 * The property that makes this cheap
 * =============================================================================
 *
 * The anchor coordinate was *already* being fetched and paid for before radius
 * search existed — `location` has always been in the identity field mask — and
 * then discarded at the last step. So the feature must add **no** provider
 * request and **no** billed field group. That is asserted here rather than
 * trusted, because growing the mask is a one-word change with a recurring bill.
 *
 * =============================================================================
 * And the property that keeps the migration cheap
 * =============================================================================
 *
 * Rows cached before the anchor columns existed carry no coordinates. Bumping
 * EXTRACTION_VERSION would have invalidated every row at once and re-billed the
 * lot. Instead such a row stays perfectly fresh for an ordinary area search and
 * counts as stale *only* when a caller actually asks for an anchor — so the
 * migration is paid one place at a time, by the searches that need it.
 */
async function verifyAnchorPersistence(): Promise<void> {
  console.log("\n== Invariant: radius anchors cost nothing extra ==");

  const placeId = `${FIXTURE_PREFIX}anchor`;

  await prisma.placeResolution.deleteMany({ where: { placeId } });

  stubFetch(() => json(detailsPayload(placeId)));

  const cold = await PlaceMatchService.resolve({ placeId, requireAnchor: true });

  report(
    "a cold resolve returns the anchor",
    cold.status === "RESOLVED" &&
      cold.anchor?.latitude === 18.52 &&
      cold.anchor?.longitude === 73.85,
    JSON.stringify(cold),
  );

  report(
    "asking for an anchor still costs exactly 1 provider request",
    recorded.length === 1,
    `made ${recorded.length}`,
  );

  report(
    "asking for an anchor does not grow the billed field mask",
    (recorded[0]?.fieldMask ?? "").includes("location") &&
      !(recorded[0]?.fieldMask ?? "").includes("addressDescriptor"),
    recorded[0]?.fieldMask ?? "(no mask)",
  );

  const stored = await prisma.placeResolution.findUnique({ where: { placeId } });

  report(
    "the anchor is persisted to place_resolution",
    Number(stored?.latitude) === 18.52 && Number(stored?.longitude) === 73.85,
    `${stored?.latitude}, ${stored?.longitude}`,
  );

  // Warm read: served from cache, no further provider traffic.
  const before = recorded.length;

  const warm = await PlaceMatchService.resolve({ placeId, requireAnchor: true });

  report(
    "a warm resolve returns the anchor from cache without a provider call",
    warm.status === "RESOLVED" &&
      warm.anchor?.latitude === 18.52 &&
      recorded.length === before,
    `${recorded.length - before} extra requests`,
  );

  // An ordinary area search must not be handed an anchor it did not ask for,
  // and must not pay to acquire one.
  const areaOnly = await PlaceMatchService.resolve({ placeId });

  report(
    "an area search gets no anchor, because it did not ask",
    areaOnly.status === "RESOLVED" && areaOnly.anchor === null,
  );

  // ---- the migration path ----

  await prisma.placeResolution.update({
    where: { placeId },
    data: { latitude: null, longitude: null },
  });

  const legacyArea = recorded.length;

  const areaOnLegacyRow = await PlaceMatchService.resolve({ placeId });

  report(
    "a pre-migration row is still fresh for an area search (no re-bill)",
    areaOnLegacyRow.status === "RESOLVED" &&
      recorded.length === legacyArea,
    `${recorded.length - legacyArea} extra requests`,
  );

  const legacyAnchor = recorded.length;

  const anchorOnLegacyRow = await PlaceMatchService.resolve({
    placeId,
    requireAnchor: true,
  });

  report(
    "the same row is stale for a radius search, so the anchor is re-resolved",
    anchorOnLegacyRow.status === "RESOLVED" &&
      anchorOnLegacyRow.anchor?.latitude === 18.52 &&
      recorded.length === legacyAnchor + 1,
    `${recorded.length - legacyAnchor} extra requests`,
  );

  report(
    "EXTRACTION_VERSION was not bumped for the anchor migration",
    EXTRACTION_VERSION === 3,
    `version ${EXTRACTION_VERSION}`,
  );
}

async function main(): Promise<void> {
  try {
    await verifyNoSearchFanOut();
    verifyPlaceIdValidation();
    await verifyInvalidIdMakesNoProviderCall();
    await verifyErrorClassification();
    verifyTransientClassification();
    await verifyNegativeCache();
    await verifyTransientIsNotCached();
    await verifyStaleCachePolicy();
    await verifyExtractionVersionInvalidates();
    await verifyAnchorPersistence();
  } finally {
    restoreFetch();
    await cleanupFixtures();
  }

  console.log(`\n${checks - failures}/${checks} checks passed.`);

  await prisma.$disconnect();

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  console.error(error);
  restoreFetch();
  await cleanupFixtures().catch(() => {});
  await prisma.$disconnect();
  process.exitCode = 1;
});
