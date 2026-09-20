import type { DimensionId } from "@/modules/recommendations";

export interface CompetitionPreferenceEntryDTO {
  readonly dimension: DimensionId;
  readonly value: string;
  readonly weight: number;
}
