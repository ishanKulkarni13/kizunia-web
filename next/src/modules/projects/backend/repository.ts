/**
 * Projects Module - Repository
 *
 * Responsible only for database access.
 * Repositories should never contain business rules.
 */

import { Prisma, PrismaClient, Project, ProjectRole } from "@/generated/prisma";
import prisma from "@/lib/prisma";
import type { SearchQuery } from "@/lib/search";
import { ProjectMineQueryDto } from "../search";
import { ProjectNotFoundError } from "./errors";

/**
 * Advisory-lock namespace for owned-project creation (see
 * `lockOwnedProjectQuota`). Any value unique among the application's advisory
 * locks; a new lock picks its own constant.
 */
const OWNED_PROJECT_QUOTA_LOCK_NAMESPACE = 0x0b1d_0001;

/**
 * A fully-built public-discovery query, as produced by `buildSearchQuery`
 * against `projectSearchDefinition` (see `search/definition.ts`). Typed
 * here rather than imported from the search module, so this repository
 * does not need to import the (server-only) definition just to name the
 * shape of what it accepts.
 */
export type ProjectSearchQuery = SearchQuery<
  Prisma.ProjectWhereInput,
  Prisma.ProjectOrderByWithRelationInput
>;

const projectSummarySelect = {
  id: true,

  title: true,

  slug: true,

  shortDescription: true,

  status: true,

  startDate: true,

  endDate: true,

  updatedAt: true,

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

  categories: {
    select: {
      category: {
        select: {
          slug: true,
          name: true,
        },
      },
    },
  },

  technologies: {
    // A soft-deleted Technology behaves as if it does not exist outside the
  // admin surface (docs/architecture/domain/technology.md), so display reads
  // omit it. The relationship row is untouched; the editor's own list
  // (ProjectTechnologyRepository) still returns it, flagged, so it can be removed.
    where: {
      technology: {
        deletedAt: null,
      },
    },
    orderBy: {
      displayOrder: "asc",
    },
    select: {
      technology: {
        select: {
          slug: true,
          name: true,
        },
      },
    },
  },
} satisfies Prisma.ProjectSelect;

