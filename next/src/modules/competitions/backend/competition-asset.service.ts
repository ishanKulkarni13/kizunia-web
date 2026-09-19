import prisma from "@/lib/prisma";
import { AssetPurpose } from "@/generated/prisma";

import { assertAssetReferenceAllowed } from "@/modules/assets/backend/reference-policy";
import { assetService } from "@/modules/assets/backend/service";

import type { CompetitionAssetSlot } from "../types/asset-slot";
import { competitionMapper } from "./mapper";
import { CompetitionRepository } from "./repository";
import { SetCompetitionAssetDTO } from "../types/set-asset.dto";
import type { CompetitionContext } from "./authorization";

const SLOT_PURPOSE: Record<CompetitionAssetSlot, AssetPurpose> = {
  logo: AssetPurpose.COMPETITION_LOGO,
  banner: AssetPurpose.COMPETITION_BANNER,
  cover: AssetPurpose.COMPETITION_COVER,
};

const SLOT_ASSET_ID_FIELD = {
  logo: "logoAssetId",
  banner: "bannerAssetId",
  cover: "coverAssetId",
} as const satisfies Record<CompetitionAssetSlot, string>;

export class CompetitionAssetService {
  /**
   * Attaches an already-finalized Asset to a competition slot. Does not
   * create an Asset — that only ever happens through the UploadIntent
   * finalize flow (see modules/assets). Target-domain authorization
   * (CompetitionAuthorizer.edit) is the caller's responsibility; this
   * enforces the Asset-side reference policy (active, right category).
   */
  static async setAsset(
    context: CompetitionContext,
    dto: SetCompetitionAssetDTO,
  ) {
    const { slot, assetId } = dto;
    const competitionId = context.competition.id;

    // A null assetId clears the slot and has nothing to validate.
    if (assetId !== null) {
      await assertAssetReferenceAllowed({
        assetId,
        purpose: SLOT_PURPOSE[slot],
      });
    }

    const previousAssetId =
      context.competition[SLOT_ASSET_ID_FIELD[slot] as "logoAssetId" | "bannerAssetId" | "coverAssetId"];

    return prisma.$transaction(async (tx) => {
      // Authoritative, race-safe re-validation under lock — see
      // AssetService.prepareAssetAttach. The pre-transaction
      // assertAssetReferenceAllowed call above is a fast-fail check only.
      await assetService.prepareAssetAttach(tx, {
        assetId,
        previousAssetId,
        purpose: SLOT_PURPOSE[slot],
      });

      // Attach Asset
      await CompetitionRepository.setAsset(tx, competitionId, slot, assetId);

      // Detach the previous asset in this slot, if any, now that nothing
      // in this transaction still points at it (unless it's shared
      // elsewhere — detachIfUnreferenced checks that).
      if (previousAssetId && previousAssetId !== assetId) {
        await assetService.detachIfUnreferenced(tx, previousAssetId);
      }

      // Load updated competition
      const competition = await CompetitionRepository.findByIdForEdit(
        competitionId,
        tx,
      );

      return competitionMapper.toEditDTO({ competition });
    });
  }
}
