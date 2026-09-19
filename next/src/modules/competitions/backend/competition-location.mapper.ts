import { locationMapper } from "@/modules/locations";

import type { CompetitionLocationWithPlace } from "./competition-location.repository";
import type {
  CompetitionLocationDTO,
  CompetitionLocationSummaryDTO,
} from "../types/competition-location.dto";

export class CompetitionLocationMapper {
  toDTO(
    competitionLocation: CompetitionLocationWithPlace,
  ): CompetitionLocationDTO {
    return {
      id: competitionLocation.id,

      label: competitionLocation.label,

      venueName: competitionLocation.venueName,

      address: competitionLocation.address,

      startDate: competitionLocation.startDate?.toISOString() ?? null,

      endDate: competitionLocation.endDate?.toISOString() ?? null,

      order: competitionLocation.order,

      location: locationMapper.toDTO(competitionLocation.location),
    };
  }

  toDTOs(
    competitionLocations: CompetitionLocationWithPlace[],
  ): CompetitionLocationDTO[] {
    return competitionLocations.map((competitionLocation) =>
      this.toDTO(competitionLocation),
    );
  }

  toSummaryDTO(
    competitionLocation: CompetitionLocationWithPlace,
  ): CompetitionLocationSummaryDTO {
    return {
      id: competitionLocation.id,

      label: competitionLocation.label,

      displayName: competitionLocation.location.displayName,
    };
  }

  toSummaryDTOs(
    competitionLocations: CompetitionLocationWithPlace[],
  ): CompetitionLocationSummaryDTO[] {
    return competitionLocations.map((competitionLocation) =>
      this.toSummaryDTO(competitionLocation),
    );
  }
}

export const competitionLocationMapper = new CompetitionLocationMapper();
