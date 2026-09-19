import type { AssetCategory, AssetPurpose, AssetStatus } from "@/generated/prisma";

import type {
  AssetReconciliationCandidateKind,
  AssetReconciliationOutcome,
} from "../backend/reconciliation.service";

/**
 * The safe reference breakdown for one Asset — entity type + slot + count
 * only. Never entity ids or names (no per-row entity lookups needed, and no
 * user data leaks through an Asset admin surface). See
 * `AssetReferenceReporter` for how this is computed.
 */
export interface AssetAdminReferenceEntryDTO {
  entity: string;
  slot: string;
  count: number;
}

/**
 * Deliberately excludes `publicId`, `secureUrl`, `provider`, and any other
 * provider-internal identifier — see
 * docs/architecture/domain/assets/security.md. `previewUrl` is a durable,
 * non-expiring URL (`null` for a category that can only be delivered via a
 * signed, temporary URL — see StorageProvider.buildDurableViewUrl); it is
 * never a signed/short-lived URL. `canDownload` merely says the download
 * route can currently serve this Asset (not `DELETED`) — the route
 * re-authorizes and mints a fresh URL on every request regardless.
 */
export interface AssetAdminListRowDTO {
  id: string;
  status: AssetStatus;
  category: AssetCategory;

  previewUrl: string | null;
  canDownload: boolean;

  mimeType: string | null;
  format: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;

  /** Number of DISTINCT referencing source entities — identical semantics
   *  to `AssetReferenceChecker.countReferences`, the lifecycle authority.
   *  NEVER the sum of `references[].count`. */
  referenceCount: number;
  references: AssetAdminReferenceEntryDTO[];

  uploadedById: string | null;

  createdAt: string;
  detachedAt: string | null;
}

export interface AssetAdminDetailDTO extends AssetAdminListRowDTO {
  /** The `AssetPurpose` this Asset was originally uploaded for, read off
   *  `UploadIntent.resultAssetId` — `null` for a legacy row or one whose
   *  originating intent is no longer resolvable. This is NOT a live
   *  property of the Asset (Asset has no `purpose` column) — see
   *  docs/architecture/domain/assets/lifecycle.md. */
  originatingPurpose: AssetPurpose | null;
  originalFilename: string | null;
  checksum: string | null;
  updatedAt: string;
}

/** Global, unfiltered Asset status counts — see AssetAdminService.getSummary. */
export interface AssetAdminSummaryDTO {
  total: number;
  active: number;
  detached: number;
  deleting: number;
  deleted: number;
}

export interface AssetReconciliationCandidateDTO {
  id: string;
  kind: AssetReconciliationCandidateKind;
  reason: string;
  status: AssetStatus;
  category: AssetCategory;
  previewUrl: string | null;
  referenceCount: number;
  createdAt: string;
  detachedAt: string | null;
}

/** Visibility-only counts alongside a reconciliation preview page — see
 *  AssetReconciliationService.previewCandidates's doc comment on why these
 *  are bounded per-kind scan counts, not global totals, and why
 *  `abandonedIntents` is never a selectable candidate. */
export interface AssetReconciliationPreviewSummaryDTO {
  unreferencedActive: number;
  detachedAwaitingCleanup: number;
  deletingRetry: number;
  abandonedIntents: number;
}

export interface AssetReconciliationApplyResultRowDTO {
  id: string;
  outcome: AssetReconciliationOutcome;
  reason?: string;
}

export interface AssetReconciliationApplyResultDTO {
  results: AssetReconciliationApplyResultRowDTO[];
}
