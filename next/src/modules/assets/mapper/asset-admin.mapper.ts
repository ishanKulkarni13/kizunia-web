import type { Asset, AssetPurpose } from "@/generated/prisma";
import { AssetStatus } from "@/generated/prisma";

import { buildAssetDurableViewUrl } from "../backend/download-url";
import type { AssetReferenceReport } from "../backend/reference-metadata";
import type { AssetReconciliationCandidate } from "../backend/reconciliation.service";
import type {
  AssetAdminDetailDTO,
  AssetAdminListRowDTO,
  AssetReconciliationCandidateDTO,
} from "../dto/asset-admin.dto";

/**
 * The only place `buildAssetDurableViewUrl` is called for admin rows — see
 * its doc comment for the durable-vs-signed distinction. Deliberately
 * separate from `AssetMapper` (mapper/asset.mapper.ts), which produces the
 * narrower, non-admin `AssetDTO`.
 */
export class AssetAdminMapper {
  toListRowDTO(asset: Asset, reference: AssetReferenceReport): AssetAdminListRowDTO {
    return {
      id: asset.id,
      status: asset.status,
      category: asset.category,

      previewUrl: buildAssetDurableViewUrl({
        publicId: asset.publicId,
        category: asset.category,
        secureUrl: asset.secureUrl,
      }),
      canDownload: asset.status !== AssetStatus.DELETED,

      mimeType: asset.mimeType,
      format: asset.format,
      bytes: asset.bytes,
      width: asset.width,
      height: asset.height,

      referenceCount: reference.total,
      references: reference.breakdown,

      uploadedById: asset.uploadedById,

      createdAt: asset.createdAt.toISOString(),
      detachedAt: asset.detachedAt ? asset.detachedAt.toISOString() : null,
    };
  }

  toDetailDTO(
    asset: Asset,
    reference: AssetReferenceReport,
    originatingPurpose: AssetPurpose | null,
  ): AssetAdminDetailDTO {
    return {
      ...this.toListRowDTO(asset, reference),
      originatingPurpose,
      originalFilename: asset.originalFilename,
      checksum: asset.checksum,
      updatedAt: asset.updatedAt.toISOString(),
    };
  }

  /**
   * `referenceCount` is always `0` here, by construction rather than by
   * convenience: `UNREFERENCED_ACTIVE` candidates are already filtered to
   * zero references in the query itself
   * (`AssetRepository.findUnreferencedActiveCandidates`), and
   * `DETACHED_AWAITING_CLEANUP`/`DELETING_RETRY` candidates are Assets that
   * already transitioned out of ACTIVE — which only ever happens once
   * `AssetService.detachIfUnreferenced` has verified zero references under
   * lock — and nothing can attach a NEW reference to a non-ACTIVE Asset
   * (`validateAssetForPurpose` rejects it). So no reference query is issued
   * for the reconciliation preview at all; it would be redundant work, not
   * a missing safety check.
   */
  toReconciliationCandidateDTO(
    candidate: AssetReconciliationCandidate,
  ): AssetReconciliationCandidateDTO {
    const { asset } = candidate;

    return {
      id: asset.id,
      kind: candidate.kind,
      reason: candidate.reason,
      status: asset.status,
      category: asset.category,
      previewUrl: buildAssetDurableViewUrl({
        publicId: asset.publicId,
        category: asset.category,
        secureUrl: asset.secureUrl,
      }),
      referenceCount: 0,
      createdAt: asset.createdAt.toISOString(),
      detachedAt: asset.detachedAt ? asset.detachedAt.toISOString() : null,
    };
  }
}

export const assetAdminMapper = new AssetAdminMapper();
