import { assetMapper } from "@/modules/assets/mapper/asset.mapper";

import type { CompetitionTechnologyWithTechnology } from "./competition-technology.repository";
import type { CompetitionTechnologyDTO } from "../types/competition-technology.dto";

export class CompetitionTechnologyMapper {
  toDTO(
    competitionTechnology: CompetitionTechnologyWithTechnology,
  ): CompetitionTechnologyDTO {
    const { technology } = competitionTechnology;

    return {
      id: technology.id,

      name: technology.name,

      slug: technology.slug,

      type: technology.type,

      iconAsset: technology.iconAsset
        ? assetMapper.toDTO(technology.iconAsset)
        : null,
    };
  }

  toDTOs(
    competitionTechnologies: CompetitionTechnologyWithTechnology[],
  ): CompetitionTechnologyDTO[] {
    return competitionTechnologies.map((competitionTechnology) =>
      this.toDTO(competitionTechnology),
    );
  }
}

export const competitionTechnologyMapper = new CompetitionTechnologyMapper();
