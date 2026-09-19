import { Prisma } from "@/generated/prisma";
import prisma from "@/lib/prisma";

export class CompetitionRegistrationRepository {
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
   *
   * Deliberately a separate class from `CompetitionBookmarkRepository`
   * rather than a shared generic — bookmarking and registering are fully
   * independent relationships (see `CompetitionRegistration`'s schema
   * docblock), and a shared repository is the single most likely place a
   * future "while we're here, also touch the other table" side effect
   * would get introduced.
   */

  /**
   * Idempotent by construction: the empty `update: {}` means marking twice
   * is a no-op that neither errors on the composite primary key nor bumps
   * `markedAt`.
   */
  static async upsert(
    competitionId: string,
    userId: string,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<void> {
    await db.competitionRegistration.upsert({
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
   * `deleteMany`, never `delete` — un-marking a competition that was never
   * marked must be a successful no-op, not an error.
   */
  static async deleteMany(
    competitionId: string,
    userId: string,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<number> {
    const result = await db.competitionRegistration.deleteMany({
      where: {
        competitionId,
        userId,
      },
    });

    return result.count;
  }

  static async findUserRegisteredIds(
    userId: string,
    competitionIds: string[],
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<Set<string>> {
    if (competitionIds.length === 0) {
      return new Set();
    }

    const rows = await db.competitionRegistration.findMany({
      where: {
        userId,
        competitionId: { in: competitionIds },
      },
      select: { competitionId: true },
    });

    return new Set(rows.map((row) => row.competitionId));
  }
}
