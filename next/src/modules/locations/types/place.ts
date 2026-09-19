import type {
  LocationProvider,
  SearchAreaRelation,
  SearchAreaSource,
} from "@/generated/prisma";

/**
 * One option in the admin's place picker.
 *
 * Carries no geographic data of its own — only enough text to choose, plus the
 * provider id needed to resolve the full record. Suggestions are transient and
 * must never be persisted; picking one triggers a `resolve()` call, and it is
 * that result which becomes a Location.
 */
export interface PlaceSuggestion {
  providerPlaceId: string;

  /** The place itself, e.g. "Vishwakarma Institute of Technology". */
  primaryText: string;

  /** Disambiguating context, e.g. "Bibwewadi, Pune, Maharashtra, India". */
  secondaryText: string | null;
}

/**
 * A structured piece of an address, with the provider's own type strings kept
 * verbatim.
 *
 * Types are not normalized into a Kizunia vocabulary: `administrative_area_level_2`
 * means a district in one country and a county in another, and flattening that
 * distinction is exactly how "Nashik District" would get confused with
 * "Nashik City".
 */
export interface PlaceAddressComponent {
  longName: string;

  shortName: string | null;

  types: string[];
}

/**
 * A larger entity the provider says this place sits inside.
 *
 * `containment` is reported rather than assumed. Only `WITHIN` is usable
 * evidence of containment — `NEAR` and `OUTSKIRTS` describe proximity, which is
 * radius search's concern and must never become a discovery relationship.
 *
 * `types` is populated by resolving the area, not by trusting the parent's
 * payload. Google's address descriptors name the area but not what kind of
 * thing it is, and they routinely cite the subject place itself as a landmark —
 * under a separate listing with its own place id — so without the resolved
 * types a venue ends up recorded as containing itself.
 */
export interface PlaceContainingArea {
  /** Present for containing places and address descriptors; absent for bare
   * address components, which is why those rank lowest as an identity source. */
  providerPlaceId: string | null;

  name: string;

  /** The area's own provider types, resolved rather than assumed. */
  types: string[];

  /** Parent context for display, e.g. "Pune, Maharashtra, India". */
  contextLabel: string | null;

  latitude: number | null;

  longitude: number | null;

  containment: "WITHIN" | "OUTSKIRTS" | "NEAR";

  source: Extract<
    SearchAreaSource,
    "CONTAINING_PLACE" | "ADDRESS_DESCRIPTOR"
  >;
}

/**
 * Everything needed to derive a place's *identity*, and nothing more.
 *
 * This is what Competition search resolves. Deriving selected-place identities
 * reads only `types` and `addressComponents` (plus `displayName` for the
 * self-consistency check), so requesting containment evidence on this path
 * would bill a fan-out of provider lookups whose result is discarded.
 *
 * Kept as a distinct type rather than an optional field so the two paths are
 * impossible to confuse: a function needing containment asks for
 * `PlaceDetails`, and a search-resolved place will not type-check as one.
 */
export interface PlaceIdentityDetails {
  providerPlaceId: string;

  displayName: string;

  formattedAddress: string | null;

  /** The provider's own type strings for the place itself. */
  types: string[];

  latitude: number | null;

  longitude: number | null;

  addressComponents: PlaceAddressComponent[];
}

/**
 * A fully resolved place — everything ingestion needs, in provider-neutral form.
 *
 * Extends the identity shape with the containment evidence only ingestion
 * uses. Once this has been normalized into a Location and its SearchAreas, the
 * competition no longer depends on the provider in any way.
 */
export interface PlaceDetails extends PlaceIdentityDetails {
  containingAreas: PlaceContainingArea[];
}

/**
 * A SearchArea that extraction believes should exist, before anything is
 * persisted or deduplicated against the database.
 */
export interface SearchAreaCandidate {
  /** Deterministic identity — see `utils/identity.ts`. */
  identityKey: string;

  displayName: string;

  providerKind: string | null;

  contextLabel: string | null;

  provider: LocationProvider | null;

  providerLocationId: string | null;

  latitude: number | null;

  longitude: number | null;

  relation: SearchAreaRelation;

  source: SearchAreaSource;
}

/**
 * A classified provider failure.
 *
 * Carries the transport's own status rather than a message the caller has to
 * pattern-match. Classifying by `error.message.includes("404")` — which this
 * replaced — couples two layers through prose and cannot tell a 429 from a
 * 500, which is the one distinction that changes what the caller should do.
 */
export type PlaceProviderErrorKind =
  /** The id is not resolvable. Permanent for this id. */
  | "NOT_FOUND"
  /** Quota or throttling. Transient, but retrying immediately makes it worse. */
  | "RATE_LIMITED"
  /** Transport failure or provider-side error. Transient. */
  | "UNAVAILABLE"
  /** A success response whose payload cannot be used. */
  | "MALFORMED";

export class PlaceProviderError extends Error {
  readonly kind: PlaceProviderErrorKind;

  /** HTTP status where one was received; `null` for transport failures. */
  readonly status: number | null;

  constructor(params: {
    kind: PlaceProviderErrorKind;
    message: string;
    status?: number | null;
    cause?: unknown;
  }) {
    super(params.message, { cause: params.cause });

    this.name = "PlaceProviderError";
    this.kind = params.kind;
    this.status = params.status ?? null;
  }
}

/**
 * A source of place resolution.
 *
 * Three operations rather than two, because the two *resolve* paths have
 * genuinely different needs and conflating them was costing real money:
 *
 *   - `autocomplete` is cheap and runs per keystroke.
 *   - `resolveIdentity` is what Competition search calls. It asks for the
 *     minimum needed to derive identity keys and performs no containment
 *     fan-out.
 *   - `resolveForIngestion` is what location materialization calls. It may
 *     issue additional lookups to verify containment evidence, because those
 *     discovery paths are written once and read forever.
 *
 * The split is expressed in the return types, not in a flag: a boolean would
 * put the expensive default one forgotten argument away, and the whole point
 * is that the expensive path should be impossible to enter by accident.
 */
export interface PlaceProvider {
  readonly name: LocationProvider;

  autocomplete(params: {
    query: string;
    limit: number;
    signal: AbortSignal;
    /** Groups keystrokes into one billed session where the provider supports it. */
    sessionToken?: string;
  }): Promise<PlaceSuggestion[]>;

  /**
   * Minimal resolution for identity derivation. **No containment fan-out.**
   *
   * @throws PlaceProviderError classified for the caller.
   */
  resolveIdentity(params: {
    placeId: string;
    signal: AbortSignal;
    sessionToken?: string;
  }): Promise<PlaceIdentityDetails>;

  /**
   * Full resolution including verified containing areas.
   *
   * Costs additional provider lookups by design. Only ingestion should call it.
   *
   * @throws PlaceProviderError classified for the caller.
   */
  resolveForIngestion(params: {
    placeId: string;
    signal: AbortSignal;
    sessionToken?: string;
  }): Promise<PlaceDetails>;
}
