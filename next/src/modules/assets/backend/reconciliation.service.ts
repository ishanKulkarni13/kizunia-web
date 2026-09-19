/**
 * AssetReconciliationService
 *
 * Handles the cases the normal request/response flow cannot: abandoned
 * UploadIntents, detached Assets waiting for physical deletion, DELETING
 * Assets whose last deletion attempt failed, and provider objects left
 * behind by an intent that never finalized. See
 * docs/architecture/domain/assets/lifecycle.md and security.md.
 *
 * There is no background job/queue infrastructure in this repository.
 * These methods are plain, callable functions — see
 * app/api/v1/internal/assets/reconcile/route.ts for how they're invoked from
 * outside the domain layer, and
 * docs/architecture/workflows/internal-jobs.md for the invocation
 * convention. This service has no idea Vercel, a cron, or an HTTP request
 * even exist — scheduling is deliberately kept out of this file.
 *
 * `reconcileAsset` is the single per-Asset reconciliation authority: the
 * three Asset-shaped sweeps below and the admin `previewCandidates`/
 * `applyToIds` methods (used by GET/POST /api/v1/admin/assets/reconciliation/*)
 * all funnel through it, so cron and admin-triggered reconciliation execute
 * literally the same code — see
 * docs/architecture/domain/assets/lifecycle.md#concurrency.
 */

import prisma from "@/lib/prisma";
import { Asset, AssetCategory, AssetStatus } from "@/generated/prisma";
import {
  buildPaginationMeta,
  parsePagination,
  toSkipTake,
  type RawSearchParams,
} from "@/lib/search";

import { AssetRepository } from "./repository";
import { assetService } from "./service";
import { UploadIntentRepository } from "./upload-intent.repository";
import { getStorageProvider } from "./storage";
import { ProviderObjectNotFoundError } from "./errors";

/**
 * Not decided anywhere in the architecture docs (marked TBD in
 * lifecycle.md/security.md). A conservative V1 default, isolated here so it
 * can change without touching the sweep logic.
 */
const DETACHED_CLEANUP_GRACE_PERIOD_MS = 24 * 60 * 60 * 1_000;

/**
 * Same conservative-default status as the grace period above — how long an
 * ACTIVE Asset is left alone before it becomes eligible to be checked for
 * references at all. Deliberately not the instant it's created: a
 * just-finalized upload may simply not have been attached to its target
 * entity yet (that's a separate request), and this sweep must not race that.
 */
const UNREFERENCED_ACTIVE_GRACE_PERIOD_MS = 24 * 60 * 60 * 1_000;

/**
 * Background sweep batching. Unrelated to, and deliberately never coupled
 * with, the admin apply cap (`MAX_RECONCILIATION_APPLY_IDS`,
 * schemas/apply-asset-reconciliation.ts) — a cron-paced background sweep and
 * one interactive HTTP request are different workloads with different
 * latency budgets. See that schema file's doc comment.
 */
const SWEEP_BATCH_SIZE = 50;

/**
 * Caps how many batches of `SWEEP_BATCH_SIZE` a single sweep call will walk
 * before returning, so one invocation (in particular one HTTP request to
 * the internal route) stays bounded regardless of backlog size — each
 * batch does real provider network calls, which an unbounded loop (unlike
 * a pure-DB loop) could turn into an unpredictably long-running request. A
 * backlog larger than `MAX_BATCHES_PER_SWEEP * SWEEP_BATCH_SIZE` drains
 * across multiple scheduled invocations instead of one.
 */
const MAX_BATCHES_PER_SWEEP = 5;

export interface ReconciliationSummary {
  detachedProcessed: number;
  detachedDeleted: number;
  staleDeletingProcessed: number;
  staleDeletingDeleted: number;
  unreferencedActiveProcessed: number;
  unreferencedActiveDetached: number;
  abandonedIntentsProcessed: number;
  abandonedIntentsDeferred: number;
}

/**
 * What actually happened (or didn't) when `reconcileAsset` considered one
 * Asset. `NOT_FOUND` is never produced by `reconcileAsset` itself (it always
 * receives an already-loaded Asset) — it is added by `applyToIds`, the only
 * caller that looks ids up fresh and can encounter one that no longer exists.
 */
