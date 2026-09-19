import { Prisma } from "@/generated/prisma";
import prisma from "@/lib/prisma";

export class CompetitionBookmarkRepository {
  /**
   * Database Layer
   *
   * Responsibilities
   * ----------------
   * ✓ Build Prisma queries
   * ✓ Execute database operations
   *
   * Does NOT
   * ----------------
   * ✗ Business rules
   * ✗ Authentication
   * ✗ Authorization
   */

  /**
   * Idempotent by construction: the empty `update: {}` means a repeated
   * bookmark is a no-op that neither errors on the composite primary key
   * nor bumps `createdAt` — "saved since" should not reset on a
   * double-click or a retried request.
   */
  static async upsert(
    competitionId: string,
    userId: string,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<void> {
    await db.competitionBookmark.upsert({
      where: {
        competitionId_userId: {
          competitionId,
          userId,
        },
      },
      create: {
        competitionId,
        userId,
      },
      update: {},
    });
  }

  /**
   * `deleteMany`, never `delete` — `delete` throws (P2025) when the row is
   * already gone, and un-bookmarking something that isn't bookmarked must
   * be a successful no-op, not an error.
   */
  static async deleteMany(
    competitionId: string,
    userId: string,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<number> {
    const result = await db.competitionBookmark.deleteMany({
      where: {
        competitionId,
        userId,
      },
    });

    return result.count;
  }

  static async findUserBookmarkedIds(
    userId: string,
    competitionIds: string[],
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<Set<string>> {
    if (competitionIds.length === 0) {
      return new Set();
    }

    const rows = await db.competitionBookmark.findMany({
      where: {
        userId,
        competitionId: { in: competitionIds },
      },
      select: { competitionId: true },
    });

    return new Set(rows.map((row) => row.competitionId));
  }
}
