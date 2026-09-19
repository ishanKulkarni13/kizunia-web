import { LocationProvider } from "@/generated/prisma";

import {
  PlaceProviderError,
  type PlaceContainingArea,
  type PlaceDetails,
  type PlaceIdentityDetails,
  type PlaceProvider,
  type PlaceSuggestion,
} from "../types/place";

const DEFAULT_BASE_URL = "https://places.googleapis.com/v1";

/**
 * The language every identity-bearing lookup is made in.
 *
 * =============================================================================
 * Why this is pinned and autocomplete's is not
 * =============================================================================
 *
 * Component identity keys are built from `addressComponents[].longText`, and
 * `selfComponentIdentity` accepts a component only if its text equals the
 * place's `displayName`. Both are localized strings: Google chooses their
 * language from the request's `languageCode`, falling back to the key's region
 * or the caller's `Accept-Language`. Leaving that unset makes a *persistent*
 * identity depend on ambient request conditions — the same place ingested
 * under one effective language and searched under another yields two different
 * keys for one entity, and the join silently returns nothing.
 *
 * So every call whose output reaches an identity key pins this constant.
 * Changing it changes the keys, which is why it is versioned alongside the
 * extraction rules via `EXTRACTION_VERSION`.
 *
 * `autocomplete` deliberately does **not** pin it. Its output is shown to a
 * person and never reaches an identity: the only field carried forward from a
 * suggestion is the place id, which is language-independent. Localizing what a
 * visitor reads while fixing what the database stores is the separation this
 * split exists to express.
 */
const IDENTITY_LANGUAGE_CODE = "en";

/**
 * Fields needed to derive identity — the search path.
 *
 * Notably excludes `addressDescriptor`. It is a separately-billed field group
 * whose only consumer is containment extraction, which search does not do.
 */
const IDENTITY_FIELD_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "types",
  "addressComponents",
].join(",");

/**
 * Fields needed for ingestion — identity plus containment evidence.
 *
 * Google bills by field group, so this is deliberately minimal beyond what
 * extraction actually reads. `containingPlaces` is not requested: it was
 * confirmed empty for the places this project ingests, so it would cost a
 * billed group and return nothing usable.
 */
const INGESTION_FIELD_MASK = [IDENTITY_FIELD_MASK, "addressDescriptor"].join(
  ",",
);

/**
 * Fields needed to decide whether a descriptor area is a real geographic area.
 *
 * Narrower than the others because nothing else about the area is used — it is
 * being classified, not ingested in its own right.
 */
const AREA_FIELD_MASK = [
  "id",
  "displayName",
  "types",
  "location",
  "addressComponents",
].join(",");

/**
 * Provider types that make a place usable as a containing area.
 *
 * Google's address descriptors give a name and a containment relation but no
 * type, and they cite the subject place itself among the areas — a university
 * appears inside its own descriptor under a second listing with a different
 * place id. That listing resolves to `premise`, so classifying by type rejects
 * it on the principle that a building is not a region, without ever comparing
 * names.
 */
const AREA_TYPES = new Set([
  "neighborhood",
  "sublocality",
  "sublocality_level_1",
  "sublocality_level_2",
  "sublocality_level_3",
  "sublocality_level_4",
  "sublocality_level_5",
  "locality",
  "postal_town",
  "administrative_area_level_1",
  "administrative_area_level_2",
  "administrative_area_level_3",
  "administrative_area_level_4",
  "administrative_area_level_5",
  "country",
]);

/** How many descriptor areas are worth resolving for one place. */
const MAX_DESCRIPTOR_AREAS = 6;

interface GoogleText {
  text?: string;
}

interface GoogleAutocompleteResponse {
  suggestions?: {
    placePrediction?: {
      placeId?: string;
      text?: GoogleText;
      structuredFormat?: {
        mainText?: GoogleText;
        secondaryText?: GoogleText;
      };
    };
  }[];
}

interface GoogleAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

interface GoogleDescriptorArea {
  name?: string;
  placeId?: string;
  displayName?: GoogleText;
  containment?: string;
}

interface GooglePlaceDetailsResponse {
  id?: string;
  displayName?: GoogleText;
  formattedAddress?: string;
  types?: string[];
  location?: {
    latitude?: number;
    longitude?: number;
  };
  addressComponents?: GoogleAddressComponent[];
  addressDescriptor?: {
    areas?: GoogleDescriptorArea[];
  };
}

/**
 * Maps an HTTP status onto a failure the caller can act on.
 *
 * The distinctions that matter: a place that does not exist is permanent and
 * worth remembering; a quota wall is transient but must not be retried
 * immediately; everything else is a transient outage.
 */
function kindForStatus(status: number): PlaceProviderError["kind"] {
  if (status === 404 || status === 400) {
    return "NOT_FOUND";
  }

  if (status === 429) {
    return "RATE_LIMITED";
  }

  return "UNAVAILABLE";
}

