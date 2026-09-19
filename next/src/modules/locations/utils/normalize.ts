import { LocationPrecision, LocationProvider } from "@/generated/prisma";

import type { LocationInput } from "../schemas/location-input";
import type { PlaceDetails } from "../types/place";

/**
 * A location input with every field settled — no `undefined`, no empty strings,
 * codes upper-cased, precision decided. This is the only shape the repository
 * accepts, so normalization can never be skipped by accident.
 */
export interface NormalizedLocation {
  displayName: string;
  precision: LocationPrecision;
  country: string | null;
  countryCode: string | null;
  state: string | null;
  stateCode: string | null;
  city: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  provider: LocationProvider;
  providerLocationId: string | null;
}

/**
 * Collapses `undefined` and blank strings to `null`.
 *
 * A location field is either known or it is not; `""` is neither, and letting
 * it through would make "known to be empty" indistinguishable from "unknown"
 * in every downstream filter.
 */
function orNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Derives how precise a location is from the fields that are actually present.
 *
 * VENUE is never inferred — a venue is a claim about a specific building that
 * no combination of city/state/country can establish, so only an explicit
 * precision (from a provider or the admin) can set it.
 */
export function inferPrecision(fields: {
  city: string | null;
  state: string | null;
  country: string | null;
}): LocationPrecision {
  if (fields.city) {
    return LocationPrecision.CITY;
  }

  if (fields.state) {
    return LocationPrecision.STATE;
  }

  if (fields.country) {
    return LocationPrecision.COUNTRY;
  }

  return LocationPrecision.UNKNOWN;
}

/**
 * Turns validated admin input into a row-ready location.
 *
 * Coordinates are dropped unless both halves survive normalization, mirroring
 * the schema-level pair check so a repository caller cannot bypass it.
 */
export function normalizeLocationInput(
  input: LocationInput,
): NormalizedLocation {
  const country = orNull(input.country);

  const state = orNull(input.state);

  const city = orNull(input.city);

  const countryCode = orNull(input.countryCode)?.toUpperCase() ?? null;

  const stateCode = orNull(input.stateCode)?.toUpperCase() ?? null;

  const hasCoordinates =
    input.latitude !== null &&
    input.latitude !== undefined &&
    input.longitude !== null &&
    input.longitude !== undefined;

  return {
    displayName: input.displayName.trim(),

    precision:
      input.precision ??
      inferPrecision({
        city,
        state,
        country,
      }),

    country,

    countryCode,

    state,

    stateCode,

    city,

    postalCode: orNull(input.postalCode),

    latitude: hasCoordinates ? input.latitude! : null,

    longitude: hasCoordinates ? input.longitude! : null,

    timezone: orNull(input.timezone),

    provider: input.provider ?? LocationProvider.MANUAL,

    providerLocationId: orNull(input.providerLocationId),
  };
}

/**
 * Administrative place types, mapped to the precision they imply.
 *
 * Anything absent from this map is a specific site rather than an area — a
 * campus, a stadium, an auditorium — and therefore VENUE.
 */
const ADMINISTRATIVE_PRECISION: Record<string, LocationPrecision> = {
  country: LocationPrecision.COUNTRY,
  administrative_area_level_1: LocationPrecision.STATE,
  administrative_area_level_2: LocationPrecision.CITY,
  locality: LocationPrecision.CITY,
  postal_town: LocationPrecision.CITY,
  sublocality: LocationPrecision.CITY,
  sublocality_level_1: LocationPrecision.CITY,
  neighborhood: LocationPrecision.CITY,
};

/**
 * Flattens a resolved place into the fields a Location stores.
 *
 * Only the structured pieces Kizunia actually uses are lifted out; the rest of
 * the provider payload feeds search-area extraction and is then discarded. Once
 * this has run the competition no longer depends on the provider at all — which
 * is the point of copying rather than referencing.
 */
export function placeDetailsToLocationInput(
  details: PlaceDetails,
  provider: LocationProvider = LocationProvider.GOOGLE,
): LocationInput {
  const component = (type: string) =>
    details.addressComponents.find((entry) => entry.types.includes(type));

  const country = component("country");
  const state = component("administrative_area_level_1");
  const city =
    component("locality") ??
    component("postal_town") ??
    component("administrative_area_level_2");
  const postalCode = component("postal_code");

  const administrativeType = details.types.find(
    (type) => type in ADMINISTRATIVE_PRECISION,
  );

  return {
    displayName: details.displayName,

    // A place the provider does not classify as an administrative area is a
    // specific site, which is the one case where VENUE can be asserted rather
    // than inferred.
    precision: administrativeType
      ? ADMINISTRATIVE_PRECISION[administrativeType]
      : LocationPrecision.VENUE,

    country: country?.longName ?? null,
    countryCode: country?.shortName ?? null,
    state: state?.longName ?? null,
    stateCode: state?.shortName ?? null,
    city: city?.longName ?? null,
    postalCode: postalCode?.longName ?? null,

    latitude: details.latitude,
    longitude: details.longitude,

    timezone: null,

    provider,
    providerLocationId: details.providerPlaceId,
  };
}
