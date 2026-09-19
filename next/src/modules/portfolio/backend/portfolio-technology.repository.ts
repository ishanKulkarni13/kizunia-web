/**
 * Portfolio Technologies - Repository
 *
 * Responsible only for database access on the `PortfolioTechnology` join
 * model. Repositories should never contain business rules.
 *
 * Unlike Portfolio Projects, a Technology attach here is not scoped by any
 * membership/eligibility concept — the owner may showcase any active,
 * non-deleted Technology from the global catalog. Whether a given
 * Technology is still eligible to attach (exists, not soft-deleted) is
 * re-validated independently by the service before every write; this
 * repository trusts nothing about that beyond `technologyId` being a valid
 * foreign key.
 *
 * Unlike `PortfolioProject`/Testimonial, this model carries no `createdAt`
 * column (see schema.prisma) — presentation order therefore relies solely
 * on `displayOrder`, matching the existing `technologies` includes in
 * `repository.ts`.
 */

import { Prisma, PrismaClient } from "@/generated/prisma";
import prisma from "@/lib/prisma";

import { PortfolioTechnologyAlreadyExistsError } from "../errors";

const portfolioTechnologyInclude = {
  technology: {
    include: {
      iconAsset: true,
    },
  },
} satisfies Prisma.PortfolioTechnologyInclude;

export type PortfolioTechnologyEntity = Prisma.PortfolioTechnologyGetPayload<{
  include: typeof portfolioTechnologyInclude;
}>;

export class PortfolioTechnologyRepository {
  constructor(
    private readonly db: PrismaClient | Prisma.TransactionClient = prisma,
  ) {}

  // =============================================================================
  // Read
  // =============================================================================

  async findManyByPortfolio({
    portfolioId,
  }: {
    portfolioId: string;
  }): Promise<PortfolioTechnologyEntity[]> {
    return this.db.portfolioTechnology.findMany({
      where: {
        portfolioId,
      },
      orderBy: {
        displayOrder: "asc",
      },
      include: portfolioTechnologyInclude,
    });
  }

  /**
   * Technology ids the portfolio may currently manage, for validating that a
   * reorder request covers exactly that set.
   */
  async findManageableTechnologyIds({
    portfolioId,
  }: {
    portfolioId: string;
  }): Promise<string[]> {
    const rows = await this.db.portfolioTechnology.findMany({
      where: {
        portfolioId,
      },
      select: {
        technologyId: true,
      },
    });

    return rows.map((row) => row.technologyId);
  }

  async findByIdForPortfolio({
    portfolioId,
    technologyId,
  }: {
    portfolioId: string;
    technologyId: string;
  }): Promise<PortfolioTechnologyEntity | null> {
    return this.db.portfolioTechnology.findUnique({
      where: {
        portfolioId_technologyId: {
          portfolioId,
          technologyId,
        },
      },
      include: portfolioTechnologyInclude,
    });
  }

  /**
   * Display order for a technology appended to the end of a portfolio's
   * list. Returns `0` for the first technology, matching the schema
   * default. Callers must hold a transaction, since two concurrent appends
   * reading the same maximum would collide.
   */
  async nextDisplayOrder({
    portfolioId,
  }: {
    portfolioId: string;
  }): Promise<number> {
    const last = await this.db.portfolioTechnology.aggregate({
      where: {
        portfolioId,
      },
      _max: {
        displayOrder: true,
      },
    });

    const highest = last._max.displayOrder;

    return highest === null ? 0 : highest + 1;
  }

  // =============================================================================
  // Create
  // =============================================================================

  async create({
    portfolioId,
    technologyId,
    startedUsingAt,
    description,
    displayOrder,
  }: {
    portfolioId: string;
    technologyId: string;
    startedUsingAt: Date | null;
    description: string | null;
    displayOrder: number;
  }): Promise<void> {
    try {
      await this.db.portfolioTechnology.create({
        data: {
          portfolioId,
          technologyId,
          startedUsingAt,
          description,
          displayOrder,
        },
      });
    } catch (error) {
      // The composite primary key is the authority on duplicates: two
      // concurrent adds can both pass the service's pre-check before either
      // has written a row, so this is a real path rather than a backstop.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new PortfolioTechnologyAlreadyExistsError();
      }

      throw error;
    }
  }

  // =============================================================================
  // Update
  // =============================================================================

  /**
   * Scoped by both halves of the composite key, so a technologyId belonging
   * to another portfolio simply matches nothing. Returns the affected row
   * count — `0` means "not in this portfolio", which the service maps to a
   * 404.
   */
  async updateMetadata({
    portfolioId,
    technologyId,
    data,
  }: {
    portfolioId: string;
    technologyId: string;
    data: {
      startedUsingAt?: Date | null;
      description?: string | null;
    };
  }): Promise<number> {
    const result = await this.db.portfolioTechnology.updateMany({
      where: {
        portfolioId,
        technologyId,
      },
      data,
    });

    return result.count;
  }

  async updateDisplayOrder({
    portfolioId,
    technologyId,
    displayOrder,
  }: {
    portfolioId: string;
    technologyId: string;
    displayOrder: number;
  }): Promise<number> {
    const result = await this.db.portfolioTechnology.updateMany({
      where: {
        portfolioId,
        technologyId,
      },
      data: {
        displayOrder,
      },
    });

    return result.count;
  }

  // =============================================================================
  // Delete
  // =============================================================================

  async delete({
    portfolioId,
    technologyId,
  }: {
    portfolioId: string;
    technologyId: string;
  }): Promise<number> {
    const result = await this.db.portfolioTechnology.deleteMany({
      where: {
        portfolioId,
        technologyId,
      },
    });

    return result.count;
  }
}
