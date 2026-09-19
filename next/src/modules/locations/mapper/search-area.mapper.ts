import type { SearchArea } from "@/generated/prisma";

import type { SearchAreaDTO } from "../types/search-area.dto";

/**
 * Converts a stored SearchArea into its UI-facing DTO.
 *
 * Deliberately omits `identityKey`, coordinates, and provider ids: those are
 * internal identity and enrichment concerns, and the filter only needs enough
 * to render a distinguishable option.
 */
export class SearchAreaMapper {
  toDTO(area: SearchArea): SearchAreaDTO {
    return {
      id: area.id,

      displayName: area.displayName,

      providerKind: area.providerKind,

      contextLabel: area.contextLabel,
    };
  }

  toDTOs(areas: SearchArea[]): SearchAreaDTO[] {
    return areas.map((area) => this.toDTO(area));
  }
}

export const searchAreaMapper = new SearchAreaMapper();
