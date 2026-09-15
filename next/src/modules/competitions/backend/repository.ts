

// interface FindCompetitionsOptions {
//   search?: string;

import {
  Prisma,
  type CompetitionStatus,
  type CompetitionVisibility,
} from "@/generated/prisma";
import prisma from "@/lib/prisma";
import { CompetitionNotFoundError } from "../errors";
import { CreateCompetitionInput } from "../schemas/create-competition";
import { UpdateCompetitionInput } from "../schemas/update-competition";
import {
  buildCompetitionQuery,
  type CompetitionSearchPlan,
} from "../search/plan";
import { CompetitionAssetSlot } from "../types/asset-slot";


//   mode?: Prisma.CompetitionWhereInput["mode"];

//   status?: Prisma.CompetitionWhereInput["status"];

//   category?: string;

//   technology?: string;

//   sort?: "start-date" | "deadline" | "newest";

//   skip: number;

//   take: number;
// }

export class CompetitionRepository {
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
  // static async findMany(filters: FindCompetitionsOptions) {
  //   const where: Prisma.CompetitionWhereInput = {
  //     deletedAt: null,
  //     ...(filters.search && {
  //       OR: [
  //         {
  //           title: {
  //             contains: filters.search,
  //             mode: "insensitive",
  //           },
  //         },
  //         {
  //           organizer: {
  //             contains: filters.search,
  //             mode: "insensitive",
  //           },
  //         },
  //       ],
  //     }),

  //     ...(filters.mode && {
  //       mode: filters.mode,
  //     }),

  //     ...(filters.status && {
  //       status: filters.status,
  //     }),

  //     ...(filters.category && {
  //       categories: {
  //         some: {
  //           category: {
  //             slug: filters.category,
  //           },
  //         },
  //       },
  //     }),

  //     ...(filters.technology && {
  //       technologies: {
  //         some: {
  //           technology: {
  //             slug: filters.technology,
  //           },
  //         },
  //       },
  //     }),
  //   };

  //   return prisma.competition.findMany({
  //     where,

  //     include: {
  //       logoAsset: true,
  //       coverAsset: true,
  //     },

  //     orderBy: this.getOrderBy(filters.sort),

  //     skip: filters.skip,

  //     take: filters.take,
  //   });
  // }

  /**
   * Locations, ordered for presentation.
   *
   * `order` is the contract; `createdAt` only breaks ties so equal orders stay
   * stable across requests instead of following row order.
   */
  private static readonly locationsInclude = {
    include: {
      location: true,
    },

    orderBy: [
      {
        order: "asc",
      },
      {
        createdAt: "asc",
      },
    ],
  } satisfies Prisma.Competition$locationsArgs;

  /**
   * Rows for a planned search.
   *
   * Takes a plan rather than raw parameters so it cannot re-resolve anything:
   * `count` below is handed the same plan and therefore builds a byte-identical
   * `where`. See `search/plan.ts` for why that is enforced by the type.
   */
  static async findMany(plan: CompetitionSearchPlan) {
    const query = buildCompetitionQuery(plan);

    return prisma.competition.findMany({
      ...query,

      include: {
        logoAsset: true,
        coverAsset: true,
        locations: this.locationsInclude,
      },
    });
  }

  /**
   * Rows the actor can manage.
   *
   * `actorId` is passed separately from the plan because it serves a different
   * purpose here: the plan's scope guard is what *restricts* the rows, while
   * this only decides which membership row to hydrate for presentation. Reading
   * it out of the plan would blur a filtering concern into a loading one.
   */
  static async findManyManageable(
    actorId: string,
    plan: CompetitionSearchPlan,
  ) {
    const query = buildCompetitionQuery(plan);

    return prisma.competition.findMany({
      ...query,

      include: {
        logoAsset: true,
        coverAsset: true,

        members: {
          where: {
            userId: actorId,
          },
          take: 1,
        },

        _count: {
          select: {
            members: true,
          },
        },
      },
    });
  }

  static async findManyAdmin(actorId: string, plan: CompetitionSearchPlan) {
    const query = buildCompetitionQuery(plan);

    return prisma.competition.findMany({
      ...query,

      include: {
        logoAsset: true,
        coverAsset: true,

        members: {
          where: {
            userId: actorId,
          },
          take: 1,
        },

        _count: {
          select: {
            members: true,
          },
        },
      },
    });
  }

