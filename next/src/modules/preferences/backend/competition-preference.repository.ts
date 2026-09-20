import { CompetitionPreferenceDimension, Prisma } from "@/generated/prisma";
import prisma from "@/lib/prisma";

export interface CompetitionPreferenceEntryInput {
  readonly dimension: CompetitionPreferenceDimension;
  readonly value: string;
  readonly weight: number;
}

export class CompetitionPreferenceRepository {
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
   * ✗ Validation
   * ✗ Authentication
   * ✗ Authorization
   */

  static async findByUser(
    userId: string,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ) {
    return db.competitionPreference.findMany({ where: { userId } });
  }

  /**
   * Full-replace within one transaction: the user's entire competition
   * preference profile is deleted and re-created atomically, so a caller
   * (or a failure partway through) can never leave a half-updated profile.
   * An empty `entries` array is a valid input — it clears the profile.
   */
  static async replaceForUser(
    userId: string,
    entries: readonly CompetitionPreferenceEntryInput[],
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.competitionPreference.deleteMany({ where: { userId } });

      if (entries.length > 0) {
        await tx.competitionPreference.createMany({
          data: entries.map((entry) => ({
            userId,
            dimension: entry.dimension,
            value: entry.value,
            weight: entry.weight,
          })),
        });
      }
    });
  }
}
