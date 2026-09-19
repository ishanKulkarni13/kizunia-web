import {
  LocationProvider,
  SearchAreaRelation,
  SearchAreaSource,
} from "@/generated/prisma";

import type {
  PlaceAddressComponent,
  PlaceDetails,
  PlaceIdentityDetails,
  SearchAreaCandidate,
} from "../types/place";
import { contextualIdentityKey, providerIdentityKey } from "./identity";

/**
 * Bumped whenever the rules below change the identity keys they produce.
 *
 * Cached place resolutions record the version that produced them, so changing
 * extraction logically invalidates every cached entry instead of leaving stale
 * keys that silently stop matching what ingestion now writes.
 *
 * Version history:
 *   1  initial rules
 *   2  explicit component rank table replacing array-order parent context
 *   3  Unicode-aware identity normalization, and a pinned provider language for
 *      every identity-bearing lookup. Both change the bytes of component keys,
 *      so every cached resolution produced under 2 is logically invalid.
 *
 * NOTE: `SearchArea.identityKey` rows written by ingestion carry no version of
 * their own, so bumping this invalidates the *read* side only. Stored rows
 * still hold keys built under the previous rules until they are re-ingested.
 */
export const EXTRACTION_VERSION = 3;

/**
 * Geographic component types that may become a discovery path, ranked
 * narrowest to broadest.
 *
 * Two jobs in one table. Membership is the allowlist — anything absent is
 * ignored, so street numbers, routes and postal codes never become search
 * areas. The rank decides which components count as an entity's parent context:
 * strictly higher rank only.
 *
 * The rank is an explicit, deliberate assumption. Google's array order is *not*
 * used, because ordering is not guaranteed across countries; and the previous
 * implementation's fallback — treating an unlisted type as "below everything" —
 * forked one real entity into two identities. Nashik `administrative_area_level_3`
 * reached via Yeola (which has no `locality`) produced a different key than the
 * same entity reached via K.K. Wagh (which does).
 *
 * Where this ranking is wrong for some country, the consequence is a key that
 * does not match — a missed result, never two different places merged together.
 * That is the safe direction, and the reason ranking is preferred over guessing.
 */
const COMPONENT_RANK: Record<string, number> = {
  neighborhood: 0,
  sublocality_level_5: 0,
  sublocality_level_4: 0,
  sublocality_level_3: 0,
  sublocality_level_2: 0,

  sublocality: 1,
  sublocality_level_1: 1,

  locality: 2,
  postal_town: 2,

  administrative_area_level_3: 3,
  administrative_area_level_2: 4,
  administrative_area_level_1: 5,

  country: 6,
};

/**
 * Relative strength of each evidence source, strongest first.
 *
 * Only used to break ties between candidates that already share an identity —
 * it never decides identity itself. Two candidates with different keys are two
 * entities, however similar they look.
 */
const SOURCE_PRIORITY: Record<SearchAreaSource, number> = {
  SELECTED_PLACE: 0,
  CONTAINING_PLACE: 1,
  ADDRESS_DESCRIPTOR: 2,
  ADDRESS_COMPONENT: 3,
};

/** The allowlisted geographic type of a component, or null if it has none. */
function geographicType(component: PlaceAddressComponent): string | null {
  return component.types.find((type) => type in COMPONENT_RANK) ?? null;
}

/**
 * The components that contain a given one: allowlisted, and strictly broader.
 *
 * "Strictly broader" is what keeps an entity's identity stable no matter which
 * venue it was reached through, since it depends only on the entity's own rank
 * rather than on which siblings happen to appear alongside it.
 */
function parentContextFor(
  components: readonly PlaceAddressComponent[],
  rank: number,
): string[] {
  return components
    .filter((component) => {
      const type = geographicType(component);

      return type !== null && COMPONENT_RANK[type] > rank;
    })
    .sort((a, b) => COMPONENT_RANK[geographicType(a)!] - COMPONENT_RANK[geographicType(b)!])
    .map((component) => component.longName);
}

