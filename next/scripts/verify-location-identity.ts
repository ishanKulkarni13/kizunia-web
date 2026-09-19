/**
 * Standing regression suite for geographic **identity**.
 *
 * =============================================================================
 * Why this suite exists separately
 * =============================================================================
 *
 * `verify-search-invariants.ts` proves that the search engine treats a resolved
 * location correctly: that zero matched areas narrows to nothing rather than
 * widening to everything, that rows and totals are built from one plan, that
 * chips and pagination preserve the filter. Every one of those checks takes
 * `searchAreaIds` as an input.
 *
 * None of them asks the question the whole feature depends on:
 *
 *     Does the identity key ingestion WRITES equal the identity key search
 *     LOOKS UP for the same real-world place?
 *
 * Those two keys are derived from two *different* provider responses — one
 * describing a venue, one describing the place a visitor selected — and joined
 * on exact string equality. If they differ by a single character the join
 * returns nothing, the location filter produces `MATCHES_NOTHING`, and the page
 * renders a completely plausible "no competitions match these filters". The
 * failure is silent, correct-looking, and total: it cannot be distinguished
 * from the truth by looking at the page, and every other test stays green.
 *
 * So this suite calls both halves of the join and asserts they intersect.
 *
 * =============================================================================
 * Fixtures, not the live provider
 * =============================================================================
 *
 * Both extraction functions are pure — no database, no network, no clock — so
 * these run against recorded provider-shaped payloads and need neither Google
 * nor Postgres. The fixtures below mirror the structure Google Places (New)
 * actually returns for these places, including the detail that matters most:
 * the venue's response and the selected place's response are written
 * independently, exactly as they arrive in production.
 *
 * There is no test runner in this repository yet, so this is a standalone
 * script rather than a describe/it suite. Run with:
 *
 *   pnpm exec tsx scripts/verify-location-identity.ts
 */

import {
  extractSearchAreaCandidates,
  extractSelectedPlaceIdentities,
} from "../src/modules/locations/utils/extract-search-areas";
import { normalizeIdentityName } from "../src/modules/locations/utils/identity";
import type {
  PlaceAddressComponent,
  PlaceDetails,
  PlaceIdentityDetails,
} from "../src/modules/locations/types/place";

// =============================================================================
// Harness
// =============================================================================

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

/** Terse component builder, so a fixture reads as data rather than as syntax. */
function component(
  longName: string,
  types: string[],
  shortName: string | null = null,
): PlaceAddressComponent {
  return { longName, shortName, types };
}

function identityDetails(params: {
  placeId: string;
  displayName: string;
  types: string[];
  components: PlaceAddressComponent[];
}): PlaceIdentityDetails {
  return {
    providerPlaceId: params.placeId,
    displayName: params.displayName,
    formattedAddress: null,
    types: params.types,
    latitude: null,
    longitude: null,
    addressComponents: params.components,
  };
}

/** A venue as ingestion sees it: identity plus (here, empty) containment. */
function ingestionDetails(params: {
  placeId: string;
  displayName: string;
  types: string[];
  components: PlaceAddressComponent[];
}): PlaceDetails {
  return { ...identityDetails(params), containingAreas: [] };
}

/**
 * The assertion this whole file exists for.
 *
 * Not "both returned arrays" and not "the arrays are equal" — ingestion
 * legitimately emits many keys (one per allowlisted component plus the venue
 * itself) while a selection emits at most two. What must hold is that they
 * *overlap*: at least one key in common is exactly what makes the database
 * join return the venue when the visitor selects the place.
 */
function assertIdentityJoin(params: {
  label: string;
  ingestion: PlaceDetails;
  selected: PlaceIdentityDetails;
}): void {
  const ingestionKeys = extractSearchAreaCandidates(params.ingestion).map(
    (candidate) => candidate.identityKey,
  );

  const searchKeys = extractSelectedPlaceIdentities(params.selected);

  const shared = searchKeys.filter((key) => ingestionKeys.includes(key));

  report(
    params.label,
    shared.length > 0,
    shared.length > 0
      ? undefined
      : `no shared key.\n         search:    ${JSON.stringify(searchKeys, null, 2)}\n         ingestion: ${JSON.stringify(ingestionKeys, null, 2)}`,
  );

  if (shared.length > 0) {
    console.log(`         via ${shared[0]}`);
  }
}

// =============================================================================
// Fixtures — India, Latin script
// =============================================================================

/**
 * A venue, as returned when an admin attaches it to a competition.
 *
 * `types` carries no geographic type, which is what makes it a venue: it has a
 * provider identity but no component form of its own.
 */
