/**
 * Portfolio Module - Repository
 *
 * Responsible only for database access.
 * Repositories should never contain business rules.
 */

import { PortfolioVisibility, Prisma, PrismaClient } from "@/generated/prisma";
import prisma from "@/lib/prisma";
import { publiclyListableProjectWhere } from "@/modules/projects/backend/visibility";
import { PortfolioAlreadyExistsError, PortfolioNotFoundError } from "../errors";
import { portfolioAssetSelect } from "./asset-select";

const portfolioAuthorizationSelect = {
  id: true,

  userId: true,

  visibility: true,

  deletedAt: true,

  // The owner's ban state is an authorization input, not presentation data:
  // a banned owner's portfolio must not be publicly reachable (mirrors the
  // `user.banned` filter `findPublicByUsername` already applies). Selected
  // ONLY here — never in `portfolioEditorSelect`/`portfolioPublicDetailsInclude`
  // — so it can never reach a response even by accident. Owner-context
  // callers (findMine/updateProfile, where the actor IS the owner) derive the
  // owner's ban state from `actor.banned` instead of this select — see
  // PortfolioContextResolver.fromData.
  user: {
    select: {
      banned: true,
    },
  },
} satisfies Prisma.PortfolioSelect;

/**
 * The authorization shape plus the one column the profile update needs to
 * drive the resume attach/detach sequence. Deliberately not the full
 * aggregate: authorizing an edit must not read the portfolio's content.
 */
const portfolioProfileUpdateSelect = {
  ...portfolioAuthorizationSelect,

  resumeAssetId: true,
} satisfies Prisma.PortfolioSelect;

/**
 * Exactly what the Portfolio editor reads: the profile scalars, the owner's
 * username and the resume asset. Everything else the editor shows comes from
 * a dedicated section endpoint (projects, testimonials, technologies), so the
 * aggregate must not become a second way to fetch it — adding a section here
 * would widen the wire contract and skip that section's own visibility rules.
 *
 * `userId`/`deletedAt`/`visibility` are selected because the service builds
 * the authorization context from this row; `PortfolioMapper.toEditorDto`
 * picks the response fields explicitly, so they never leave the service.
 */
const portfolioEditorSelect = {
  id: true,

  userId: true,

  displayName: true,

  headline: true,

  bio: true,

  phone: true,

  publicContactEmail: true,

  location: true,

  visibility: true,

  deletedAt: true,

  user: {
    select: {
      username: true,
    },
  },

  resumeAsset: {
    select: portfolioAssetSelect,
  },
} satisfies Prisma.PortfolioSelect;