export type AssetReconciliationOutcome =
  | "DETACHED"
  | "DELETED"
  | "DEFERRED"
  | "NOT_ELIGIBLE"
  | "NOT_FOUND";

export interface AssetReconciliationResult {
  outcome: AssetReconciliationOutcome;
  reason?: string;
}

export type AssetReconciliationCandidateKind =
  | "UNREFERENCED_ACTIVE"
  | "DETACHED_AWAITING_CLEANUP"
  | "DELETING_RETRY";

export interface AssetReconciliationCandidate {
  asset: Asset;
  kind: AssetReconciliationCandidateKind;
  reason: string;
}

export interface AssetReconciliationPreviewSummary {
  /** Counts from this preview's own bounded scan (up to `SWEEP_BATCH_SIZE`
   *  per kind) — NOT a global total. See AssetAdminService.getSummary for
   *  global, unfiltered Asset status counts. */
  unreferencedActive: number;
  detachedAwaitingCleanup: number;
  deletingRetry: number;
  /** Visibility only — abandoned UploadIntents are never selectable/
   *  applicable through the admin apply endpoint; see `applyToIds`. */
  abandonedIntents: number;
}

export class AssetReconciliationService {
  private readonly assetRepository = new AssetRepository();

  private readonly uploadIntentRepository = new UploadIntentRepository();

  /**
   * The single per-Asset reconciliation authority. Given an already-loaded
   * Asset and a reference instant, decides — and, unless `NOT_ELIGIBLE`,
   * performs — exactly the transition the automatic sweeps below have
   * always performed for that Asset's status, reproducing their prior
   * inline behaviour exactly:
   *
   *   ACTIVE, past its grace period    -> detach if unreferenced (locked,
   *                                        race-safe — see
   *                                        AssetService.detachIfUnreferenced)
   *   DETACHED, past its grace period  -> DELETING -> provider delete ->
   *                                        DELETED, or DEFERRED on failure
   *                                        (stays DELETING, never reverts)
   *   DELETING                         -> provider delete retry -> DELETED
   *                                        or DEFERRED
   *   anything else (inside its grace
   *   period, already DELETED, ...)    -> NOT_ELIGIBLE, with a reason
   *
   * This is the ONLY place that decision is made. `sweepDetached`,
   * `sweepStaleDeleting`, `sweepUnreferencedActive`, and the admin
   * `applyToIds` all call this — never duplicate its logic. The row lock +
   * reference recount inside `AssetService.detachIfUnreferenced` remains
   * the sole detach authority; this method does not weaken or bypass it.
   */
  async reconcileAsset(
    asset: Asset,
    now: Date = new Date(),
  ): Promise<AssetReconciliationResult> {
    switch (asset.status) {
      case AssetStatus.ACTIVE: {
        const cutoff = new Date(now.getTime() - UNREFERENCED_ACTIVE_GRACE_PERIOD_MS);

        if (asset.createdAt > cutoff) {
          return {
            outcome: "NOT_ELIGIBLE",
            reason: "Still within the unreferenced-active grace period.",
          };
        }

        const wasDetached = await prisma.$transaction((tx) =>
          assetService.detachIfUnreferenced(tx, asset.id),
        );

        return wasDetached
          ? { outcome: "DETACHED" }
          : { outcome: "NOT_ELIGIBLE", reason: "Still referenced." };
      }

      case AssetStatus.DETACHED: {
        const cutoff = new Date(now.getTime() - DETACHED_CLEANUP_GRACE_PERIOD_MS);
        const detachedAt = asset.detachedAt ?? new Date(0);

        if (detachedAt > cutoff) {
          return {
            outcome: "NOT_ELIGIBLE",
            reason: "Still within the detached-cleanup grace period.",
          };
        }

        await this.assetRepository.markDeleting(asset.id);

        const succeeded = await this.attemptProviderDeletion(
          asset.publicId,
          asset.category,
        );

        if (succeeded) {
          await this.assetRepository.markDeleted(asset.id);
          return { outcome: "DELETED" };
        }

        // On failure: stays DELETING. Never reverts to DETACHED.
        return {
          outcome: "DEFERRED",
          reason: "Storage deletion failed; will retry on the next sweep.",
        };
      }

      case AssetStatus.DELETING: {
        const succeeded = await this.attemptProviderDeletion(
          asset.publicId,
          asset.category,
        );

        if (succeeded) {
          await this.assetRepository.markDeleted(asset.id);
          return { outcome: "DELETED" };
        }

        return {
          outcome: "DEFERRED",
          reason: "Storage deletion failed; will retry on the next sweep.",
        };
      }

      case AssetStatus.DELETED:
      default:
        return {
          outcome: "NOT_ELIGIBLE",
          reason: `Already ${asset.status.toLowerCase()}.`,
        };
    }
  }