const projectDetailsInclude = {
  content: true,

  links: {
    orderBy: {
      order: "asc",
    },
  },

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
  coverAsset: {
    select: {
      id: true,
      secureUrl: true,
      width: true,
      height: true,
      format: true,
      mimeType: true,
    },
  },

  members: {
    orderBy: {
      joinedAt: "asc",
    },

    include: {
      user: {
        include: {
          avatarAsset: {
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
    },
  },

  categories: {
    include: {
      category: true,
    },
  },

  technologies: {
    // A soft-deleted Technology behaves as if it does not exist outside the
  // admin surface (docs/architecture/domain/technology.md), so display reads
  // omit it. The relationship row is untouched; the editor's own list
  // (ProjectTechnologyRepository) still returns it, flagged, so it can be removed.
    where: {
      technology: {
        deletedAt: null,
      },
    },
    orderBy: {
      displayOrder: "asc",
    },
    include: {
      technology: true,
      // role: true,
      // content: true,
    },
  },

  badges: {
    orderBy: {
      issuedAt: "desc",
    },

    include: {
      badge: {
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
    },
  },

  competitions: {
    orderBy: {
      submittedAt: "desc",
    },

    include: {
      competition: true,
    },
  },

  testimonials: {
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    include: {
      imageAsset: {
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

  createdBy: {
    include: {
      avatarAsset: {
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

  updatedBy: {
    include: {
      avatarAsset: {
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
} satisfies Prisma.ProjectInclude;

const projectAuthorizationSelect = {
  id: true,

  status: true,

  visibility: true,

  deletedAt: true,

  createdById: true,

  members: {
    select: {
      userId: true,
      role: true,
    },
  },
} satisfies Prisma.ProjectSelect;

export type ProjectSummaryEntity = Prisma.ProjectGetPayload<{
  select: typeof projectSummarySelect;
}>;

export type ProjectDetailsEntity = Prisma.ProjectGetPayload<{
  include: typeof projectDetailsInclude;
}>;

export type ProjectAuthorizationEntity = Prisma.ProjectGetPayload<{
  select: typeof projectAuthorizationSelect;
}>;

// Fields for the membership-scoped "my projects" listing. Includes the same
// authorization fields as `projectAuthorizationSelect` (`deletedAt`,
// `createdById`, `members`) alongside the summary fields, so a row here can
// be passed directly into `ProjectContextResolver.fromData` /
// `ProjectPermissionResolver.resolve` to compute `canEdit` in memory — no
// second query per row. `members` is narrowed to `{ userId }` for the
// current actor at the call site (see `findManyForMember`), not here, since
// the actor id isn't known until the query runs.
const projectMineSummarySelect = {
  id: true,

  title: true,

  slug: true,

  shortDescription: true,

  visibility: true,

  status: true,

  startDate: true,

  endDate: true,

  updatedAt: true,

  deletedAt: true,

  createdById: true,

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

  members: {
    select: {
      userId: true,
      role: true,
    },
  },
} satisfies Prisma.ProjectSelect;

export type ProjectMineSummaryEntity = Prisma.ProjectGetPayload<{
  select: typeof projectMineSummarySelect;
}>;

type ProjectProfileUpdateData = Pick<
  Prisma.ProjectUpdateInput,
  "title" | "slug" | "shortDescription" | "status" | "visibility" | "updatedBy"
>;
export class ProjectRepository {
  constructor(
    private readonly db: PrismaClient | Prisma.TransactionClient = prisma,
  ) {}

  // =============================================================================
  // Read
  // =============================================================================

  async findById({ id }: { id: string }): Promise<ProjectDetailsEntity | null> {
    return this.db.project.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      include: projectDetailsInclude,
    });
  }

  async findBySlug({
    slug,
  }: {
    slug: string;
  }): Promise<ProjectDetailsEntity | null> {
    return this.db.project.findFirst({
      where: {
        slug,
        deletedAt: null,
      },
      include: projectDetailsInclude,
    });
  }

  async findForAuthorization({
    id,
  }: {
    id: string;
  }): Promise<ProjectAuthorizationEntity | null> {
    return this.db.project.findFirst({
      where: {
        id,
      },
      select: projectAuthorizationSelect,
    });
  }

  /**
   * The public discovery listing. `query` is a fully-built engine query
   * (see `search/definition.ts` + `buildSearchQuery`) rather than raw
   * filter values — its `where` already carries the "public" scope guard
   * (`visibility: PUBLIC`, `status: PUBLISHED`), composed alongside
   * whatever filters the request supplied. This repository never builds a
   * `Project` where-clause by hand; the engine is the only place that does.
   */
  async findMany(
    query: ProjectSearchQuery,
  ): Promise<ProjectSummaryEntity[]> {
    return this.db.project.findMany({
      where: query.where,
      orderBy: query.orderBy,
      skip: query.skip,
      take: query.take,
      select: projectSummarySelect,
    });
  }

  /**
   * The total for the same `where` a `findMany` call used, so the two can
   * never disagree — see `ProjectService.search`, which builds one query
   * object and hands it to both.
   *
   * Named `countMany` rather than `count` because this class already has a
   * no-arg `count()` (every non-deleted project, currently unused by any
   * caller) — a distinct method rather than a rename, since that one is
   * unrelated to this discovery listing and out of scope here.
   */
  async countMany(query: ProjectSearchQuery): Promise<number> {
    return this.db.project.count({
      where: query.where,
    });
  }

  /**
   * Rows the actor is a member of, across every visibility — membership is
   * the scope for this listing, never a caller-supplied filter. `members`
   * is narrowed to just this actor so the mapper can read `myRole` and
   * resolve `canEdit` from this same row, with no follow-up query.
   */
  async findManyForMember({
    userId,
    query,
  }: {
    userId: string;
    query: ProjectMineQueryDto;
  }): Promise<ProjectMineSummaryEntity[]> {
    return this.db.project.findMany({
      where: this.buildMemberWhereClause({
        userId,
        query,
      }),

      orderBy: this.buildOrderByClause({
        query,
      }),

      ...this.buildPagination({
        query,
      }),

      select: {
        ...projectMineSummarySelect,
        members: {
          where: {
            userId,
          },
          select: {
            userId: true,
            role: true,
          },
        },
      },
    });
  }

  async countForMember({
    userId,
    query,
  }: {
    userId: string;
    query: ProjectMineQueryDto;
  }): Promise<number> {
    return this.db.project.count({
      where: this.buildMemberWhereClause({
        userId,
        query,
      }),
    });
  }

  // =============================================================================
  // Owned-project quota
  // =============================================================================

  /**
   * Projects the user owns and has not deleted (IB-12). Only `OWNER`
   * memberships count — being a member of someone else's project never uses
   * quota — and a soft-deleted project keeps its `OWNER` row, so it is
   * excluded here: deleting a project frees a slot. This is the one
   * definition of "owned" for the quota; nothing else counts it.
   *
   * Served by `project_member (userId, role)`.
   */
  async countOwnedByUser({ userId }: { userId: string }): Promise<number> {
    return this.db.projectMember.count({
      where: {
        userId,
        role: ProjectRole.OWNER,
        project: { deletedAt: null },
      },
    });
  }

  /**
   * Serializes owned-project creation per user, for the rest of the current
   * transaction.
   *
   * Pattern — transaction-scoped advisory lock (the repository's first):
   *
   * - Use it when a check-then-write must be atomic but there is no row to
   *   `SELECT … FOR UPDATE`. Here the check is a *count* of rows that may not
   *   exist yet, and no per-user row belongs to the projects module.
   * - `pg_advisory_xact_lock(namespace, key)` blocks until any other
   *   transaction holding the same pair commits or rolls back, and releases
   *   itself at the end of this transaction. It must therefore only be called
   *   on a transaction client, and before the count it protects.
   * - The first argument namespaces the lock, so unrelated features choosing
   *   their own namespace can never contend with this one. The second is
   *   `hashtext(userId)`; a hash collision only makes two users wait for each
   *   other briefly, it never lets a race through.
   *
   * Without it, two concurrent creates at `limit - 1` would both count
   * `limit - 1` and both insert.
   */
  async lockOwnedProjectQuota({ userId }: { userId: string }): Promise<void> {
    await this.db.$executeRaw`
      SELECT pg_advisory_xact_lock(${OWNED_PROJECT_QUOTA_LOCK_NAMESPACE}::int4, hashtext(${userId}))
    `;
  }

  async findMembership({
    projectId,
    userId,
  }: {
    projectId: string;
    userId: string;
  }) {
    return this.db.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId,
        },
      },
      select: {
        role: true,
      },
    });
  }

  async findContent({
    projectId,
  }: {
    projectId: string;
  }): Promise<{ contentId: string | null } | null> {
    return this.db.project.findFirst({
      where: {
        id: projectId,
        deletedAt: null,
      },
      select: {
        contentId: true,
      },
    });
  }

  async exists({ id }: { id: string }): Promise<boolean> {
    const count = await this.db.project.count({
      where: {
        id,
        deletedAt: null,
      },
    });

    return count > 0;
  }

  async existsBySlug({ slug }: { slug: string }): Promise<boolean> {
    const count = await this.db.project.count({
      where: {
        slug,
        deletedAt: null,
      },
    });

    return count > 0;
  }

  async count(): Promise<number> {
    return this.db.project.count({
      where: {
        deletedAt: null,
      },
    });
  }

  // =============================================================================
  // Create
  // =============================================================================

  async create({
    data,
  }: {
    data: Prisma.ProjectCreateInput;
  }): Promise<ProjectDetailsEntity> {
    return this.db.project.create({
      data,
      include: projectDetailsInclude,
    });
  }

  async createContent({
    projectId,
    data,
  }: {
    projectId: string;
    data: Prisma.ContentCreateWithoutProjectInput;
  }): Promise<ProjectDetailsEntity> {
    return this.db.project.update({
      where: {
        id: projectId,
      },
      data: {
        content: {
          create: data,
        },
      },
      include: projectDetailsInclude,
    });
  }

  // =============================================================================
  // Update
  // =============================================================================

  /**
   *
   * @deprecated Use updateProfile or updateContent or similar instead.
   */
  async update({
    id,
    data,
  }: {
    id: string;
    data: Prisma.ProjectUpdateInput;
  }): Promise<ProjectDetailsEntity> {
    return this.db.project.update({
      where: {
        id,
      },
      data,
      include: projectDetailsInclude,
    });
  }

  async updateProfile({
    id,
    data,
  }: {
    id: string;
    data: ProjectProfileUpdateData;
  }): Promise<ProjectDetailsEntity> {
    return this.db.project.update({
      where: {
        id,
      },
      data,
      include: projectDetailsInclude,
    });
  }

  async setAsset({
    id,
    slot,
    assetId,
  }: {
    id: string;
    slot: "logo" | "cover";
    assetId: string | null;
  }): Promise<ProjectDetailsEntity> {
    const relationField = {
      logo: "logoAsset",
      cover: "coverAsset",
    } as const;

    return this.db.project.update({
      where: { id },
      data: {
        [relationField[slot]]:
          assetId === null
            ? { disconnect: true }
            : { connect: { id: assetId } },
      },
      include: projectDetailsInclude,
    });
  }

  async updateContent({
    contentId,
    data,
  }: {
    contentId: string;
    data: Prisma.ContentUpdateInput;
  }) {
    return this.db.content.update({
      where: {
        id: contentId,
      },
      data,
    });
  }

  // =============================================================================
  // Delete
  // =============================================================================

  async softDelete({
    id,
    deletedAt = new Date(),
  }: {
    id: string;
    deletedAt?: Date;
  }): Promise<Project> {
    return this.db.project.update({
      where: {
        id,
      },
      data: {
        deletedAt,
      },
    });
  }

  async existsBySlugExceptProject({
    slug,
    projectId,
  }: {
    slug: string;
    projectId: string;
  }): Promise<boolean> {
    const count = await this.db.project.count({
      where: {
        slug,
        deletedAt: null,
        id: {
          not: projectId,
        },
      },
    });

    return count > 0;
  }

  // =============================================================================
  // Query Builders
  // =============================================================================

  // The public discovery listing's `where`/`orderBy`/pagination are no
  // longer built here — `buildSearchQuery` against `projectSearchDefinition`
  // (see `search/definition.ts`) is now the only place that builds a
  // Project `where` clause for that path, so the guard it applies
  // (`visibility: PUBLIC`, `status: PUBLISHED`) cannot be bypassed by a
  // second, independently-maintained builder. `findMany`/`count` above
  // accept the engine's already-built query directly.

  private buildOrderByClause({
    query,
  }: {
    query: Pick<ProjectMineQueryDto, "sortBy" | "sortOrder">;
  }): Prisma.ProjectOrderByWithRelationInput {
    return {
      [query.sortBy]: query.sortOrder,
    };
  }

  private buildPagination({
    query,
  }: {
    query: Pick<ProjectMineQueryDto, "page" | "pageSize">;
  }) {
    return {
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    };
  }

  /**
   * Scope for the membership-based listing: every non-deleted project the
   * user belongs to, regardless of visibility. `search`/`status` are the
   * only caller-supplied filters — `category`/`technology` aren't part of
   * `ProjectMineQueryDto`, and visibility is never a filter here at all.
   */
  private buildMemberWhereClause({
    userId,
    query,
  }: {
    userId: string;
    query: ProjectMineQueryDto;
  }): Prisma.ProjectWhereInput {
    return {
      deletedAt: null,

      members: {
        some: {
          userId,
        },
      },

      ...(query.search && {
        OR: [
          {
            title: {
              contains: query.search,
              mode: "insensitive",
            },
          },
          {
            shortDescription: {
              contains: query.search,
              mode: "insensitive",
            },
          },
        ],
      }),

      ...(query.status && {
        status: query.status,
      }),
    };
  }
}