/**
 * Google Places (New) — autocomplete plus place details.
 *
 * Address Descriptors supply the containment evidence this architecture depends
 * on ("a campus is WITHIN a neighbourhood"), but the feature has limited
 * regional availability. Where it is absent the response simply omits it and
 * extraction falls back to address components: fewer discovery paths, none of
 * them wrong.
 */
export class GooglePlaceProvider implements PlaceProvider {
  readonly name = LocationProvider.GOOGLE;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
  ) {}

  async autocomplete({
    query,
    limit,
    signal,
    sessionToken,
  }: {
    query: string;
    limit: number;
    signal: AbortSignal;
    sessionToken?: string;
  }): Promise<PlaceSuggestion[]> {
    // No `languageCode`: suggestions are read by a person, and nothing here
    // reaches an identity key. See IDENTITY_LANGUAGE_CODE.
    const response = await this.request({
      url: `${this.baseUrl}/places:autocomplete`,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.apiKey,
        },
        body: JSON.stringify({
          input: query,
          ...(sessionToken && { sessionToken }),
        }),
        signal,
      },
      operation: "autocomplete",
    });

    const body = (await this.parseJson(
      response,
      "autocomplete",
    )) as GoogleAutocompleteResponse;

    return (body.suggestions ?? [])
      .map((suggestion) => {
        const prediction = suggestion.placePrediction;

        const placeId = prediction?.placeId;

        const primaryText =
          prediction?.structuredFormat?.mainText?.text ?? prediction?.text?.text;

        if (!placeId || !primaryText) {
          return null;
        }

        return {
          providerPlaceId: placeId,

          primaryText,

          secondaryText:
            prediction?.structuredFormat?.secondaryText?.text ?? null,
        } satisfies PlaceSuggestion;
      })
      .filter((suggestion): suggestion is PlaceSuggestion => suggestion !== null)
      .slice(0, limit);
  }

  /**
   * Search-path resolution: one request, no fan-out.
   *
   * The absence of a `toContainingAreas` call here is the whole point of the
   * method existing. Previously the single `resolve()` used by both paths
   * issued up to seven billed requests per cold search, six of which produced
   * data the search path never read.
   */
  async resolveIdentity({
    placeId,
    signal,
    sessionToken,
  }: {
    placeId: string;
    signal: AbortSignal;
    sessionToken?: string;
  }): Promise<PlaceIdentityDetails> {
    const body = await this.fetchDetails({
      placeId,
      fieldMask: IDENTITY_FIELD_MASK,
      signal,
      sessionToken,
    });

    return this.toIdentityDetails(body, placeId);
  }

  /**
   * Ingestion-path resolution: identity plus verified containment.
   *
   * Costs additional lookups by design — these discovery paths are written
   * once, per location, and then read on every search forever.
   */
  async resolveForIngestion({
    placeId,
    signal,
    sessionToken,
  }: {
    placeId: string;
    signal: AbortSignal;
    sessionToken?: string;
  }): Promise<PlaceDetails> {
    const body = await this.fetchDetails({
      placeId,
      fieldMask: INGESTION_FIELD_MASK,
      signal,
      sessionToken,
    });

    return {
      ...this.toIdentityDetails(body, placeId),
      containingAreas: await this.toContainingAreas(body, signal),
    };
  }

  // ==========================================================================
  // Transport
  // ==========================================================================

  /**
   * Issues a request and converts every failure into a classified error.
   *
   * Callers never see a bare `fetch` rejection, so no downstream layer has to
   * inspect a message to work out what happened.
   */
  private async request({
    url,
    init,
    operation,
  }: {
    url: string | URL;
    init: RequestInit;
    operation: string;
  }): Promise<Response> {
    let response: Response;

    try {
      response = await fetch(url, init);
    } catch (error) {
      // An abort is the caller's own timeout firing. It is surfaced as-is so
      // the service can distinguish "we gave up" from "Google is down".
      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }

      throw new PlaceProviderError({
        kind: "UNAVAILABLE",
        message: `Google ${operation} request failed before a response was received.`,
        cause: error,
      });
    }

    if (!response.ok) {
      throw new PlaceProviderError({
        kind: kindForStatus(response.status),
        status: response.status,
        message: `Google ${operation} responded with ${response.status} ${response.statusText}.`,
      });
    }

    return response;
  }

  private async parseJson(
    response: Response,
    operation: string,
  ): Promise<unknown> {
    try {
      return await response.json();
    } catch (error) {
      throw new PlaceProviderError({
        kind: "MALFORMED",
        message: `Google ${operation} returned a body that is not valid JSON.`,
        cause: error,
      });
    }
  }

  private async fetchDetails({
    placeId,
    fieldMask,
    signal,
    sessionToken,
  }: {
    placeId: string;
    fieldMask: string;
    signal: AbortSignal;
    sessionToken?: string;
  }): Promise<GooglePlaceDetailsResponse> {
    const url = new URL(`${this.baseUrl}/places/${encodeURIComponent(placeId)}`);

    // Pinned so the strings identity is derived from cannot drift with the
    // caller's locale. See IDENTITY_LANGUAGE_CODE.
    url.searchParams.set("languageCode", IDENTITY_LANGUAGE_CODE);

    if (sessionToken) {
      url.searchParams.set("sessionToken", sessionToken);
    }

    const response = await this.request({
      url,
      init: {
        headers: {
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask": fieldMask,
        },
        signal,
      },
      operation: "place details",
    });

    return (await this.parseJson(
      response,
      "place details",
    )) as GooglePlaceDetailsResponse;
  }

  private toIdentityDetails(
    body: GooglePlaceDetailsResponse,
    requestedPlaceId: string,
  ): PlaceIdentityDetails {
    const id = body.id ?? requestedPlaceId;

    const displayName = body.displayName?.text?.trim();

    if (!displayName) {
      throw new PlaceProviderError({
        kind: "MALFORMED",
        message: `Google returned no display name for place ${id}.`,
      });
    }

    return {
      providerPlaceId: id,

      displayName,

      formattedAddress: body.formattedAddress ?? null,

      types: body.types ?? [],

      latitude: body.location?.latitude ?? null,

      longitude: body.location?.longitude ?? null,

      addressComponents: (body.addressComponents ?? []).map((component) => ({
        longName: component.longText ?? "",
        shortName: component.shortText ?? null,
        types: component.types ?? [],
      })),
    };
  }

  // ==========================================================================
  // Containment (ingestion only)
  // ==========================================================================

  /**
   * Turns address descriptors into containment evidence, verifying each one.
   *
   * Descriptors carry real value — some neighbourhoods appear only here and
   * never in the address components — but they name an area without saying
   * what kind of thing it is, and Google includes the subject place itself
   * among them. Each candidate is therefore resolved and kept only if it is
   * genuinely a geographic area.
   *
   * A single failed lookup drops that one area rather than failing ingestion:
   * a missing discovery path is recoverable, a wrong one is not. A blanket
   * abort is different in kind and is logged, because it silently produces a
   * location with materially fewer discovery paths and nothing else would
   * record that it happened.
   */
  private async toContainingAreas(
    body: GooglePlaceDetailsResponse,
    signal: AbortSignal,
  ): Promise<PlaceContainingArea[]> {
    const within = (body.addressDescriptor?.areas ?? [])
      .filter((area) => this.toContainment(area.containment) === "WITHIN")
      .filter((area) => Boolean(area.placeId))
      .slice(0, MAX_DESCRIPTOR_AREAS);

    if (within.length === 0) {
      return [];
    }

    const resolved = await Promise.all(
      within.map((area) => this.classifyArea(area.placeId!, signal)),
    );

    const areas = resolved.filter(
      (area): area is PlaceContainingArea => area !== null,
    );

    if (signal.aborted && areas.length < within.length) {
      console.warn(
        `Google descriptor classification was aborted for place ${body.id ?? "unknown"}; ` +
          `kept ${areas.length} of ${within.length} candidate areas. ` +
          "This location has fewer discovery paths than it should.",
      );
    }

    return areas;
  }

  /**
   * Resolves one descriptor area and accepts it only if it is an area.
   *
   * Returns `null` for anything that is not — a premise, an establishment, a
   * street address — which is what keeps a venue from being recorded as
   * containing itself. The decision is made on the provider's own type data,
   * never by comparing the area's name to the place's.
   */
  private async classifyArea(
    placeId: string,
    signal: AbortSignal,
  ): Promise<PlaceContainingArea | null> {
    try {
      const body = await this.fetchDetails({
        placeId,
        fieldMask: AREA_FIELD_MASK,
        signal,
      });

      const types = body.types ?? [];

      if (!types.some((type) => AREA_TYPES.has(type))) {
        return null;
      }

      const name = body.displayName?.text?.trim();

      if (!name) {
        return null;
      }

      const components = body.addressComponents ?? [];

      const context = components
        .filter((component) => component.longText !== name)
        .map((component) => component.longText)
        .filter((part): part is string => Boolean(part));

      return {
        providerPlaceId: body.id ?? placeId,

        name,

        types,

        contextLabel: context.length > 0 ? context.join(", ") : null,

        latitude: body.location?.latitude ?? null,

        longitude: body.location?.longitude ?? null,

        containment: "WITHIN",

        source: "ADDRESS_DESCRIPTOR",
      };
    } catch {
      // Aborts and transport errors both land here. Dropping the area keeps
      // ingestion working with fewer discovery paths rather than failing it;
      // the blanket-abort case is reported by the caller, which can see how
      // many were lost.
      return null;
    }
  }

  /**
   * Anything not explicitly WITHIN is treated as proximity.
   *
   * An unrecognised or missing containment value must never be read as
   * containment — that would invent a discovery path from missing data.
   */
  private toContainment(
    value: string | undefined,
  ): PlaceContainingArea["containment"] {
    if (value === "WITHIN") {
      return "WITHIN";
    }

    return value === "OUTSKIRTS" ? "OUTSKIRTS" : "NEAR";
  }
}
