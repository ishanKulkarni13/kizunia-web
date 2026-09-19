import type { LocationPrecision, LocationProvider } from "@/generated/prisma";

/**
 * A stored location, as consumed by the UI.
 *
 * Coordinates are exposed as plain numbers — `Prisma.Decimal` is a database
 * concern and must not leak past the mapper.
 */
export interface LocationDTO {
  id: string;

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
}
