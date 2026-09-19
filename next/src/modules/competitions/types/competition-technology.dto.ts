import type { TechnologyType } from "@/generated/prisma";
import type { AssetDTO } from "@/modules/assets/dto/asset.dto";

/**
 * One Technology relevant to a competition.
 *
 * `CompetitionTechnology` has no fields of its own beyond the composite key
 * (`competitionId`, `technologyId`) — unlike Project and Portfolio, a
 * competition's technologies are explicitly not ordered/reorderable, so this
 * carries nothing beyond the Technology's own display fields. `id` here is
 * the Technology's id.
 */
export interface CompetitionTechnologyDTO {
  id: string;

  name: string;

  slug: string;

  type: TechnologyType;

  iconAsset: AssetDTO | null;
}