  /**
   * DETACHED, past its grace period -> DELETING -> (on success) DELETED.
   * Walks up to `MAX_BATCHES_PER_SWEEP` batches so a backlog above one
   * batch still drains within a single call. Per-asset decision delegated
   * to `reconcileAsset`.
   */
  async sweepDetached(): Promise<{ processed: number; deleted: number }> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - DETACHED_CLEANUP_GRACE_PERIOD_MS);

    let processed = 0;
    let deleted = 0;

    for (let batch = 0; batch < MAX_BATCHES_PER_SWEEP; batch++) {
      const candidates = await this.assetRepository.findDetachedBefore(
        cutoff,
        SWEEP_BATCH_SIZE,
      );

      if (candidates.length === 0) {
        break;
      }

      for (const asset of candidates) {
        const { outcome } = await this.reconcileAsset(asset, now);

        if (outcome === "DELETED") {
          deleted += 1;
        }
      }

      processed += candidates.length;

      if (candidates.length < SWEEP_BATCH_SIZE) {
        break;
      }
    }

    return { processed, deleted };
  }

  /**
   * Retries physical deletion for Assets still stuck in DELETING. Every
   * DELETING row is eligible immediately (no additional staleness window
   * beyond already being in this status) — re-attempting an already-stuck
   * row every run is intentional retry behavior, not wasted work.
   */
  async sweepStaleDeleting(): Promise<{ processed: number; deleted: number }> {
    const now = new Date();

    let processed = 0;
    let deleted = 0;

    for (let batch = 0; batch < MAX_BATCHES_PER_SWEEP; batch++) {
      const candidates = await this.assetRepository.findStaleDeleting(
        SWEEP_BATCH_SIZE,
      );

      if (candidates.length === 0) {
        break;
      }

      for (const asset of candidates) {
        const { outcome } = await this.reconcileAsset(asset, now);

        if (outcome === "DELETED") {
          deleted += 1;
        }
      }

      processed += candidates.length;

      if (candidates.length < SWEEP_BATCH_SIZE) {
        break;
      }
    }

    return { processed, deleted };
  }

  /**
   * ACTIVE Assets past the grace period that no domain relation actually
   * references — the safety net for an Asset that was successfully
   * finalized but never attached anywhere. Detaches (never deletes
   * outright), so a detected orphan then flows through the ordinary
   * DETACHED -> DELETING -> DELETED pipeline unchanged.
   *
   * Cursor-paginated (see `AssetRepository.findActiveBefore`) rather than
   * re-querying the same page: a still-referenced row never leaves this
   * candidate set on its own, so without a cursor a batch of
   * mostly-referenced rows would starve progress through the rest of the
   * table.
   *
   * Candidate discovery here is deliberately optimistic and unlocked — it
   * would be wasteful to hold a row lock on every candidate in a batch for
   * the duration of the whole sweep. The authoritative decision is made
   * per-candidate, via `reconcileAsset` (which itself opens its own short
   * transaction through `AssetService.detachIfUnreferenced` — the same
   * race-safe, row-locked recheck every normal attach/detach path uses; see
   * docs/architecture/domain/assets/lifecycle.md#concurrency). If a
   * candidate gets a legitimate reference attached between being selected
   * here and that recheck running, it simply stays ACTIVE.
   */
  async sweepUnreferencedActive(): Promise<{
    processed: number;
    detached: number;
  }> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - UNREFERENCED_ACTIVE_GRACE_PERIOD_MS);

    let processed = 0;
    let detached = 0;
    let cursor: string | null = null;

    for (let batch = 0; batch < MAX_BATCHES_PER_SWEEP; batch++) {
      const candidates = await this.assetRepository.findActiveBefore(
        cutoff,
        SWEEP_BATCH_SIZE,
        cursor,
      );

      if (candidates.length === 0) {
        break;
      }

      for (const asset of candidates) {
        const { outcome } = await this.reconcileAsset(asset, now);

        if (outcome === "DETACHED") {
          detached += 1;
        }
      }

      processed += candidates.length;
      cursor = candidates[candidates.length - 1].id;

      if (candidates.length < SWEEP_BATCH_SIZE) {
        break;
      }
    }

    return { processed, detached };
  }

  /**
   * Expires abandoned UploadIntents and best-effort cleans up any provider
   * object they may have produced without ever being finalized — the
   * "storage succeeded, Asset never got created" orphan case. See
   * docs/architecture/domain/assets/security.md#orphan-and-cleanup-architecture.
   *
   * Operates on UploadIntent rows, not Assets, so it stays outside
   * `reconcileAsset`/the admin apply surface entirely — see
   * `previewCandidates`'s doc comment on why its count is visibility-only.
   *
   * An intent is only marked EXPIRED once the provider has either confirmed
   * there is nothing to clean up (`ProviderObjectNotFoundError` — the
   * common case) or an orphan was found and a deletion attempt was made. A
   * genuinely transient/ambiguous provider failure while confirming leaves
   * the intent PENDING (it stays past its own `expiresAt`, so the next
   * sweep's `findExpiredPending` picks it up again) rather than being
   * marked EXPIRED and forfeiting the only chance to ever reconcile a real
   * orphan.
   */
  async sweepAbandonedIntents(): Promise<{
    processed: number;
    deferred: number;
  }> {
    const expired = await this.uploadIntentRepository.findExpiredPending(
      SWEEP_BATCH_SIZE,
    );

    let deferred = 0;

    for (const intent of expired) {
      let shouldMarkExpired = true;

      try {
        const orphan = await getStorageProvider().confirmUpload({
          correlationId: intent.providerCorrelationId,
          category: intent.category,
          declaredMimeType: intent.declaredMimeType,
        });

        await this.attemptProviderDeletion(
          orphan.providerObjectId,
          intent.category,
        );
      } catch (error) {
        if (error instanceof ProviderObjectNotFoundError) {
          // No provider object was ever produced for this intent — the
          // common case for an abandoned upload, and nothing to reconcile.
        } else {
          // Could not determine whether an orphan exists. Defer — do not
          // treat "we couldn't check" as "there is nothing to clean up".
          shouldMarkExpired = false;
          deferred += 1;
        }
      }

      if (shouldMarkExpired) {
        await this.uploadIntentRepository.markExpired(intent.id);
      }
    }

    return { processed: expired.length, deferred };
  }

  async runAll(): Promise<ReconciliationSummary> {
    const detached = await this.sweepDetached();
    const staleDeleting = await this.sweepStaleDeleting();
    const unreferencedActive = await this.sweepUnreferencedActive();
    const abandonedIntents = await this.sweepAbandonedIntents();

    return {
      detachedProcessed: detached.processed,
      detachedDeleted: detached.deleted,
      staleDeletingProcessed: staleDeleting.processed,
      staleDeletingDeleted: staleDeleting.deleted,
      unreferencedActiveProcessed: unreferencedActive.processed,
      unreferencedActiveDetached: unreferencedActive.detached,
      abandonedIntentsProcessed: abandonedIntents.processed,
      abandonedIntentsDeferred: abandonedIntents.deferred,
    };
  }

  /**
   * Read-only. Never calls `reconcileAsset`, never writes anything — a
   * bounded (`SWEEP_BATCH_SIZE` per kind), single-page-per-kind scan of real
   * reconciliation candidates across the three Asset-shaped kinds, combined
   * and paginated over the combined actionable set (mirrors
   * `CompetitionLifecycleService.preview`'s approach of paginating over the
   * actionable set rather than the raw filter match). Every returned
   * candidate is a genuine one: `UNREFERENCED_ACTIVE` is filtered by
   * `referencedWhere("no")` in the query itself (see
   * `AssetRepository.findUnreferencedActiveCandidates`), so this never lists
   * an Asset that is actually still referenced.
   *
   * Consumed by AssetAdminService.previewReconciliation — actor
   * authorization happens there; this service stays actor-unaware, as it
   * must (it is also the cron's callee).
   */
  async previewCandidates(
    params: RawSearchParams,
    now: Date = new Date(),
  ): Promise<{
    items: AssetReconciliationCandidate[];
    pagination: ReturnType<typeof buildPaginationMeta>;
    summary: AssetReconciliationPreviewSummary;
  }> {
    const unreferencedActiveCutoff = new Date(
      now.getTime() - UNREFERENCED_ACTIVE_GRACE_PERIOD_MS,
    );
    const detachedCutoff = new Date(now.getTime() - DETACHED_CLEANUP_GRACE_PERIOD_MS);

    const [unreferencedActiveRows, detachedRows, deletingRows, abandonedIntents] =
      await Promise.all([
        this.assetRepository.findUnreferencedActiveCandidates(
          unreferencedActiveCutoff,
          SWEEP_BATCH_SIZE,
        ),
        this.assetRepository.findDetachedBefore(detachedCutoff, SWEEP_BATCH_SIZE),
        this.assetRepository.findStaleDeleting(SWEEP_BATCH_SIZE),
        this.uploadIntentRepository.countExpiredPending(),
      ]);

    const candidates: AssetReconciliationCandidate[] = [
      ...unreferencedActiveRows.map((asset) => ({
        asset,
        kind: "UNREFERENCED_ACTIVE" as const,
        reason: "Active, unreferenced, and past its grace period.",
      })),
      ...detachedRows.map((asset) => ({
        asset,
        kind: "DETACHED_AWAITING_CLEANUP" as const,
        reason: "Detached and past its cleanup grace period.",
      })),
      ...deletingRows.map((asset) => ({
        asset,
        kind: "DELETING_RETRY" as const,
        reason: "A previous deletion attempt failed; eligible for retry.",
      })),
    ];

    const pagination = parsePagination(params);
    const { skip, take } = toSkipTake(pagination);
    const page = candidates.slice(skip, skip + take);

    return {
      items: page,
      pagination: buildPaginationMeta(pagination, candidates.length),
      summary: {
        unreferencedActive: unreferencedActiveRows.length,
        detachedAwaitingCleanup: detachedRows.length,
        deletingRetry: deletingRows.length,
        abandonedIntents,
      },
    };
  }

  /**
   * Re-reads every requested id fresh from the database and runs
   * `reconcileAsset` sequentially — never `Promise.all` — because each id
   * may cost a real provider round-trip, and the point of "sequential" is
   * that a slow/failing provider call for one Asset cannot be masked by
   * concurrent calls for the others. Never trusts a prior preview: an id
   * that changed status, gained a reference, or left its grace period since
   * the preview was shown is re-evaluated against its CURRENT state and
   * reported accordingly (typically `NOT_ELIGIBLE`) rather than forced.
   * Returns exactly one result per requested id, including ids that no
   * longer exist (`NOT_FOUND`).
   */
  async applyToIds(
    ids: readonly string[],
    now: Date = new Date(),
  ): Promise<{
    results: { id: string; outcome: AssetReconciliationOutcome; reason?: string }[];
  }> {
    const results: {
      id: string;
      outcome: AssetReconciliationOutcome;
      reason?: string;
    }[] = [];

    for (const id of ids) {
      const asset = await this.assetRepository.findByIdForAdmin(id);

      if (!asset) {
        results.push({ id, outcome: "NOT_FOUND" });
        continue;
      }

      const { outcome, reason } = await this.reconcileAsset(asset, now);

      results.push({ id, outcome, ...(reason !== undefined && { reason }) });
    }

    return { results };
  }

  private async attemptProviderDeletion(
    providerObjectId: string,
    category: AssetCategory,
  ): Promise<boolean> {
    try {
      await getStorageProvider().deleteObject(providerObjectId, category);
      return true;
    } catch {
      return false;
    }
  }
}

export const assetReconciliationService = new AssetReconciliationService();