const portfolioPublicDetailsInclude = {
  user: {
    select: {
      id: true,

      username: true,

      avatarAsset: {
        select: portfolioAssetSelect,
      },

      coverAsset: {
        select: portfolioAssetSelect,
      },
    },
  },

  settings: true,

  resumeAsset: {
    select: portfolioAssetSelect,
  },

  links: {
    orderBy: {
      order: "asc",
    },
  },

  technologies: {
    // A soft-deleted Technology behaves as if it does not exist outside the
    // admin surface (docs/architecture/domain/technology.md), so it is not
    // rendered publicly. The relationship row is untouched — restoring the
    // Technology makes it appear again, and the owner's editor still lists it.
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
    },
  },

  education: {
    orderBy: {
      displayOrder: "asc",
    },

    include: {
      institutionLogoAsset: true,
    },
  },

  experience: {
    orderBy: {
      displayOrder: "asc",
    },

    include: {
      companyLogoAsset: true,
    },
  },

  achievements: {
    orderBy: {
      displayOrder: "asc",
    },

    include: {
      asset: true,
    },
  },

  certifications: {
    orderBy: {
      displayOrder: "asc",
    },

    include: {
      asset: true,
    },
  },

  testimonials: {
    orderBy: {
      displayOrder: "asc",
    },

    include: {
      imageAsset: true,
    },
  },

  projects: {
    // Baseline public gate. `publiclyListableProjectWhere` is the Projects
    // module's own definition of the rule — consumed, never re-typed here, so
    // the portfolio cannot drift from it.
    //
    // `hidden` is deprecated (see schema.prisma); this filter is retained
    // solely to preserve pre-existing behaviour and carries no new meaning.
    //
    // The public *rendering* path layers a membership filter on top of this
    // — see `buildPortfolioPublicDetailsInclude`.
    where: {
      hidden: false,

      project: publiclyListableProjectWhere,
    },

    orderBy: [
      {
        displayOrder: "asc",
      },
      {
        createdAt: "asc",
      },
    ],

    include: {
      project: {
        include: {
          logoAsset: true,

          coverAsset: true,

          links: {
            orderBy: {
              order: "asc",
            },
          },

          // Same rule as the top-level `technologies` above: retired
          // catalog entries are not rendered publicly.
          technologies: {
            where: {
              technology: {
                deletedAt: null,
              },
            },

            include: {
              technology: true,
            },
          },

          categories: {
            include: {
              category: true,
            },
          },

          badges: {
            include: {
              badge: true,
            },
          },

          competitions: {
            include: {
              competition: {
                select: {
                  id: true,

                  title: true,

                  slug: true,

                  startDate: true,

                  endDate: true,

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
                },
              },
            },
          },

          testimonials: {
            include: {
              imageAsset: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.PortfolioInclude;

/**
 * The public include, narrowed to projects the portfolio's owner is still a
 * member of.
 *
 * A relationship survives its membership in the database, so membership must
 * be re-checked on read: being listed on a portfolio must never keep showing
 * a project after its owner has left the team. Filtering here rather than in
 * the mapper keeps the rule authoritative — ineligible rows never leave the
 * database.
 *
 * `ownerUserId` must come from the resolved portfolio row, never from a
 * request. Only `where` differs from the base include, so the payload type is
 * unchanged.
 */
function buildPortfolioPublicDetailsInclude({
  ownerUserId,
}: {
  ownerUserId: string;
}): Prisma.PortfolioInclude {
  return {
    ...portfolioPublicDetailsInclude,

    projects: {
      ...portfolioPublicDetailsInclude.projects,

      where: {
        hidden: false,

        project: {
          ...publiclyListableProjectWhere,

          members: {
            some: {
              userId: ownerUserId,
            },
          },
        },
      },
    },
  };
}

export type PortfolioPublicDetailsEntity = Prisma.PortfolioGetPayload<{
  include: typeof portfolioPublicDetailsInclude;
}>;

export type PortfolioEditorEntity = Prisma.PortfolioGetPayload<{
  select: typeof portfolioEditorSelect;
}>;

export type PortfolioAuthorizationEntity = Prisma.PortfolioGetPayload<{
  select: typeof portfolioAuthorizationSelect;
}>;

export type PortfolioProfileUpdateEntity = Prisma.PortfolioGetPayload<{
  select: typeof portfolioProfileUpdateSelect;
}>;

export interface PortfolioProfileUpdateData {
  displayName?: string;
  headline?: string | null;
  bio?: string | null;
  phone?: string | null;
  publicContactEmail?: string | null;
  location?: string | null;
  resumeAssetId?: string | null;
}
/**
 * Portfolio Module - Repository
 *
 * Responsible only for database access.
 * Repositories should never contain business rules.
 */

export class PortfolioRepository {
  constructor(
    private readonly db: Prisma.TransactionClient | PrismaClient = prisma,
  ) {}

  // ===========================================================================
  // Read
  // ===========================================================================

  async findPublicByUsername({
    username,
  }: {
    username: string;
  }): Promise<PortfolioPublicDetailsEntity | null> {
    // Resolved in two steps because the projects filter needs the owner's id
    // to check that they are still a member of each project, and a nested
    // filter cannot refer back to the parent row. The first query is a cheap
    // indexed lookup.
    const owner = await this.db.portfolio.findFirst({
      where: {
        deletedAt: null,

        visibility: PortfolioVisibility.PUBLIC,

        user: {
          username,

          // Banned users must not have a publicly visible portfolio, even
          // if the portfolio row itself is PUBLIC and not deleted.
          banned: {
            not: true,
          },
        },
      },

      select: {
        id: true,

        userId: true,
      },
    });

    if (!owner) {
      return null;
    }

    return this.db.portfolio.findUnique({
      where: {
        id: owner.id,
      },

      include: buildPortfolioPublicDetailsInclude({
        ownerUserId: owner.userId,
      }),
    }) as Promise<PortfolioPublicDetailsEntity | null>;
  }

  async findPublicByUsernameOrThrow({
    username,
  }: {
    username: string;
  }): Promise<PortfolioPublicDetailsEntity> {
    const portfolio = await this.findPublicByUsername({
      username,
    });

    if (!portfolio) {
      throw new PortfolioNotFoundError();
    }

    return portfolio;
  }

  async findById({
    id,
  }: {
    id: string;
  }): Promise<PortfolioPublicDetailsEntity | null> {
    return this.db.portfolio.findUnique({
      where: {
        id,
      },

      include: portfolioPublicDetailsInclude,
    });
  }

  async findByUserId({
    userId,
  }: {
    userId: string;
  }): Promise<PortfolioPublicDetailsEntity | null> {
    return this.db.portfolio.findUnique({
      where: {
        userId,
      },

      include: portfolioPublicDetailsInclude,
    });
  }

  async findEditorByUserId({
    userId,
  }: {
    userId: string;
  }): Promise<PortfolioEditorEntity | null> {
    return this.db.portfolio.findUnique({
      where: {
        userId,
      },

      select: portfolioEditorSelect,
    });
  }

  async findByIdOrThrow({
    id,
  }: {
    id: string;
  }): Promise<PortfolioPublicDetailsEntity> {
    const portfolio = await this.findById({
      id,
    });

    if (!portfolio) {
      throw new PortfolioNotFoundError();
    }

    return portfolio;
  }

  async findForAuthorization({
    id,
  }: {
    id: string;
  }): Promise<PortfolioAuthorizationEntity | null> {
    return this.db.portfolio.findUnique({
      where: {
        id,
      },

      select: portfolioAuthorizationSelect,
    });
  }

  /**
   * The acting user's own portfolio, in the minimal shape an authorization
   * decision needs.
   *
   * Keyed by `userId` rather than `id` so callers never accept a portfolio id
   * from a client: the row is reached only through the verified session.
   */
  async findForAuthorizationByUserId({
    userId,
  }: {
    userId: string;
  }): Promise<PortfolioAuthorizationEntity | null> {
    return this.db.portfolio.findUnique({
      where: {
        userId,
      },

      select: portfolioAuthorizationSelect,
    });
  }

  async findForAuthorizationByUserIdOrThrow({
    userId,
  }: {
    userId: string;
  }): Promise<PortfolioAuthorizationEntity> {
    const portfolio = await this.findForAuthorizationByUserId({ userId });

    if (!portfolio) {
      throw new PortfolioNotFoundError();
    }

    return portfolio;
  }

  /**
   * The acting user's own portfolio in the shape a profile update needs: the
   * authorization inputs plus `resumeAssetId` (the previous resume, which the
   * attach/detach sequence must know). Not the aggregate — an update must not
   * read the portfolio's content just to authorize itself.
   */
  async findForProfileUpdateByUserIdOrThrow({
    userId,
  }: {
    userId: string;
  }): Promise<PortfolioProfileUpdateEntity> {
    const portfolio = await this.db.portfolio.findUnique({
      where: {
        userId,
      },

      select: portfolioProfileUpdateSelect,
    });

    if (!portfolio) {
      throw new PortfolioNotFoundError();
    }

    return portfolio;
  }

  /**
   * The portfolio behind a username, in the minimal shape an authorization
   * decision needs — deliberately WITHOUT the public visibility/ban/deleted
   * filters that `findPublicByUsername` applies.
   *
   * `PortfolioPolicy` must see the real row to make (and name) the
   * decision; `findPublicByUsername`'s SQL filter stays in place on the
   * data-fetch path as defence-in-depth and as a data-scoping optimisation,
   * the same way `publiclyListableProjectWhere` does for Projects — it is
   * not itself the authorization decision.
   */
  async findForAuthorizationByUsername({
    username,
  }: {
    username: string;
  }): Promise<PortfolioAuthorizationEntity | null> {
    return this.db.portfolio.findFirst({
      where: {
        user: {
          username,
        },
      },

      select: portfolioAuthorizationSelect,
    });
  }

  async exists({ id }: { id: string }): Promise<boolean> {
    const portfolio = await this.db.portfolio.findUnique({
      where: {
        id,
      },

      select: {
        id: true,
      },
    });

    return portfolio !== null;
  }

  async count(): Promise<number> {
    return this.db.portfolio.count({
      where: {
        deletedAt: null,
      },
    });
  }

  // ===========================================================================
  // Create
  // ===========================================================================

  async create({
    data,
  }: {
    data: Prisma.PortfolioCreateInput;
  }): Promise<PortfolioEditorEntity> {
    try {
      return await this.db.portfolio.create({
        data,

        select: portfolioEditorSelect,
      });
    } catch (error) {
      // Backstop for the concurrent-creation race: two requests can both
      // pass the service's existence pre-check before either has written a
      // row. Only the violation of the one-Portfolio-per-user constraint is
      // translated — every other Prisma error propagates untouched.
      //
      // `data.user` is always a `connect` (the service never `create`s the
      // User here), so with `Portfolio.userId @unique` the second concurrent
      // insert can surface as either of two Prisma codes depending on
      // whether the query engine's own one-to-one relation check or the
      // database's unique index catches it first:
      //   - P2002: the DB unique constraint on `userId` was violated.
      //   - P2014: the query engine rejected the `user` connect because
      //     that User already has a Portfolio (a required 1:1 relation
      //     violation) — confirmed to be what Prisma actually raises here
      //     against this schema/engine, so it must be handled, not just
      //     the more "obvious" P2002.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        Array.isArray(error.meta?.target) &&
        (error.meta.target as string[]).includes("userId")
      ) {
        throw new PortfolioAlreadyExistsError();
      }

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2014" &&
        error.meta?.modelName === "Portfolio"
      ) {
        throw new PortfolioAlreadyExistsError();
      }

      throw error;
    }
  }

  async findUserForCreation({
    userId,
  }: {
    userId: string;
  }): Promise<{ name: string; username: string | null } | null> {
    return this.db.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        name: true,
        username: true,
      },
    });
  }

  // ===========================================================================
  // Update
  // ===========================================================================

  async updateProfile({
    id,
    data,
  }: {
    id: string;
    data: PortfolioProfileUpdateData;
  }): Promise<PortfolioEditorEntity> {
    return this.db.portfolio.update({
      where: {
        id,
      },

      data: {
        displayName: data.displayName,
        headline: data.headline,
        bio: data.bio,
        phone: data.phone,
        publicContactEmail: data.publicContactEmail,
        location: data.location,

        ...(data.resumeAssetId !== undefined && {
          resumeAsset:
            data.resumeAssetId === null
              ? {
                  disconnect: true,
                }
              : {
                  connect: {
                    id: data.resumeAssetId,
                  },
                },
        }),
      },

      select: portfolioEditorSelect,
    });
  }

  async updateVisibility({
    id,
    visibility,
  }: {
    id: string;
    visibility: PortfolioVisibility;
  }): Promise<PortfolioEditorEntity> {
    return this.db.portfolio.update({
      where: {
        id,
      },

      data: {
        visibility,
      },

      select: portfolioEditorSelect,
    });
  }

  /**
   * Brings a soft-deleted portfolio back, unpublished.
   *
   * Always PRIVATE, whatever it was before deletion: restoring must never
   * re-expose contact details on its own — the owner re-publishes
   * deliberately. Every child row and asset reference was left untouched by
   * `softDelete`, so nothing needs rebuilding.
   */
  async restore({ id }: { id: string }): Promise<PortfolioEditorEntity> {
    return this.db.portfolio.update({
      where: {
        id,
      },

      data: {
        deletedAt: null,

        visibility: PortfolioVisibility.PRIVATE,
      },

      select: portfolioEditorSelect,
    });
  }

  async update({
    id,
    data,
  }: {
    id: string;
    data: Prisma.PortfolioUpdateInput;
  }): Promise<PortfolioPublicDetailsEntity> {
    return this.db.portfolio.update({
      where: {
        id,
      },

      data,

      include: portfolioPublicDetailsInclude,
    });
  }

  // ===========================================================================
  // Delete
  // ===========================================================================

  /**
   * Soft delete only. The row, its child rows and every Asset reference it
   * holds stay exactly as they are (there is no retention or purge system),
   * so `restore` is lossless and the reconciliation sweep — which detaches
   * only *unreferenced* assets — never touches them.
   */
  async softDelete({ id }: { id: string }): Promise<void> {
    await this.db.portfolio.update({
      where: {
        id,
      },

      data: {
        deletedAt: new Date(),
      },
    });
  }
}
