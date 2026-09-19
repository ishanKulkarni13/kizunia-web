/**
 * Assets Module - Repository
 *
 * Responsible only for database access. No business rules.
 */

import {
  Asset,
  AssetCategory,
  AssetProvider,
  AssetPurpose,
  AssetStatus,
  Prisma,
  PrismaClient,
} from "@/generated/prisma";
import prisma from "@/lib/prisma";

import { referencedWhere } from "./reference-metadata";

export interface CreateActiveAssetData {
  provider: AssetProvider;
  publicId: string;
  secureUrl: string;
  format: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  checksum: string | null;
  originalFilename: string | null;
  category: AssetCategory;
  uploadedById: string;
}

export class AssetRepository {
  constructor(
    private readonly db: PrismaClient | Prisma.TransactionClient = prisma,
  ) {}

  async findById({ id }: { id: string }): Promise<Asset | null> {
    return this.db.asset.findUnique({ where: { id } });
  }

  /**
   * Creates an Asset directly in ACTIVE. There is no intermediate,
   * not-yet-usable Asset row — see
   * docs/architecture/domain/assets/lifecycle.md.
   */
  async createActive(data: CreateActiveAssetData): Promise<Asset> {
    return this.db.asset.create({
      data: {
        ...data,
        status: AssetStatus.ACTIVE,
      },
    });
  }

  /**
   * Transitions an Asset to DETACHED. Callers must have already verified no
   * valid references remain (see AssetReferenceChecker) — this method does
   * not check that itself, since it operates purely on ids.
   *
   * Scoped to `status: ACTIVE` so calling this twice, or racing with another
   * detach, is a no-op rather than an error.
   */
  async markDetached(assetId: string): Promise<void> {
    await this.db.asset.updateMany({
      where: { id: assetId, status: AssetStatus.ACTIVE },
      data: { status: AssetStatus.DETACHED, detachedAt: new Date() },
    });
  }

  /** DETACHED -> DELETING. Scoped so it only ever fires from DETACHED. */
  async markDeleting(assetId: string): Promise<void> {
    await this.db.asset.updateMany({
      where: { id: assetId, status: AssetStatus.DETACHED },
      data: { status: AssetStatus.DELETING },
    });
  }

  /** DELETING -> DELETED, once provider deletion has actually succeeded. */
  async markDeleted(assetId: string): Promise<void> {
    await this.db.asset.updateMany({
      where: { id: assetId, status: AssetStatus.DELETING },
      data: { status: AssetStatus.DELETED },
    });
  }

  /** Detached long enough ago to be swept toward deletion. */
  async findDetachedBefore(cutoff: Date, limit: number): Promise<Asset[]> {
    return this.db.asset.findMany({
      where: { status: AssetStatus.DETACHED, detachedAt: { lte: cutoff } },
      take: limit,
      orderBy: { detachedAt: "asc" },
    });
  }

  /** Still DELETING — provider deletion is due for a retry. */
  async findStaleDeleting(limit: number): Promise<Asset[]> {
    return this.db.asset.findMany({
      where: { status: AssetStatus.DELETING },
      take: limit,
      orderBy: { updatedAt: "asc" },
    });
  }

  /**
   * Locks this Asset row for the remainder of the caller's transaction
   * (`SELECT ... FOR UPDATE`) and returns its current state (or `null` if
   * it doesn't exist). This is the serialization point the Asset
   * concurrency model depends on — see `AssetService.prepareAssetAttach`/
   * `detachIfUnreferenced` and
   * docs/architecture/domain/assets/lifecycle.md#concurrency. Prisma has no
   * typed API for row-level locking, so this is the one place in the Asset
   * module that issues a raw query; the table is `@@map("asset")` (see
   * schema.prisma) but every column keeps its Prisma field name, so the
   * returned rows match the `Asset` type exactly.
   *
   * Must only be called through a repository constructed on a
   * `Prisma.TransactionClient` — taking this lock outside an explicit
   * transaction would release it before the caller could use it for
   * anything.
   */
  async lockForUpdate(id: string): Promise<Asset | null> {
    const rows = await this.db.$queryRaw<Asset[]>`
      SELECT * FROM "asset" WHERE id = ${id} FOR UPDATE
    `;

    return rows[0] ?? null;
  }

  /**
   * ACTIVE and older than `cutoff` — candidates for the unreferenced-ACTIVE
   * sweep (see AssetReconciliationService.sweepUnreferencedActive). Cursor
   * paginated on `id`, not offset-based: unlike `findDetachedBefore`, a row
   * that turns out to still be referenced never leaves this candidate set
   * on its own (it stays ACTIVE), so an un-cursored re-query would see the
   * same still-referenced rows on every batch and never make progress
   * through the rest of the table.
   */
  async findActiveBefore(
    cutoff: Date,
    limit: number,
    cursor: string | null = null,
  ): Promise<Asset[]> {
    return this.db.asset.findMany({
      where: { status: AssetStatus.ACTIVE, createdAt: { lte: cutoff } },
      take: limit,
      orderBy: { id: "asc" },
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });
  }

