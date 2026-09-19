/**
 * Portfolio Projects - Repository
 *
 * Responsible only for database access on the `PortfolioProject` join model.
 * Repositories should never contain business rules.
 *
 * Two invariants are baked into every read here, and they are the reason this
 * feature needs no cleanup workflow to stay correct:
 *
 *   1. the project is not soft-deleted, and
 *   2. the portfolio's owner is still a member of it.
 *
 * A relationship row whose membership has since ended is inert — it is never
 * returned, so it can never be rendered, featured or reordered. Cleanup is
 * therefore hygiene rather than a correctness requirement.
 *
 * Note what is deliberately absent: any project visibility or status filter.
 * That belongs to the *public* portfolio query alone (see `repository.ts`).
 * The editor must keep showing DRAFT, PRIVATE and UNLISTED projects so their
 * owner can manage the relationship.
 */

import { Prisma, PrismaClient } from "@/generated/prisma";
import prisma from "@/lib/prisma";

import { PortfolioProjectAlreadyExistsError } from "../errors";

const portfolioProjectSummarySelect = {
  projectId: true,

  featured: true,

  displayOrder: true,

  createdAt: true,

  project: {
    select: {
      id: true,

      title: true,

      slug: true,

      shortDescription: true,

      status: true,

      visibility: true,

      logoAsset: {
        select: {
          id: true,
          secureUrl: true,
          width: true,
          height: true,
          format: true,
          mimeType: true,
        },
      },

      // Narrowed to the portfolio owner at query time, so exactly one row
      // comes back and carries their role. Declared here without the filter
      // purely so the entity type below has the right shape.
      members: {
        select: {
          role: true,
        },
      },
    },
  },
} satisfies Prisma.PortfolioProjectSelect;

export type PortfolioProjectSummaryEntity = Prisma.PortfolioProjectGetPayload<{
  select: typeof portfolioProjectSummarySelect;
}>;

export class PortfolioProjectRepository {
  constructor(
    private readonly db: PrismaClient | Prisma.TransactionClient = prisma,
  ) {}

  // =============================================================================
  // Read
  // =============================================================================

  /**
   * The portfolio's manageable relationships, in presentation order.
   *
   * `ownerUserId` is the portfolio owner, resolved server-side — it is what
   * makes the membership filter trustworthy.
   */
  async findManyByPortfolio({
    portfolioId,
    ownerUserId,
  }: {
    portfolioId: string;
    ownerUserId: string;
  }): Promise<PortfolioProjectSummaryEntity[]> {
    return this.db.portfolioProject.findMany({
      where: this.buildManageableWhere({ portfolioId, ownerUserId }),

      // `createdAt` breaks ties: legacy rows all share the schema default of
      // 100, so `displayOrder` alone would order them non-deterministically.
      orderBy: [
        {
          displayOrder: "asc",
        },
        {
          createdAt: "asc",
        },
      ],

      select: {
        ...portfolioProjectSummarySelect,

        project: {
          select: {
            ...portfolioProjectSummarySelect.project.select,

            members: {
              where: {
                userId: ownerUserId,
              },
              select: {
                role: true,
              },
            },
          },
        },
      },
    });
  }

  /**
   * Project ids the portfolio may currently manage, for validating that a
   * reorder request covers exactly that set.
   */
  async findManageableProjectIds({
    portfolioId,
    ownerUserId,
  }: {
    portfolioId: string;
    ownerUserId: string;
  }): Promise<string[]> {
    const rows = await this.db.portfolioProject.findMany({
      where: this.buildManageableWhere({ portfolioId, ownerUserId }),
      select: {
        projectId: true,
      },
    });

    return rows.map((row) => row.projectId);
  }

  /**
   * The project an actor is eligible to attach: it must exist, not be
   * soft-deleted, and carry a membership row for this user. Any role
   * qualifies — membership existence *is* the eligibility rule.
   *
   * Returns null for "no such project", "deleted project" and "not a member"
   * alike, so a caller probing ids learns nothing from the distinction.
   */
  async findEligibleProject({
    projectId,
    userId,
  }: {
    projectId: string;
    userId: string;
  }): Promise<{ id: string } | null> {
    return this.db.project.findFirst({
      where: {
        id: projectId,

        deletedAt: null,

        members: {
          some: {
            userId,
          },
        },
      },
      select: {
        id: true,
      },
    });
  }

  /**
   * Order for a project appended to the end of a portfolio's list.
   *
   * Returns `0` for the first project. Callers must hold a transaction, since
   * two concurrent appends reading the same maximum would collide.
   */
  async nextDisplayOrder({
    portfolioId,
  }: {
    portfolioId: string;
  }): Promise<number> {
    const last = await this.db.portfolioProject.aggregate({
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
    projectId,
    displayOrder,
  }: {
    portfolioId: string;
    projectId: string;
    displayOrder: number;
  }): Promise<void> {
    try {
      await this.db.portfolioProject.create({
        data: {
          portfolioId,
          projectId,
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
        throw new PortfolioProjectAlreadyExistsError();
      }

      throw error;
    }
  }

  // =============================================================================
  // Update
  // =============================================================================

  /**
   * Scoped by both halves of the composite key, so a projectId belonging to
   * another portfolio simply matches nothing. Returns the affected row count
   * — `0` means "not in this portfolio", which the service maps to a 404.
   */
  async updateFeatured({
    portfolioId,
    projectId,
    featured,
  }: {
    portfolioId: string;
    projectId: string;
    featured: boolean;
  }): Promise<number> {
    const result = await this.db.portfolioProject.updateMany({
      where: {
        portfolioId,
        projectId,
      },
      data: {
        featured,
      },
    });

    return result.count;
  }

  async updateDisplayOrder({
    portfolioId,
    projectId,
    displayOrder,
  }: {
    portfolioId: string;
    projectId: string;
    displayOrder: number;
  }): Promise<number> {
    const result = await this.db.portfolioProject.updateMany({
      where: {
        portfolioId,
        projectId,
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
    projectId,
  }: {
    portfolioId: string;
    projectId: string;
  }): Promise<number> {
    const result = await this.db.portfolioProject.deleteMany({
      where: {
        portfolioId,
        projectId,
      },
    });

    return result.count;
  }

  /**
   * Drops every relationship a user holds to a project, addressed through the
   * portfolio's owner rather than a portfolio id.
   *
   * The seam for a future ProjectMember removal workflow — see
   * `PortfolioProjectService.removeForMembershipEnd`.
   */
  async deleteByProjectAndOwner({
    projectId,
    userId,
  }: {
    projectId: string;
    userId: string;
  }): Promise<number> {
    const result = await this.db.portfolioProject.deleteMany({
      where: {
        projectId,

        portfolio: {
          userId,
        },
      },
    });

    return result.count;
  }

  // =============================================================================
  // Helpers
  // =============================================================================

  /**
   * The editor-side validity rule, in one place: relationship belongs to this
   * portfolio, the project still exists, and the owner is still a member.
   *
   * Carries no visibility or status filter by design — see the file header.
   */
  private buildManageableWhere({
    portfolioId,
    ownerUserId,
  }: {
    portfolioId: string;
    ownerUserId: string;
  }): Prisma.PortfolioProjectWhereInput {
    return {
      portfolioId,

      project: {
        deletedAt: null,

        members: {
          some: {
            userId: ownerUserId,
          },
        },
      },
    };
  }
}
