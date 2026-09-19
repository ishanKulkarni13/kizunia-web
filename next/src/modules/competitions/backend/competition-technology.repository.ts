import { Prisma } from "@/generated/prisma";
import prisma from "@/lib/prisma";

/**
 * Prisma payload for a competition-technology link with its Technology (and
 * the Technology's icon) loaded.
 *
 * Keep this in sync with the `include` clause below.
 */
export type CompetitionTechnologyWithTechnology =
  Prisma.CompetitionTechnologyGetPayload<{
    include: {
      technology: {
        include: {
          iconAsset: true;
        };
      };
    };
  }>;

const withTechnology = {
  technology: {
    include: {
      iconAsset: true,
    },
  },
} as const;

export class CompetitionTechnologyRepository {
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
  ): Promise<CompetitionTechnologyWithTechnology[]> {
    return db.competitionTechnology.findMany({
      where: {
        competitionId,
      },

      include: withTechnology,

      // There is no ordering concept for this relationship (unlike Project
      // and Portfolio technologies) — sorted by name purely so the list
      // renders deterministically across requests.
      orderBy: {
        technology: {
          name: "asc",
        },
      },
    });
  }

  static async findOne(
    competitionId: string,
    technologyId: string,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<CompetitionTechnologyWithTechnology | null> {
    return db.competitionTechnology.findUnique({
      where: {
        competitionId_technologyId: {
          competitionId,
          technologyId,
        },
      },

      include: withTechnology,
    });
  }

  static async create(
    competitionId: string,
    technologyId: string,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<void> {
    await db.competitionTechnology.create({
      data: {
        competitionId,
        technologyId,
      },
    });
  }

  /**
   * Detaches by the composite key, using `deleteMany` rather than `delete`
   * — `CompetitionTechnology` has no single-column id to target with
   * `delete`. Returns the affected row count so the caller can tell whether
   * the relationship actually existed.
   */
  static async deleteMany(
    competitionId: string,
    technologyId: string,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<number> {
    const result = await db.competitionTechnology.deleteMany({
      where: {
        competitionId,
        technologyId,
      },
    });

    return result.count;
  }
}
