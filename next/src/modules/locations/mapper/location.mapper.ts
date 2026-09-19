import type { Location, Prisma } from "@/generated/prisma";

import type { LocationDTO } from "../types/location.dto";

/**
 * Converts a stored Location into its UI-facing DTO.
 *
 * `Prisma.Decimal` is a database representation and must not cross this
 * boundary — it does not survive JSON serialization as a number.
 */
export class LocationMapper {
  toDTO(location: Location): LocationDTO {
    return {
      id: location.id,

      displayName: location.displayName,

      precision: location.precision,

      country: location.country,

      countryCode: location.countryCode,

      state: location.state,

      stateCode: location.stateCode,

      city: location.city,

      postalCode: location.postalCode,

      latitude: this.toNumber(location.latitude),

      longitude: this.toNumber(location.longitude),

      timezone: location.timezone,

      provider: location.provider,
    };
  }

  /**
   * Unwraps a stored coordinate into a plain number.
   *
   * `Prisma.Decimal` serializes to an object rather than a number, so a DTO
   * that forwarded it unchanged would reach the client as unusable JSON.
   */
  private toNumber(value: Prisma.Decimal | null): number | null {
    return value === null ? null : value.toNumber();
  }
}

export const locationMapper = new LocationMapper();