  static async findBySlug(slug: string) {
    return prisma.competition.findFirst({
      where: {
        slug,
        deletedAt: null,
      },
      include: {
        logoAsset: true,
        coverAsset: true,
        bannerAsset: true,
        content: true,
        categories: {
          include: {
            category: true,
          },
        },

        technologies: {
          include: {
            technology: true,
          },
        },

        eligibilities: true,

        locations: this.locationsInclude,
      },
    });
  }
  static async findBySlugOrThrow(slug: string): Promise<
    Prisma.CompetitionGetPayload<{
      include: {
        logoAsset: true;
        coverAsset: true;
        bannerAsset: true;
        content: true;
        categories: {
          include: {
            category: true;
          };
        };

        technologies: {
          include: {
            technology: true;
          };
        };

        eligibilities: true;

        locations: {
          include: {
            location: true;
          };
        };
      };
    }>
  > {
    const competition = await this.findBySlug(slug);

    if (!competition) {
      throw new CompetitionNotFoundError();
    }
    return competition;
  }

  static async findById(id: string) {
    return prisma.competition.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    });
  }

  static async findByIdOrThrow(id: string) {
    const competition = await this.findById(id);

    if (!competition) {
      throw new CompetitionNotFoundError(`Competition with given id not found.`);
    }

    return competition;
  }

  /**
   * Like `findById`, but does not exclude soft-deleted rows.
   *
   * Every other lookup in this class filters `deletedAt: null` because a
   * deleted competition is meant to behave as though it does not exist for
   * ordinary reads, edits and deletes. Restore is the one operation that is
   * only ever meaningful on a row exactly like that, so it needs the one path
   * that can actually find it — see `CompetitionContextResolver.resolveIncludingDeleted`.
   */
  static async findByIdIncludingDeleted(id: string) {
    return prisma.competition.findFirst({
      where: { id },
    });
  }

  static async findByIdIncludingDeletedOrThrow(id: string) {
    const competition = await this.findByIdIncludingDeleted(id);

    if (!competition) {
      throw new CompetitionNotFoundError(`Competition with given id not found.`);
    }

    return competition;
  }

  static async findByIdForEdit(
    id: string,
    db: Prisma.TransactionClient | Prisma.DefaultPrismaClient = prisma,
  ) {
    const competition = await db.competition.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      include: {
        logoAsset: true,
        coverAsset: true,
        bannerAsset: true,

        content: true,

        categories: {
          include: {
            category: true,
          },
        },

        technologies: {
          include: {
            technology: {
              include: {
                iconAsset: true,
              },
            },
          },
        },

        eligibilities: true,

        locations: this.locationsInclude,
      },
    });

    if (!competition) {
      throw new CompetitionNotFoundError();
    }

    return competition;
  }

  /**
   * This method is different from existsBySlugExceptCompetition because it doesn't check for the competition id.
   * It's only used for create method.
   */
  static async existsBySlug(slug: string): Promise<boolean> {
    const exists = await prisma.competition.findUnique({
      where: {
        slug,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    return exists !== null;
  }


  static async existsBySlugExceptCompetition({
    slug,
    competitionId,
  }: {
    slug: string;
    competitionId: string;
  }): Promise<boolean> {
    const exists = await prisma.competition.findFirst({
      where: {
        slug,
        deletedAt: null,
        id: {
          not: competitionId,
        },
      },
      select: {
        id: true,
      },
    });

    return exists !== null;
  }

  static async existsById(id: string): Promise<boolean> {
    const exists = await prisma.competition.findUnique({
      where: {
        id,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    return exists !== null;
  }
  static async create({ data }: { data: CreateCompetitionInput }) {
    const competition = await prisma.competition.create({
      data: {
        title: data.title,
        slug: data.slug,

        shortDescription: data.shortDescription || null,

        organizer: data.organizer || null,

        website: data.website || null,

        registrationLink: data.registrationLink || null,

        content: {
          create: {
            content: data.content ?? "",
          },
        },
      },
    });

    return competition;
  }

  /**
   * Updates a competition's fields (and, if `content` is present, its
   * documentation).
   *
   * Takes an optional transaction client rather than opening its own —
   * unlike the version of this method that used to live here, so it can be
   * composed into a larger transaction. `CompetitionService.update` opens
   * that transaction, so it can enlist a subsequent lifecycle reconciliation
   * write into the very same one: either both persist, or neither does.
   *
   * `updatedById` is written only when the caller passes it and only when it
   * is not `undefined` — `null` is a legitimate value (attribution cleared)
   * distinct from "the caller has no opinion". It is never set by automatic
   * lifecycle processing; see `CompetitionLifecycleService`, which updates
   * `status`/`statusUpdatedAt` alone.
   *
   * `statusUpdatedAt` is written only when this call's `data.status` differs
   * from the row's current status — an update that does not touch `status`,
   * or that sets it to the value it already has, must not disturb this
   * column.
   */
  static async update({
    id,
    data,
    updatedById,
    db = prisma,
  }: {
    id: string;
    data: UpdateCompetitionInput;
    updatedById?: string | null;
    db?: Prisma.TransactionClient | Prisma.DefaultPrismaClient;
  }) {
    const { content, ...rest } = data;

    const competition = await db.competition.findUnique({
      where: {
        id,
      },
      select: {
        contentId: true,
        status: true,
      },
    });

    if (!competition) {
      throw new CompetitionNotFoundError();
    }

    let contentId = competition.contentId;

    // The Content row this update makes unreferenced, if any — deleted only
    // after the competition row itself has been repointed away from it, so
    // there is never a moment where `competition.contentId` refers to a row
    // that no longer exists.
    let contentIdToDelete: string | null = null;

    // ------------------------------------------------------------
    // Update, create, or clear documentation
    //
    // `content` has three distinct meanings here: `undefined` (key absent)
    // leaves documentation untouched; a string creates or updates the
    // Content row; `null` explicitly clears it — disconnecting the
    // competition from its Content row and deleting that row, since a
    // Content row is always single-owner (see the schema's `Competition`,
    // `Project`, and `CompetitionSuggestion` relations, each with its own
    // `@unique` FK) and nothing else can be holding a reference to it.
    // ------------------------------------------------------------

    if (content !== undefined) {
      if (content === null) {
        if (contentId) {
          contentIdToDelete = contentId;
          contentId = null;
        }
        // Already null: no-op.
      } else if (contentId) {
        await db.content.update({
          where: {
            id: contentId,
          },
          data: {
            content,
            version: {
              increment: 1,
            },
          },
        });
      } else {
        const createdContent = await db.content.create({
          data: {
            content,
          },
        });

        contentId = createdContent.id;
      }
    }

    const statusChanging =
      rest.status !== undefined && rest.status !== competition.status;

    // ------------------------------------------------------------
    // Update competition
    // ------------------------------------------------------------

    const updated = await db.competition.update({
      where: {
        id,
      },
      data: {
        ...rest,

        ...(statusChanging && { statusUpdatedAt: new Date() }),

        ...(updatedById !== undefined && { updatedById }),

        // Written as the raw scalar FK (not `content: { connect }`) so this
        // payload stays entirely within Prisma's "unchecked" update shape —
        // mixing a relation-style write with a scalar FK write like
        // `updatedById` in the same call is a type error, since the two
        // belong to different (mutually exclusive) generated input types.
        ...(contentId !== competition.contentId && {
          contentId,
        }),
      },
    });

    if (contentIdToDelete) {
      await db.content.delete({
        where: {
          id: contentIdToDelete,
        },
      });
    }

    return updated;
  }

  static async setLogoAsset(
    tx: Prisma.TransactionClient,
    competitionId: string,
    assetId: string,
  ) {
    return tx.competition.update({
      where: {
        id: competitionId,
      },
      data: {
        logoAsset: {
          connect: {
            id: assetId,
          },
        },
      },
    });
  }

  static async setAsset(
    tx: Prisma.TransactionClient,
    competitionId: string,
    slot: CompetitionAssetSlot,
    assetId: string | null,
  ) {
    const relationField = {
      logo: "logoAsset",
      banner: "bannerAsset",
      cover: "coverAsset",
    } as const;

    return tx.competition.update({
      where: {
        id: competitionId,
      },
      data: {
        [relationField[slot]]:
          assetId === null
            ? { disconnect: true }
            : { connect: { id: assetId } },
      },
    });
  }

  static async softDelete(id: string) {
    // TODO: Soft delete is not fully implemented yet.
    return prisma.competition.update({
      where: {
        id,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  static async restore(id: string) {
    return prisma.competition.update({
      where: {
        id,
      },
      data: {
        deletedAt: null,
      },
    });
  }

  // ==========================================================================
  // Bulk admin actions
  // ==========================================================================
  //
  // Every method here takes the full requested id set and acts on it in one
  // statement. None of them decide *who* may act — that happens in the
  // service, per row, before any of these are called. By the time one of
  // these runs, every id in it has already been individually authorized.

  /**
   * Loads every requested competition, deliberately including soft-deleted
   * ones — a bulk RESTORE request targets exactly those rows, and the
   * ordinary `findById` would make them invisible to it. Returning fewer
   * rows than ids requested is how the caller detects a nonexistent id.
   */
  static async findManyByIds(ids: readonly string[]) {
    return prisma.competition.findMany({
      where: { id: { in: [...ids] } },
    });
  }

  /** The actor's membership across every requested competition, in one query. */
  static async findMembershipsByCompetitionIds(
    userId: string,
    competitionIds: readonly string[],
  ) {
    return prisma.competitionMember.findMany({
      where: { userId, competitionId: { in: [...competitionIds] } },
    });
  }

  static async bulkSetStatus(
    ids: readonly string[],
    status: CompetitionStatus,
    db: Prisma.TransactionClient | Prisma.DefaultPrismaClient = prisma,
  ) {
    return db.competition.updateMany({
      where: { id: { in: [...ids] } },
      data: { status },
    });
  }

  static async bulkSetVisibility(
    ids: readonly string[],
    visibility: CompetitionVisibility,
    db: Prisma.TransactionClient | Prisma.DefaultPrismaClient = prisma,
  ) {
    return db.competition.updateMany({
      where: { id: { in: [...ids] } },
      data: { visibility },
    });
  }

  static async bulkSoftDelete(
    ids: readonly string[],
    db: Prisma.TransactionClient | Prisma.DefaultPrismaClient = prisma,
  ) {
    return db.competition.updateMany({
      where: { id: { in: [...ids] } },
      data: { deletedAt: new Date() },
    });
  }

  static async bulkRestore(
    ids: readonly string[],
    db: Prisma.TransactionClient | Prisma.DefaultPrismaClient = prisma,
  ) {
    return db.competition.updateMany({
      where: { id: { in: [...ids] } },
      data: { deletedAt: null },
    });
  }

  static async findMembership(competitionId: string, userId: string) {
    return prisma.competitionMember.findUnique({
      where: {
        competitionId_userId: {
          competitionId,
          userId,
        },
      },
    });
  }

  static async findMembers(competitionId: string) {
    return prisma.competitionMember.findMany({
      where: {
        competitionId,
      },
    });
  }

  static async findOwners(competitionId: string) {
    return prisma.competitionMember.findMany({
      where: {
        competitionId,
        role: "OWNER",
      },
    });
  }

  static async search(query: string) {
    return prisma.competition.findMany({
      where: {
        deletedAt: null,
        OR: [
          {
            title: {
              contains: query,
              mode: "insensitive",
            },
          },
          {
            organizer: {
              contains: query,
              mode: "insensitive",
            },
          },
        ],
      },
    });
  }

  /**
   * Total for a planned search.
   *
   * Must be given the very same plan object `findMany` received. Building from
   * one plan is what guarantees the two `where` clauses are identical — a
   * total computed against a different predicate produces a pager to pages
   * that do not exist.
   */
  static async count(plan: CompetitionSearchPlan) {
    const { where } = buildCompetitionQuery(plan);

    return prisma.competition.count({
      where,
    });
  }

  static async countManageable(plan: CompetitionSearchPlan) {
    const { where } = buildCompetitionQuery(plan);

    return prisma.competition.count({
      where,
    });
  }

  static async countAdmin(plan: CompetitionSearchPlan) {
    const { where } = buildCompetitionQuery(plan);

    return prisma.competition.count({
      where,
    });
  }

  static async searchCount(where: Prisma.CompetitionWhereInput) {
    return prisma.competition.count({
      where,
    });
  }

  static async countByStatus(status: Prisma.CompetitionWhereInput["status"]) {
    return prisma.competition.count({
      where: {
        status,
        deletedAt: null,
      },
    });
  }

  static async countByVisibility(
    visibility: Prisma.CompetitionWhereInput["visibility"],
  ) {
    return prisma.competition.count({
      where: {
        visibility,
        deletedAt: null,
      },
    });
  }

  /**
   * The admin summary strip's numbers: active, deleted, and their sum.
   *
   * Two queries rather than one `groupBy`, computing `total` in memory —
   * simple, and the admin listing is not a page where an extra count query
   * is a cost worth engineering around.
   */
  static async countByRecordState(): Promise<{
    total: number;
    active: number;
    deleted: number;
  }> {
    const [active, deleted] = await Promise.all([
      prisma.competition.count({ where: { deletedAt: null } }),
      prisma.competition.count({ where: { deletedAt: { not: null } } }),
    ]);

    return { total: active + deleted, active, deleted };
  }

  /**
   * Converts sort options into Prisma orderBy.
   */
  // private static getOrderBy(
  //   sort: FindCompetitionsOptions["sort"],
  // ): Prisma.CompetitionOrderByWithRelationInput {
  //   switch (sort) {
  //     case "deadline":
  //       return {
  //         registrationDeadline: "asc",
  //       };

  //     case "newest":
  //       return {
  //         createdAt: "desc",
  //       };

  //     case "start-date":
  //     default:
  //       return {
  //         startDate: "asc",
  //       };
  //   }
  // }
}

// export const competitionRepository = new CompetitionRepository();
