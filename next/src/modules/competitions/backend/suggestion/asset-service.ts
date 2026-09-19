/**
 * Competition Suggestion Asset attachment.
 *
 * The Asset module has no generic "attach to X" concept (see
 * docs/architecture/domain/assets/overview.md) — every domain owns its own
 * attach/detach write path against its own relation. This is that path for
 * `CompetitionSuggestionAsset`, mirroring CompetitionAssetService.setAsset.
 */

import { AssetCategory, AssetPurpose } from "@/generated/prisma";
import type { StrictAuthorizationActor } from "@/authorization";
import { ConflictError, HttpStatus, NotFoundError } from "@/lib/errors";
import prisma from "@/lib/prisma";

import { assertAssetReferenceAllowed } from "@/modules/assets/backend/reference-policy";
import { assetService } from "@/modules/assets/backend/service";

import { withAssetDownloadUrls } from "./asset-view";
import { CompetitionSuggestionAuthorizer } from "./authorization/authorizer";
import { CompetitionSuggestionContextResolver } from "./authorization/resolver";
import { competitionSuggestionRepository } from "./repository";

const MAX_TOTAL_ASSETS = 5;
const MAX_IMAGE_ASSETS = 4;
const MAX_PDF_ASSETS = 1;

export class CompetitionSuggestionAssetService {
  static async attach({
    actor,
    suggestionId,
    assetId,
  }: {
    actor: StrictAuthorizationActor;
    suggestionId: string;
    assetId: string;
  }) {
    const context = await CompetitionSuggestionContextResolver.resolve({
      actor,
      suggestionId,
    });

    // Same rule as editing the suggestion itself: contributor-owned and
    // DRAFT-only. There is no separate "can attach assets" action — asset
    // attachment is just another edit to the suggestion.
    CompetitionSuggestionAuthorizer.edit(context);

    // Asset-side validation: exists, ACTIVE, and a category this purpose
    // actually accepts (image or, since the V1 policy override, PDF).
    const asset = await assertAssetReferenceAllowed({
      assetId,
      purpose: AssetPurpose.COMPETITION_SUGGESTION_GALLERY,
    });

    return prisma.$transaction(async (tx) => {
      // Authoritative, race-safe re-validation under lock — see
      // AssetService.prepareAssetAttach. The assertAssetReferenceAllowed
      // call above is a fast-fail check only. There is no "previous" Asset
      // here (this is an additive gallery attach, not a slot replace).
      await assetService.prepareAssetAttach(tx, {
        assetId,
        previousAssetId: null,
        purpose: AssetPurpose.COMPETITION_SUGGESTION_GALLERY,
      });

      // Re-read inside the transaction so the count/duplicate check sees a
      // consistent snapshot even if two attach requests race.
      const current = await tx.competitionSuggestionAsset.findMany({
        where: { suggestionId },
        include: { asset: true },
      });

      if (current.some((item) => item.assetId === assetId)) {
        throw new ConflictError({
          code: "competition_suggestion_asset_already_attached",
          status: HttpStatus.CONFLICT,
          message: "This asset is already attached to this suggestion.",
        });
      }

      if (current.length >= MAX_TOTAL_ASSETS) {
        throw new ConflictError({
          code: "competition_suggestion_asset_limit_reached",
          status: HttpStatus.CONFLICT,
          message: `A suggestion can have at most ${MAX_TOTAL_ASSETS} supporting assets.`,
        });
      }

      const imageCount = current.filter(
        (item) => item.asset.category === AssetCategory.IMAGE,
      ).length;

      const pdfCount = current.filter(
        (item) => item.asset.category === AssetCategory.DOCUMENT,
      ).length;

      if (asset.category === AssetCategory.IMAGE && imageCount >= MAX_IMAGE_ASSETS) {
        throw new ConflictError({
          code: "competition_suggestion_asset_image_limit_reached",
          status: HttpStatus.CONFLICT,
          message: `A suggestion can have at most ${MAX_IMAGE_ASSETS} images.`,
        });
      }

      if (asset.category === AssetCategory.DOCUMENT && pdfCount >= MAX_PDF_ASSETS) {
        throw new ConflictError({
          code: "competition_suggestion_asset_pdf_limit_reached",
          status: HttpStatus.CONFLICT,
          message: `A suggestion can have at most ${MAX_PDF_ASSETS} PDF.`,
        });
      }

      await competitionSuggestionRepository.addAsset(tx, suggestionId, assetId);

      return withAssetDownloadUrls(
        await competitionSuggestionRepository.findByIdOrThrow(suggestionId, tx),
      );
    });
  }

  static async detach({
    actor,
    suggestionId,
    assetId,
  }: {
    actor: StrictAuthorizationActor;
    suggestionId: string;
    assetId: string;
  }) {
    const context = await CompetitionSuggestionContextResolver.resolve({
      actor,
      suggestionId,
    });

    CompetitionSuggestionAuthorizer.edit(context);

    return this.performDetach({
      suggestion: context.suggestion,
      suggestionId,
      assetId,
    });
  }

  /**
   * Admin removal of a suggestion asset — available regardless of the
   * suggestion's moderation status (spec requirement), unlike the
   * contributor `detach` above, which is DRAFT-and-owner-only via
   * `Authorizer.edit`. Shares `performDetach` rather than a copy of the
   * transaction body: two authorized entry points, one write path, so an
   * `isAdmin` flag never has to be threaded through from a request body.
   *
   * Must never touch `status`, `reviewedAt`, or `reviewedById` — removing an
   * asset is not a moderation decision, even though an admin performed it.
   */
  static async adminDetach({
    actor,
    suggestionId,
    assetId,
  }: {
    actor: StrictAuthorizationActor;
    suggestionId: string;
    assetId: string;
  }) {
    const context = await CompetitionSuggestionContextResolver.resolve({
      actor,
      suggestionId,
    });

    CompetitionSuggestionAuthorizer.moderateAssets(context);

    return this.performDetach({
      suggestion: context.suggestion,
      suggestionId,
      assetId,
    });
  }

  private static async performDetach({
    suggestion,
    suggestionId,
    assetId,
  }: {
    suggestion: { assets: { assetId: string }[] };
    suggestionId: string;
    assetId: string;
  }) {
    const attached = suggestion.assets.some(
      (item) => item.assetId === assetId,
    );

    if (!attached) {
      throw new NotFoundError({
        code: "competition_suggestion_asset_not_found",
        message: "This asset is not attached to this suggestion.",
      });
    }

    return prisma.$transaction(async (tx) => {
      await competitionSuggestionRepository.removeAsset(tx, suggestionId, assetId);

      // Detach-not-delete: the physical provider asset is untouched here.
      // The existing reconciliation sweep handles it once truly unreferenced
      // (see AssetService.detachIfUnreferenced / reconciliation.service.ts).
      await assetService.detachIfUnreferenced(tx, assetId);

      return withAssetDownloadUrls(
        await competitionSuggestionRepository.findByIdOrThrow(suggestionId, tx),
      );
    });
  }
}