const VIT_PUNE = ingestionDetails({
  placeId: "ChIJ_____VIT_PUNE",
  displayName: "Vishwakarma Institute of Technology",
  types: ["university", "point_of_interest", "establishment"],
  components: [
    component("666", ["street_number"]),
    component("Upper Indiranagar", ["neighborhood", "political"]),
    component("Bibwewadi", ["sublocality_level_1", "sublocality", "political"]),
    component("Pune", ["locality", "political"]),
    component("Pune", ["administrative_area_level_3", "political"]),
    component("Pune Division", ["administrative_area_level_2", "political"]),
    component("Maharashtra", ["administrative_area_level_1", "political"], "MH"),
    component("India", ["country", "political"], "IN"),
    component("411037", ["postal_code"]),
  ],
});

/** The city itself — a different place id and a different response. */
const PUNE = identityDetails({
  placeId: "ChIJARFGZy6_wjsRQ-Oenb9DjYI",
  displayName: "Pune",
  types: ["locality", "political"],
  components: [
    component("Pune", ["locality", "political"]),
    component("Pune", ["administrative_area_level_3", "political"]),
    component("Pune Division", ["administrative_area_level_2", "political"]),
    component("Maharashtra", ["administrative_area_level_1", "political"], "MH"),
    component("India", ["country", "political"], "IN"),
  ],
});

const MAHARASHTRA = identityDetails({
  placeId: "ChIJ-dacnBfcAToRVi_amThVAAQ",
  displayName: "Maharashtra",
  types: ["administrative_area_level_1", "political"],
  components: [
    component("Maharashtra", ["administrative_area_level_1", "political"], "MH"),
    component("India", ["country", "political"], "IN"),
  ],
});

const INDIA = identityDetails({
  placeId: "ChIJkbeSa_BfYzARphNChaFPjNc",
  displayName: "India",
  types: ["country", "political"],
  components: [component("India", ["country", "political"], "IN")],
});

/** A neighbourhood inside Pune — narrower than the city, and distinct from it. */
const BIBWEWADI = identityDetails({
  placeId: "ChIJjXaFQJfqwjsRduKkb30_fRY",
  displayName: "Bibwewadi",
  types: ["sublocality_level_1", "sublocality", "political"],
  components: [
    component("Bibwewadi", ["sublocality_level_1", "sublocality", "political"]),
    component("Pune", ["locality", "political"]),
    component("Pune", ["administrative_area_level_3", "political"]),
    component("Pune Division", ["administrative_area_level_2", "political"]),
    component("Maharashtra", ["administrative_area_level_1", "political"], "MH"),
    component("India", ["country", "political"], "IN"),
  ],
});

/**
 * A venue in a different neighbourhood of the same city.
 *
 * Exists to prove that selecting Bibwewadi does **not** reach it — expansion
 * runs downward from a place to what is inside it, never sideways.
 */
const PICT_KONDHWA = ingestionDetails({
  placeId: "ChIJ_____PICT",
  displayName: "Pune Institute of Computer Technology",
  types: ["university", "point_of_interest", "establishment"],
  components: [
    component("Kondhwa Budruk", ["sublocality_level_1", "sublocality", "political"]),
    component("Pune", ["locality", "political"]),
    component("Pune", ["administrative_area_level_3", "political"]),
    component("Pune Division", ["administrative_area_level_2", "political"]),
    component("Maharashtra", ["administrative_area_level_1", "political"], "MH"),
    component("India", ["country", "political"], "IN"),
  ],
});

// =============================================================================
// Fixtures — non-Latin scripts
// =============================================================================

/**
 * A venue in Tokyo, with names as the provider returns them in Japanese.
 *
 * Under the previous ASCII-only normalizer every character here was stripped,
 * so "新宿区" and "渋谷区" both normalized to the empty string and produced the
 * byte-identical key `component:locality::日本` — two different wards merged
 * into one entity. That is the one failure the identity design is otherwise
 * structurally incapable of, which is why this fixture is not optional.
 */
const TOKYO_OPERA_CITY = ingestionDetails({
  placeId: "ChIJ_____TOKYO_OPERA_CITY",
  displayName: "東京オペラシティ",
  types: ["premise", "point_of_interest", "establishment"],
  components: [
    component("西新宿", ["sublocality_level_1", "sublocality", "political"]),
    component("新宿区", ["locality", "political"]),
    component("東京都", ["administrative_area_level_1", "political"]),
    component("日本", ["country", "political"], "JP"),
  ],
});

const SHINJUKU = identityDetails({
  placeId: "ChIJ_____SHINJUKU",
  displayName: "新宿区",
  types: ["locality", "political"],
  components: [
    component("新宿区", ["locality", "political"]),
    component("東京都", ["administrative_area_level_1", "political"]),
    component("日本", ["country", "political"], "JP"),
  ],
});

