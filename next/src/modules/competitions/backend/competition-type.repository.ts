import { Prisma } from "@/generated/prisma";
import type { CompetitionType } from "@/generated/prisma";
import prisma from "@/lib/prisma";

export type CompetitionTypeRelationRow =
  Prisma.CompetitionTypeRelationGetPayload<object>;

export class CompetitionTypeRepository {
  /**
   * Database Layer
   *
   * Responsibilities
   * ----------------
   * - Build Prisma queries
   * - Execute database operations
   * - Return Prisma models
   *
   * Does NOT
   * ----------------
   * - Business rules
   * - Authentication
   * - Authorization
   * - DTO Mapping
   */
  static async findManyByCompetition(
    competitionId: string,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<CompetitionTypeRelationRow[]> {
    return db.competitionTypeRelation.findMany({
      where: {
        competitionId,
      },

      // No lookup table to sort by name -- the enum declaration order is
      // the only stable order, so this sorts by the raw `type` string.
      orderBy: {
        type: "asc",
      },
    });
  }

  static async findOne(
    competitionId: string,
    type: CompetitionType,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<CompetitionTypeRelationRow | null> {
    return db.competitionTypeRelation.findUnique({
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
    type: CompetitionType,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<void> {
    await db.competitionTypeRelation.create({
      data: {
        competitionId,
        type,
      },
    });
  }

  /**
   * Detaches by the composite key, using `deleteMany` rather than `delete`
   * because `CompetitionTypeRelation` has no single-column id to target with
   * `delete`. Returns the affected row count so the caller can tell whether
   * the value was actually attached.
   */
  static async deleteMany(
    competitionId: string,
    type: CompetitionType,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<number> {
    const result = await db.competitionTypeRelation.deleteMany({
      where: {
        competitionId,
        type,
      },
    });

    return result.count;
  }
}
