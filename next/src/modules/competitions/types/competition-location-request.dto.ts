import type { LocationPrecision, LocationProvider } from "@/generated/prisma";

/**
 * The place half of a location request.
 *
 * `displayName` is the only required field — during a provider outage an admin
 * must still be able to type a name and save.
 */
export interface LocationInputRequestDTO {
  displayName: string;

  precision?: LocationPrecision;

  country?: string | null;

  countryCode?: string | null;

  state?: string | null;

  stateCode?: string | null;

  city?: string | null;

  postalCode?: string | null;

  latitude?: number | null;

  longitude?: number | null;

  timezone?: string | null;

  provider?: LocationProvider;

  providerLocationId?: string | null;
}

/**
 * Dates are ISO strings on the wire, matching `UpdateCompetitionRequestDTO`.
 * The server coerces them back to dates during validation.
 */
export interface CreateCompetitionLocationRequestDTO {
  /** A place chosen from provider autocomplete, resolved server-side. */
  providerPlaceId?: string;

  /** Manual entry. Exactly one of this and `providerPlaceId` is required. */
  location?: LocationInputRequestDTO;

  label?: string | null;

  venueName?: string | null;

  address?: string | null;

  startDate?: string | null;

  endDate?: string | null;
}

export interface UpdateCompetitionLocationRequestDTO {
  providerPlaceId?: string;

  location?: LocationInputRequestDTO;

  label?: string | null;

  venueName?: string | null;

  address?: string | null;

  startDate?: string | null;

  endDate?: string | null;
}

export interface ReorderCompetitionLocationsRequestDTO {
  ids: string[];
}
