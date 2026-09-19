import type { CompetitionAssetSlot } from "./asset-slot";

export interface SetCompetitionAssetDTO {
  slot: CompetitionAssetSlot;

  /**
   * An already-finalized, ACTIVE Asset id — never raw upload metadata.
   * `null` clears the slot (detaching, not deleting, the previous Asset).
   */
  assetId: string | null;
}
