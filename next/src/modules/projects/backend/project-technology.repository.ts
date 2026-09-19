/**
 * Project Technologies - Repository
 *
 * Responsible only for database access on the `ProjectTechnology` join
 * model, scoped to a single project. Repositories should never contain
 * business rules.
 *
 * Structurally this mirrors `PortfolioProjectRepository`, not
 * `ProjectLinkRepository`: `ProjectTechnology` has a composite primary key
 * (`[projectId, technologyId]`, see `prisma/schema.prisma`) and no id of its
 * own, so mutations go through `updateMany`/`deleteMany` scoped by both
 * halves of the key rather than `update`/`delete` by a single id.
 */

import { Prisma, PrismaClient } from "@/generated/prisma";
import prisma from "@/lib/prisma";

import { ProjectTechnologyAlreadyAttachedError } from "./errors";

const projectTechnologyInclude = {
  technology: {
    include: {
      iconAsset: {
        select: {
          id: true,
          secureUrl: true,
          width: true,
          height: true,
          format: true,
          mimeType: true,
        },
      },
    },
  },
} satisfies Prisma.ProjectTechnologyInclude;

export type ProjectTechnologyEntity = Prisma.ProjectTechnologyGetPayload<{
  include: typeof projectTechnologyInclude;
}>;

export class ProjectTechnologyRepository {
  constructor(
    private readonly db: PrismaClient | Prisma.TransactionClient = prisma,
  ) {}

  // =============================================================================
  // Read
  // =============================================================================

  /**
   * A project's attached technologies, in presentation order.
   *
   * `ProjectTechnology` carries no `createdAt` column (unlike
   * `PortfolioProject`), so there is no timestamp available as a tiebreaker
   * for rows sharing the same `displayOrder` (e.g. legacy rows at the schema
   * default of `0`). `technologyId` is used instead purely for a stable,
   * deterministic order — it carries no meaning of its own.
   */
  async findManyByProject({
    projectId,
  }: {
    projectId: string;
  }): Promise<ProjectTechnologyEntity[]> {
    return this.db.projectTechnology.findMany({
      where: {
        projectId,
      },
      orderBy: [
        {
          displayOrder: "asc",
        },
        {
          technologyId: "asc",
        },
      ],
      include: projectTechnologyInclude,
    });
  }

  /**
   * Technology ids owned by a project, for validating that a reorder request
   * covers exactly that set.
   */
  async findIdsByProject({
    projectId,
  }: {
    projectId: string;
  }): Promise<string[]> {
    const rows = await this.db.projectTechnology.findMany({
      where: {
        projectId,
      },
      select: {
        technologyId: true,
      },
    });

    return rows.map((row) => row.technologyId);
  }

  /**
   * Order for a technology appended to the end of a project's list.
   *
   * Returns `0` for the first technology. Callers must hold a transaction,
   * since two concurrent appends reading the same maximum would collide.
   */
  async nextDisplayOrder({
    projectId,
  }: {
    projectId: string;
  }): Promise<number> {
    const last = await this.db.projectTechnology.aggregate({
      where: {
        projectId,
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
    projectId,
    technologyId,
    displayOrder,
  }: {
    projectId: string;
    technologyId: string;
    displayOrder: number;
  }): Promise<void> {
    try {
      await this.db.projectTechnology.create({
        data: {
          projectId,
          technologyId,
          displayOrder,
        },
      });
    } catch (error) {
      // The composite primary key is the authority on duplicates: two
      // concurrent attaches can both pass the service's pre-check before
      // either has written a row, so this is a real path rather than a
      // backstop.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ProjectTechnologyAlreadyAttachedError();
      }

      throw error;
    }
  }

  // =============================================================================
  // Update
  // =============================================================================

  /**
   * Scoped by both halves of the composite key, so a technologyId that
   * isn't attached to this project simply matches nothing. Returns the
   * affected row count — `0` means "not attached to this project".
   */
  async updateDisplayOrder({
    projectId,
    technologyId,
    displayOrder,
  }: {
    projectId: string;
    technologyId: string;
    displayOrder: number;
  }): Promise<number> {
    const result = await this.db.projectTechnology.updateMany({
      where: {
        projectId,
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
    projectId,
    technologyId,
  }: {
    projectId: string;
    technologyId: string;
  }): Promise<number> {
    const result = await this.db.projectTechnology.deleteMany({
      where: {
        projectId,
        technologyId,
      },
    });

    return result.count;
  }
}
