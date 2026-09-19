/**
 * Assets Module - Admin Service
 *
 * Owns the admin operations surface — list/detail/download/reconciliation
 * preview/apply — as its own module, so `AssetService` (Asset lifecycle
 * business rules) and `AssetReconciliationService` (the cron-callable
 * reconciliation authority) keep their current, narrower responsibilities.
 *
 * Responsibilities
 * ----------------
 * ✓ Authorization (MANAGE_MEDIA, via AssetAuthorizer)
 * ✓ Request-shaped validation (admin list filters, apply id cap)
 * ✓ Orchestrating AssetRepository / AssetReferenceReporter /
 *   AssetReconciliationService and mapping their results into admin DTOs
 *
 * Does NOT
 * ----------------
 * ✗ Decide any lifecycle transition itself — every mutation goes through
 *   `AssetReconciliationService.applyToIds`, which goes through
 *   `AssetReconciliationService.reconcileAsset`, which goes through
 *   `AssetService.detachIfUnreferenced` (the row-locked, race-safe
 *   authority). No lifecycle logic is duplicated here.
 * ✗ Parse HTTP requests or return NextResponse (that's the controller)
 */

import prisma from "@/lib/prisma";
import { AssetStatus } from "@/generated/prisma";
import type { StrictAuthorizationActor } from "@/authorization";
import {
  buildPaginationMeta,
  parsePagination,
  toSkipTake,
  type RawSearchParams,
} from "@/lib/search";

import { AssetAuthorizer } from "./authorization/authorizer";
import { buildAssetDownloadUrl } from "./download-url";
import { AssetNotDownloadableError, AssetNotFoundError } from "./errors";
import { AssetReferenceReporter } from "./reference-metadata";
import { assetReconciliationService } from "./reconciliation.service";
import { AssetRepository } from "./repository";
import { AdminAssetListQuerySchema } from "../schemas/admin-asset-list-query";
import { assetAdminMapper } from "../mapper/asset-admin.mapper";
import type {
  AssetAdminDetailDTO,
  AssetAdminListRowDTO,
  AssetAdminSummaryDTO,
  AssetReconciliationApplyResultDTO,
  AssetReconciliationCandidateDTO,
  AssetReconciliationPreviewSummaryDTO,
} from "../dto/asset-admin.dto";

const EMPTY_REFERENCE_REPORT = { total: 0, breakdown: [] };

export class AssetAdminService {
  private readonly repository = new AssetRepository();

  async search(
    actor: StrictAuthorizationActor,
    query: RawSearchParams,
  ): Promise<{
    items: AssetAdminListRowDTO[];
    pagination: ReturnType<typeof buildPaginationMeta>;
  }> {
    AssetAuthorizer.manage({ actor });

    const filters = AdminAssetListQuerySchema.parse({
      id: query.id,
      status: query.status,
      category: query.category,
      referenced: query.referenced,
      createdFrom: query.createdFrom,
      createdTo: query.createdTo,
      detachedFrom: query.detachedFrom,
      detachedTo: query.detachedTo,
    });

    const pagination = parsePagination(query);
    const where = AssetRepository.buildAdminWhere(filters);

    const [assets, total] = await Promise.all([
      this.repository.findManyForAdmin(where, toSkipTake(pagination)),
      this.repository.countForAdmin(where),
    ]);

    // One fixed-cost reference lookup for the whole page — never per row.
    // See AssetReferenceReporter.forAssets's doc comment.
    const references = await AssetReferenceReporter.forAssets(
      prisma,
      assets.map((asset) => asset.id),
    );

    const items = assets.map((asset) =>
      assetAdminMapper.toListRowDTO(
        asset,
        references.get(asset.id) ?? EMPTY_REFERENCE_REPORT,
      ),
    );

    return { items, pagination: buildPaginationMeta(pagination, total) };
  }