/**
 * Human-readable context for a component, e.g. "Maharashtra, India".
 *
 * Display only — `identityKey` is what decides whether two rows are the same
 * entity, and it is built separately.
 */
function contextLabelFor(
  components: readonly PlaceAddressComponent[],
  rank: number,
): string | null {
  const parts = parentContextFor(components, rank);

  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Derives the places a location should be discoverable through.
 *
 * Pure by design — no database, no network, no clock. Every decision about
 * which competitions surface for which place is made here, so it has to be
 * runnable against recorded payloads and reasoned about in isolation.
 *
 * A candidate is emitted only where the provider gave explicit evidence about
 * that specific entity. Nothing is inferred from a shared or similar name.
 */
export function extractSearchAreaCandidates(
  details: PlaceDetails,
  provider: LocationProvider = LocationProvider.GOOGLE,
): SearchAreaCandidate[] {
  const candidates: SearchAreaCandidate[] = [];

  // -------------------------------------------------------------------------
  // 1. The selected place itself — the only EXACT relation
  // -------------------------------------------------------------------------

  candidates.push({
    identityKey: providerIdentityKey(provider, details.providerPlaceId),
    displayName: details.displayName,
    providerKind: details.types[0] ?? null,
    contextLabel: contextLabelFor(details.addressComponents, -1),
    provider,
    providerLocationId: details.providerPlaceId,
    latitude: details.latitude,
    longitude: details.longitude,
    relation: SearchAreaRelation.EXACT,
    source: SearchAreaSource.SELECTED_PLACE,
  });

  // -------------------------------------------------------------------------
  // 2. Provider-verified containing entities
  // -------------------------------------------------------------------------
  //
  // The provider layer has already discarded anything that is not a genuine
  // geographic area, which is what stops a venue being recorded as containing
  // itself: Google's address descriptors cite the subject place as a nearby
  // landmark, under a second listing with its own place id, and that listing is
  // a `premise` rather than an area.
  //
  // Only WITHIN survives. NEAR and OUTSKIRTS describe proximity, and treating
  // either as containment would make a competition discoverable through a place
  // it is not inside.
  for (const area of details.containingAreas) {
    if (area.containment !== "WITHIN") {
      continue;
    }

    // Without a place id there is no strong identity, and an area's own
    // ancestry is not knowable from the parent's payload, so a contextual key
    // would be guesswork. Skipping is the conservative choice.
    if (!area.providerPlaceId) {
      continue;
    }

    candidates.push({
      identityKey: providerIdentityKey(provider, area.providerPlaceId),
      displayName: area.name,
      providerKind: area.types[0] ?? null,
      contextLabel: area.contextLabel,
      provider,
      providerLocationId: area.providerPlaceId,
      latitude: area.latitude,
      longitude: area.longitude,
      relation: SearchAreaRelation.WITHIN,
      source: area.source,
    });
  }

  // -------------------------------------------------------------------------
  // 3. Allowlisted address components
  // -------------------------------------------------------------------------
  //
  // Google never returns a place id for an address component, so these are the
  // only way Pune, Maharashtra and India get an identity at all. They are also
  // what a user's own selection resolves to, which is what lets a selected
  // place match areas stored during ingestion.
  for (const component of details.addressComponents) {
    const type = geographicType(component);

    if (!type) {
      continue;
    }

    const rank = COMPONENT_RANK[type];

    const identityKey = contextualIdentityKey({
      name: component.longName,
      providerKind: type,
      parentContext: parentContextFor(details.addressComponents, rank),
    });

    // A component whose name (or whose ancestry) cannot be normalized has no
    // safe identity. Emitting a key with an empty segment would let two
    // different places collide, so the component is dropped instead: one fewer
    // discovery path, rather than a wrong one.
    if (identityKey === null) {
      continue;
    }

    candidates.push({
      identityKey,
      displayName: component.longName,
      providerKind: type,
      contextLabel: contextLabelFor(details.addressComponents, rank),
      provider: null,
      providerLocationId: null,
      latitude: null,
      longitude: null,
      relation: SearchAreaRelation.WITHIN,
      source: SearchAreaSource.ADDRESS_COMPONENT,
    });
  }

  return dedupeCandidates(candidates);
}

/**
 * The identities that represent a place a user has selected as a search target.
 *
 * Deliberately describes *only that place*, never its ancestors. Selecting Pune
 * must search Pune, not Maharashtra and India as well — the containment stored
 * at ingestion already makes Pune's competitions reachable, and adding ancestors
 * here would silently widen every search.
 *
 * Two identities are produced where possible, because ingestion may have
 * recorded the same real place either way and neither can be assumed:
 *
 *   - the provider identity, which is strong and unambiguous
 *   - the component identity, which is how the place appears inside *another*
 *     place's address, and therefore how it was most likely stored
 *
 * Matching on either is what makes a Google-selected place find areas that were
 * only ever seen as address components, without merging any database rows.
 */
export function extractSelectedPlaceIdentities(
  details: PlaceIdentityDetails,
  provider: LocationProvider = LocationProvider.GOOGLE,
): string[] {
  const identities = [providerIdentityKey(provider, details.providerPlaceId)];

  const componentIdentity = selfComponentIdentity(details, provider);

  if (componentIdentity) {
    identities.push(componentIdentity);
  }

  return [...new Set(identities)];
}

/**
 * The component identity of the place itself, when it can be established
 * beyond doubt.
 *
 * Conservative on purpose. A weak or guessed key here would match the wrong
 * areas for every future search of that place, so every step below refuses
 * rather than approximates, and the caller falls back to provider identity
 * alone — which is always correct, just narrower.
 */
function selfComponentIdentity(
  details: PlaceIdentityDetails,
  provider: LocationProvider,
): string | null {
  void provider;

  // A place the provider does not classify as a geographic area — a university,
  // a stadium, a premise — has no component form. This is the expected outcome
  // for venues, not a failure.
  const geographicTypes = details.types.filter((type) => type in COMPONENT_RANK);

  if (geographicTypes.length === 0) {
    return null;
  }

  const matches = details.addressComponents.filter((component) =>
    component.types.some((type) => geographicTypes.includes(type)),
  );

  // Exactly one candidate, and it must name the place it claims to be. This is
  // self-consistency inside a single response about a single place — not a
  // comparison between two different entities, which is never done anywhere.
  if (matches.length !== 1) {
    return null;
  }

  const self = matches[0];

  if (self.longName !== details.displayName) {
    return null;
  }

  const type = geographicType(self);

  if (!type) {
    return null;
  }

  return contextualIdentityKey({
    name: self.longName,
    providerKind: type,
    parentContext: parentContextFor(
      details.addressComponents,
      COMPONENT_RANK[type],
    ),
  });
}

/**
 * Collapses candidates that share an identity, keeping the strongest source.
 *
 * Only exact identity matches collapse. Candidates with different keys are left
 * alone even when they look alike, because a shared name is not evidence that
 * two places are the same — Kondhwa and Kondhwa Budruk are distinct entities
 * with distinct place ids.
 */
export function dedupeCandidates(
  candidates: readonly SearchAreaCandidate[],
): SearchAreaCandidate[] {
  const strongest = new Map<string, SearchAreaCandidate>();

  for (const candidate of candidates) {
    const existing = strongest.get(candidate.identityKey);

    if (
      !existing ||
      SOURCE_PRIORITY[candidate.source] < SOURCE_PRIORITY[existing.source]
    ) {
      strongest.set(candidate.identityKey, candidate);
    }
  }

  return [...strongest.values()];
}
