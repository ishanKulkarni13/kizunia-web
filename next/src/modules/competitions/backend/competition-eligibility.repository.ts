import { Prisma } from "@/generated/prisma";
import type { EligibilityType } from "@/generated/prisma";
import prisma from "@/lib/prisma";

export type CompetitionEligibilityRow = Prisma.CompetitionEligibilityGetPayload<object>;

export class CompetitionEligibilityRepository {
  /**
   * Database Layer
   *
   * Responsibilities
   * ----------------
   * ✓ Build Prisma queries
   * ✓ Execute database operations
   * ✓ Return Prisma models
   *
   * Does NOT
   * ----------------
   * ✗ Business rules
   * ✗ Authentication
   * ✗ Authorization
   * ✗ DTO Mapping
   */
  static async findManyByCompetition(
    competitionId: string,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<CompetitionEligibilityRow[]> {
    return db.competitionEligibility.findMany({
      where: {
        competitionId,
      },

      // No lookup table to sort by name — the enum's declaration order is
      // the only stable order, so this sorts by the raw `type` string.
      orderBy: {
        type: "asc",
      },
    });
  }

  static async findOne(
    competitionId: string,
    type: EligibilityType,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<CompetitionEligibilityRow | null> {
    return db.competitionEligibility.findUnique({
      where: {
        competitionId_type: {
          competitionId,
          type,
        },
      },
    });
  }

  static async create(
    competitionId: string,
    type: EligibilityType,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<void> {
    await db.competitionEligibility.create({
      data: {
        competitionId,
        type,
      },
    });
  }

  /**
   * Detaches by the composite key, using `deleteMany` rather than `delete`
   * — `CompetitionEligibility` has no single-column id to target with
   * `delete`. Returns the affected row count so the caller can tell whether
   * the value was actually attached.
   */
  static async deleteMany(
    competitionId: string,
    type: EligibilityType,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<number> {
    const result = await db.competitionEligibility.deleteMany({
      where: {
        competitionId,
        type,
      },
    });

    return result.count;
  }
}