/** A different ward of the same prefecture. Must not collide with Shinjuku. */
const SHIBUYA = identityDetails({
  placeId: "ChIJ_____SHIBUYA",
  displayName: "渋谷区",
  types: ["locality", "political"],
  components: [
    component("渋谷区", ["locality", "political"]),
    component("東京都", ["administrative_area_level_1", "political"]),
    component("日本", ["country", "political"], "JP"),
  ],
});

/**
 * Devanagari, in the project's primary market.
 *
 * Deliberately written in NFC on the ingestion side and NFD on the search
 * side. Google does not guarantee a normalization form, and two responses
 * about one place that differ only in encoding must still join — otherwise the
 * filter fails for reasons no one could ever see in a log.
 */
const PUNE_VENUE_DEVANAGARI = ingestionDetails({
  placeId: "ChIJ_____DEVANAGARI_VENUE",
  displayName: "शिवाजीनगर".normalize("NFC"),
  types: ["point_of_interest", "establishment"],
  components: [
    component("पुणे".normalize("NFC"), ["locality", "political"]),
    component("महाराष्ट्र".normalize("NFC"), ["administrative_area_level_1", "political"]),
    component("भारत".normalize("NFC"), ["country", "political"], "IN"),
  ],
});

const PUNE_DEVANAGARI = identityDetails({
  placeId: "ChIJ_____DEVANAGARI_PUNE",
  displayName: "पुणे".normalize("NFD"),
  types: ["locality", "political"],
  components: [
    component("पुणे".normalize("NFD"), ["locality", "political"]),
    component("महाराष्ट्र".normalize("NFD"), ["administrative_area_level_1", "political"]),
    component("भारत".normalize("NFD"), ["country", "political"], "IN"),
  ],
});

// =============================================================================
// The round trip
// =============================================================================

function verifyRoundTrip(): void {
  console.log(
    "\n== Invariant: ingestion identity and search identity join, per level ==",
  );

  assertIdentityJoin({
    label: "locality — selecting Pune reaches a venue in Pune",
    ingestion: VIT_PUNE,
    selected: PUNE,
  });

  assertIdentityJoin({
    label: "administrative region — selecting Maharashtra reaches the venue",
    ingestion: VIT_PUNE,
    selected: MAHARASHTRA,
  });

  assertIdentityJoin({
    label: "country — selecting India reaches the venue",
    ingestion: VIT_PUNE,
    selected: INDIA,
  });

  assertIdentityJoin({
    label: "sublocality — selecting Bibwewadi reaches the venue inside it",
    ingestion: VIT_PUNE,
    selected: BIBWEWADI,
  });

  assertIdentityJoin({
    label: "non-Latin (Japanese) — selecting 新宿区 reaches a venue there",
    ingestion: TOKYO_OPERA_CITY,
    selected: SHINJUKU,
  });

  assertIdentityJoin({
    label:
      "non-Latin (Devanagari, NFC ingestion vs NFD selection) — still joins",
    ingestion: PUNE_VENUE_DEVANAGARI,
    selected: PUNE_DEVANAGARI,
  });
}

// =============================================================================
// The other half: keys that must NOT collide
// =============================================================================

/**
 * A join test alone can be satisfied by a normalizer that maps everything to
 * one value. These assert the opposite direction, which is what makes the
 * matches above meaningful.
 */
function verifyNoFalseMerges(): void {
  console.log("\n== Invariant: distinct places produce distinct identities ==");

  const shinjuku = extractSelectedPlaceIdentities(SHINJUKU);
  const shibuya = extractSelectedPlaceIdentities(SHIBUYA);

  const overlap = shinjuku.filter((key) => shibuya.includes(key));

  report(
    "two Japanese wards of one prefecture do not merge",
    overlap.length === 0,
    `shared: ${JSON.stringify(overlap)}`,
  );

  report(
    "neither Japanese ward normalizes to an empty name segment",
    shinjuku.every((key) => !key.includes("::")) &&
      shibuya.every((key) => !key.includes("::")),
    `${JSON.stringify(shinjuku)} / ${JSON.stringify(shibuya)}`,
  );

  // Sideways expansion: Bibwewadi and Kondhwa Budruk are both inside Pune, so
  // a Pune-level key is legitimately shared. What must not be shared is the
  // neighbourhood key itself.
  const bibwewadiKeys = extractSelectedPlaceIdentities(BIBWEWADI);

  const pictKeys = extractSearchAreaCandidates(PICT_KONDHWA).map(
    (candidate) => candidate.identityKey,
  );

  report(
    "selecting Bibwewadi does not reach a venue in Kondhwa Budruk",
    bibwewadiKeys.every((key) => !pictKeys.includes(key)),
    `shared: ${JSON.stringify(bibwewadiKeys.filter((k) => pictKeys.includes(k)))}`,
  );

  // Upward expansion: selecting a city must not silently mean its state.
  const puneKeys = extractSelectedPlaceIdentities(PUNE);
  const maharashtraKeys = extractSelectedPlaceIdentities(MAHARASHTRA);

  report(
    "selecting Pune does not implicitly select Maharashtra",
    puneKeys.every((key) => !maharashtraKeys.includes(key)),
  );

  report(
    "selecting Pune does not implicitly select India",
    puneKeys.every(
      (key) => !extractSelectedPlaceIdentities(INDIA).includes(key),
    ),
  );
}