  /** Global, unfiltered Asset status counts — see AssetAdminSummaryDTO's doc
   *  comment on why this is never scoped to the current filters. */
  async getSummary(actor: StrictAuthorizationActor): Promise<AssetAdminSummaryDTO> {
    AssetAuthorizer.manage({ actor });

    const counts = await this.repository.summarizeByStatus();

    return {
      total:
        counts[AssetStatus.ACTIVE] +
        counts[AssetStatus.DETACHED] +
        counts[AssetStatus.DELETING] +
        counts[AssetStatus.DELETED],
      active: counts[AssetStatus.ACTIVE],
      detached: counts[AssetStatus.DETACHED],
      deleting: counts[AssetStatus.DELETING],
      deleted: counts[AssetStatus.DELETED],
    };
  }

  async getById(
    actor: StrictAuthorizationActor,
    id: string,
  ): Promise<AssetAdminDetailDTO> {
    AssetAuthorizer.manage({ actor });

    const asset = await this.repository.findByIdForAdmin(id);

    if (!asset) {
      throw new AssetNotFoundError();
    }

    const [references, originatingPurpose] = await Promise.all([
      AssetReferenceReporter.forAssets(prisma, [asset.id]),
      this.repository.findOriginatingPurpose(asset.id),
    ]);

    return assetAdminMapper.toDetailDTO(
      asset,
      references.get(asset.id) ?? EMPTY_REFERENCE_REPORT,
      originatingPurpose,
    );
  }

  /**
   * Mints a fresh, authorized provider download URL. Never persists it,
   * never returns it from any other method (list/detail carry only the
   * durable `previewUrl`, which is `null` for a category — DOCUMENT —
   * that can't have one) — see docs/architecture/domain/assets/lifecycle.md.
   * The caller (the download route) is responsible for redirecting to this
   * URL rather than proxying it and for not caching the response.
   */
  async getDownloadTarget(
    actor: StrictAuthorizationActor,
    id: string,
  ): Promise<{ url: string }> {
    AssetAuthorizer.manage({ actor });

    const asset = await this.repository.findByIdForAdmin(id);

    if (!asset) {
      throw new AssetNotFoundError();
    }

    if (asset.status === AssetStatus.DELETED) {
      throw new AssetNotDownloadableError();
    }

    const url = buildAssetDownloadUrl({
      publicId: asset.publicId,
      category: asset.category,
      format: asset.format,
      originalFilename: asset.originalFilename,
    });

    return { url };
  }

  /**
   * Read-only — delegates straight to
   * `AssetReconciliationService.previewCandidates`, which never mutates
   * anything. See that method's doc comment.
   */
  async previewReconciliation(
    actor: StrictAuthorizationActor,
    query: RawSearchParams,
  ): Promise<{
    items: AssetReconciliationCandidateDTO[];
    pagination: ReturnType<typeof buildPaginationMeta>;
    summary: AssetReconciliationPreviewSummaryDTO;
  }> {
    AssetAuthorizer.manage({ actor });

    const { items, pagination, summary } =
      await assetReconciliationService.previewCandidates(query);

    return {
      items: items.map((candidate) =>
        assetAdminMapper.toReconciliationCandidateDTO(candidate),
      ),
      pagination,
      summary,
    };
  }

  /**
   * Orchestration only — `ids` is expected to already be validated against
   * `ApplyAssetReconciliationSchema` (bounded, cuid-shaped) by the caller.
   * The actual re-read/re-evaluate/apply/report-per-id work is entirely
   * `AssetReconciliationService.applyToIds`'s — no lifecycle logic here.
   */
  async applyReconciliation(
    actor: StrictAuthorizationActor,
    ids: readonly string[],
  ): Promise<AssetReconciliationApplyResultDTO> {
    AssetAuthorizer.manage({ actor });

    return assetReconciliationService.applyToIds(ids);
  }
}

export const assetAdminService = new AssetAdminService();