  /**
   * ACTIVE, older than `cutoff`, AND already known to be unreferenced —
   * used only by the admin reconciliation preview (see
   * AssetReconciliationService.previewCandidates), which needs a single
   * bounded, read-only page of real candidates rather than the sweep's own
   * cursor-walked full scan. Unlike `findActiveBefore`, the referenced
   * filter is applied in the query itself (via `referencedWhere`), so this
   * never returns a row the preview would have to explain away as "actually
   * still referenced" — it is a preview, not the authoritative decision,
   * but it should still only show real candidates.
   */
  async findUnreferencedActiveCandidates(
    cutoff: Date,
    limit: number,
  ): Promise<Asset[]> {
    return this.db.asset.findMany({
      where: {
        status: AssetStatus.ACTIVE,
        createdAt: { lte: cutoff },
        ...referencedWhere("no"),
      },
      take: limit,
      orderBy: { id: "asc" },
    });
  }

  /**
   * Builds the admin list's `where` clause. Pure — no database access — so
   * it can be unit-tested and reused by both `findManyForAdmin` and
   * `countForAdmin` without duplicating filter logic.
   */
  static buildAdminWhere(filters: {
    id?: string;
    status?: AssetStatus;
    category?: AssetCategory;
    referenced?: "yes" | "no";
    createdFrom?: Date;
    createdTo?: Date;
    detachedFrom?: Date;
    detachedTo?: Date;
  }): Prisma.AssetWhereInput {
    const clauses: Prisma.AssetWhereInput[] = [];

    if (filters.id) {
      clauses.push({ id: filters.id });
    }
    if (filters.status) {
      clauses.push({ status: filters.status });
    }
    if (filters.category) {
      clauses.push({ category: filters.category });
    }
    if (filters.referenced) {
      clauses.push(referencedWhere(filters.referenced));
    }
    if (filters.createdFrom || filters.createdTo) {
      clauses.push({
        createdAt: {
          ...(filters.createdFrom && { gte: filters.createdFrom }),
          ...(filters.createdTo && { lte: filters.createdTo }),
        },
      });
    }
    if (filters.detachedFrom || filters.detachedTo) {
      clauses.push({
        detachedAt: {
          ...(filters.detachedFrom && { gte: filters.detachedFrom }),
          ...(filters.detachedTo && { lte: filters.detachedTo }),
        },
      });
    }

    return clauses.length > 0 ? { AND: clauses } : {};
  }

  /**
   * The admin list query. Ordered newest-first, supported by
   * `@@index([status, createdAt])` — added for this query and for
   * `findActiveBefore` above, which previously had no supporting index
   * beyond bare `@@index([status])`.
   */
  async findManyForAdmin(
    where: Prisma.AssetWhereInput,
    { skip, take }: { skip: number; take: number },
  ): Promise<Asset[]> {
    return this.db.asset.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });
  }

  async countForAdmin(where: Prisma.AssetWhereInput): Promise<number> {
    return this.db.asset.count({ where });
  }

  async findByIdForAdmin(id: string): Promise<Asset | null> {
    return this.db.asset.findUnique({ where: { id } });
  }

  /**
   * Global status counts for the admin summary strip — always unfiltered
   * (see AssetAdminService.getSummary). One `groupBy`, not four separate
   * `count` calls.
   */
  async summarizeByStatus(): Promise<Record<AssetStatus, number>> {
    const groups = await this.db.asset.groupBy({
      by: ["status"],
      _count: { _all: true },
    });

    const counts: Record<AssetStatus, number> = {
      [AssetStatus.ACTIVE]: 0,
      [AssetStatus.DETACHED]: 0,
      [AssetStatus.DELETING]: 0,
      [AssetStatus.DELETED]: 0,
    };

    for (const group of groups) {
      counts[group.status] = group._count._all;
    }

    return counts;
  }

  /**
   * The `AssetPurpose` an Asset was originally uploaded for, read off
   * `UploadIntent.resultAssetId` — detail-view only (see
   * AssetAdminService.getById). `Asset` itself has no `purpose` column (see
   * docs/architecture/domain/assets/lifecycle.md); this is the one place
   * that reconstructs it, for a single asset at a time. Deliberately not
   * indexed (`resultAssetId` has no `@@index` in schema.prisma) — a
   * single-row lookup on the low-frequency detail view does not meet the
   * bar; revisit only if this lookup ever moves into the list path or
   * `upload_intent` grows large enough to matter (it is never pruned).
   */
  async findOriginatingPurpose(assetId: string): Promise<AssetPurpose | null> {
    const intent = await this.db.uploadIntent.findFirst({
      where: { resultAssetId: assetId },
      select: { purpose: true },
    });

    return intent?.purpose ?? null;
  }
}