/**
 * A venue is not an area.
 *
 * Selecting a university as a search target must yield its provider identity
 * and nothing else. Inventing a component key for it would make every future
 * search of that place match the wrong areas.
 */
function verifyVenueYieldsProviderIdentityOnly(): void {
  console.log("\n== Invariant: a venue has no component identity ==");

  const keys = extractSelectedPlaceIdentities(VIT_PUNE);

  report(
    "a university yields exactly one identity",
    keys.length === 1,
    JSON.stringify(keys),
  );

  report(
    "and it is the provider identity, not an invented component key",
    keys[0] === "google:place:ChIJ_____VIT_PUNE",
    JSON.stringify(keys),
  );
}

/**
 * The self-consistency check must not be satisfied by coincidence.
 *
 * `selfComponentIdentity` accepts a component only when exactly one carries
 * the place's own geographic type *and* its text matches the display name.
 * A place whose response disagrees with itself falls back to provider identity
 * rather than guessing.
 */
function verifyAmbiguousSelfComponentRefuses(): void {
  console.log("\n== Invariant: an ambiguous self-component is refused ==");

  const mismatched = identityDetails({
    placeId: "ChIJ_____MISMATCH",
    displayName: "Greater Springfield",
    types: ["locality", "political"],
    components: [
      // The locality component names something else, so the response does not
      // describe itself consistently.
      component("Springfield", ["locality", "political"]),
      component("Illinois", ["administrative_area_level_1", "political"]),
      component("United States", ["country", "political"], "US"),
    ],
  });

  const keys = extractSelectedPlaceIdentities(mismatched);

  report(
    "a display name that disagrees with its component yields provider identity only",
    keys.length === 1 && keys[0] === "google:place:ChIJ_____MISMATCH",
    JSON.stringify(keys),
  );
}

// =============================================================================
// Normalization units
// =============================================================================

function verifyNormalization(): void {
  console.log("\n== Invariant: identity normalization is Unicode-safe ==");

  const nonEmpty: [string, string][] = [
    ["Pune", "pune"],
    ["Puné", "pune"],
    ["São Paulo", "sao-paulo"],
    ["Île-de-France", "ile-de-france"],
  ];

  for (const [input, expected] of nonEmpty) {
    report(
      `"${input}" normalizes to "${expected}"`,
      normalizeIdentityName(input) === expected,
      `got ${JSON.stringify(normalizeIdentityName(input))}`,
    );
  }

  // The regression that motivated the rewrite: these all used to become "".
  for (const input of ["東京", "新宿区", "पुणे", "महाराष्ट्र", "Москва", "القاهرة", "서울"]) {
    const result = normalizeIdentityName(input);

    report(
      `"${input}" survives normalization`,
      result !== null && result.length > 0,
      `got ${JSON.stringify(result)}`,
    );
  }

  // Canonical equivalence, which is what lets two provider responses about one
  // place agree even when they are encoded differently.
  for (const input of ["पुणे", "서울", "é"]) {
    report(
      `"${input}" normalizes identically in NFC and NFD`,
      normalizeIdentityName(input.normalize("NFC")) ===
        normalizeIdentityName(input.normalize("NFD")),
    );
  }

  report(
    "a name with no letters or digits yields null rather than an empty segment",
    normalizeIdentityName("---") === null &&
      normalizeIdentityName("!!!") === null,
  );

  report(
    "case and surrounding whitespace do not fork a place",
    normalizeIdentityName("  PUNE  ") === normalizeIdentityName("pune"),
  );
}

// =============================================================================

function main(): void {
  verifyRoundTrip();
  verifyNoFalseMerges();
  verifyVenueYieldsProviderIdentityOnly();
  verifyAmbiguousSelfComponentRefuses();
  verifyNormalization();

  console.log(`\n${checks - failures}/${checks} checks passed.`);

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main();
