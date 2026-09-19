import { Prisma } from "@/generated/prisma";
import prisma from "@/lib/prisma";

import { CompetitionLocationNotFoundError } from "../errors";

/**
 * Prisma payload for a competition location with its place loaded.
 *
 * Keep this in sync with the `include` clauses below.
 */
export type CompetitionLocationWithPlace = Prisma.CompetitionLocationGetPayload<{
  include: {
    location: true;
  };
}>;

const withLocation = {
  location: true,
} as const;

export class CompetitionLocationRepository {
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
  ): Promise<CompetitionLocationWithPlace[]> {
    return db.competitionLocation.findMany({
      where: {
        competitionId,
      },

      include: withLocation,

      // Row order is never relied upon; `order` is the presentation contract.
      // `createdAt` breaks ties so equal orders stay stable across requests.
      orderBy: [
        {
          order: "asc",
        },
        {
          createdAt: "asc",
        },
      ],
    });
  }

  static async findByIdForCompetition(
    competitionId: string,
    competitionLocationId: string,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<CompetitionLocationWithPlace | null> {
    return db.competitionLocation.findFirst({
      where: {
        id: competitionLocationId,

        // Scoped by competition so an id from another competition cannot be
        // read or mutated through this competition's endpoints.
        competitionId,
      },

      include: withLocation,
    });
  }

  static async findByIdForCompetitionOrThrow(
    competitionId: string,
    competitionLocationId: string,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<CompetitionLocationWithPlace> {
    const competitionLocation = await this.findByIdForCompetition(
      competitionId,
      competitionLocationId,
      db,
    );

    if (!competitionLocation) {
      throw new CompetitionLocationNotFoundError();
    }

    return competitionLocation;
  }

  static async create(
    data: Prisma.CompetitionLocationUncheckedCreateInput,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ) {
    return db.competitionLocation.create({
      data,
    });
  }

  static async update(
    competitionLocationId: string,
    data: Prisma.CompetitionLocationUncheckedUpdateInput,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ) {
    return db.competitionLocation.update({
      where: {
        id: competitionLocationId,
      },
      data,
    });
  }

  static async delete(
    competitionLocationId: string,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ) {
    return db.competitionLocation.delete({
      where: {
        id: competitionLocationId,
      },
    });
  }

  /**
   * Order for a location appended to the end of a competition's list.
   *
   * Returns `0` for the first location. Callers must hold a transaction, since
   * two concurrent appends reading the same maximum would collide — a tie the
   * `createdAt` sort resolves, but only after the fact.
   */
  static async nextOrder(
    competitionId: string,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<number> {
    const last = await db.competitionLocation.aggregate({
      where: {
        competitionId,
      },
      _max: {
        order: true,
      },
    });

    const highest = last._max.order;

    return highest === null ? 0 : highest + 1;
  }

  static async countForCompetition(
    competitionId: string,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<number> {
    return db.competitionLocation.count({
      where: {
        competitionId,
      },
    });
  }

  /**
   * Returns the ids belonging to a competition, for validating a reorder
   * request covers exactly that competition's locations.
   */
  static async findIdsForCompetition(
    competitionId: string,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<string[]> {
    const rows = await db.competitionLocation.findMany({
      where: {
        competitionId,
      },
      select: {
        id: true,
      },
    });

    return rows.map((row) => row.id);
  }
}
