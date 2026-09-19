/**
 * UploadIntent Repository - DB-only access.
 */

import {
  Prisma,
  PrismaClient,
  UploadIntent,
  UploadIntentStatus,
} from "@/generated/prisma";
import prisma from "@/lib/prisma";

import type { CreateUploadIntentInput } from "./upload-intent.service";

export class UploadIntentRepository {
  constructor(
    private readonly db: PrismaClient | Prisma.TransactionClient = prisma,
  ) {}

  async create(data: CreateUploadIntentInput): Promise<UploadIntent> {
    return this.db.uploadIntent.create({ data });
  }

  async findById({ id }: { id: string }): Promise<UploadIntent | null> {
    return this.db.uploadIntent.findUnique({ where: { id } });
  }

  /**
   * Marks the intent CONSUMED and records the resulting Asset, but only if
   * it is still PENDING — this is the single-use guarantee. Returns the
   * number of rows updated so the caller can detect a race (a second
   * finalize attempt against the same intent updates zero rows).
   */
  async markConsumed({
    id,
    resultAssetId,
  }: {
    id: string;
    resultAssetId: string;
  }): Promise<number> {
    const result = await this.db.uploadIntent.updateMany({
      where: { id, status: UploadIntentStatus.PENDING },
      data: { status: UploadIntentStatus.CONSUMED, resultAssetId },
    });

    return result.count;
  }

  async findExpiredPending(limit: number): Promise<UploadIntent[]> {
    return this.db.uploadIntent.findMany({
      where: {
        status: UploadIntentStatus.PENDING,
        expiresAt: { lte: new Date() },
      },
      take: limit,
    });
  }

  /**
   * Visibility-only count for the admin reconciliation preview summary —
   * see AssetReconciliationService.previewCandidates. Abandoned intents are
   * never selectable/applicable through the admin apply endpoint (they are
   * UploadIntent rows, not Assets); this exists purely so an admin can see
   * that sweepAbandonedIntents has work pending.
   */
  async countExpiredPending(): Promise<number> {
    return this.db.uploadIntent.count({
      where: {
        status: UploadIntentStatus.PENDING,
        expiresAt: { lte: new Date() },
      },
    });
  }

  async markExpired(id: string): Promise<void> {
    await this.db.uploadIntent.updateMany({
      where: { id, status: UploadIntentStatus.PENDING },
      data: { status: UploadIntentStatus.EXPIRED },
    });
  }
}
