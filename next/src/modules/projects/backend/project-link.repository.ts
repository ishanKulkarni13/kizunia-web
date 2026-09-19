/**
 * Project Links - Repository
 *
 * Responsible only for database access on the `Link` model, scoped to a
 * single project. Repositories should never contain business rules.
 */

import { Link, LinkType, Prisma, PrismaClient } from "@/generated/prisma";
import prisma from "@/lib/prisma";

import { ProjectLinkNotFoundError } from "./errors";

export class ProjectLinkRepository {
  constructor(
    private readonly db: PrismaClient | Prisma.TransactionClient = prisma,
  ) {}

  // =============================================================================
  // Read
  // =============================================================================

  async findManyByProject({
    projectId,
  }: {
    projectId: string;
  }): Promise<Link[]> {
    return this.db.link.findMany({
      where: {
        projectId,
      },
      orderBy: {
        order: "asc",
      },
    });
  }

  /**
   * Ids owned by a project, for validating a reorder request covers exactly
   * that project's links.
   */
  async findIdsByProject({
    projectId,
  }: {
    projectId: string;
  }): Promise<string[]> {
    const rows = await this.db.link.findMany({
      where: {
        projectId,
      },
      select: {
        id: true,
      },
    });

    return rows.map((row) => row.id);
  }

  async findByIdForProject({
    projectId,
    linkId,
  }: {
    projectId: string;
    linkId: string;
  }): Promise<Link | null> {
    return this.db.link.findFirst({
      where: {
        id: linkId,

        // Scoped by project so an id from another project cannot be read or
        // mutated through this project's endpoints.
        projectId,
      },
    });
  }

  async findByIdForProjectOrThrow({
    projectId,
    linkId,
  }: {
    projectId: string;
    linkId: string;
  }): Promise<Link> {
    const link = await this.findByIdForProject({ projectId, linkId });

    if (!link) {
      throw new ProjectLinkNotFoundError();
    }

    return link;
  }

  /**
   * Order for a link appended to the end of a project's list.
   *
   * Returns `0` for the first link. Callers must hold a transaction, since two
   * concurrent appends reading the same maximum would collide.
   */
  async nextOrder({ projectId }: { projectId: string }): Promise<number> {
    const last = await this.db.link.aggregate({
      where: {
        projectId,
      },
      _max: {
        order: true,
      },
    });

    const highest = last._max.order;

    return highest === null ? 0 : highest + 1;
  }

  // =============================================================================
  // Create
  // =============================================================================

  async create({
    projectId,
    data,
  }: {
    projectId: string;
    data: {
      title: string;
      url: string;
      type: LinkType;
      order: number;
    };
  }): Promise<Link> {
    return this.db.link.create({
      data: {
        ...data,
        projectId,
      },
    });
  }

  // =============================================================================
  // Update
  // =============================================================================

  async update({
    linkId,
    data,
  }: {
    linkId: string;
    data: Prisma.LinkUpdateInput;
  }): Promise<Link> {
    return this.db.link.update({
      where: {
        id: linkId,
      },
      data,
    });
  }

  // =============================================================================
  // Delete
  // =============================================================================

  async delete({ linkId }: { linkId: string }): Promise<void> {
    await this.db.link.delete({
      where: {
        id: linkId,
      },
    });
  }
}
