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

const portfolioSummarySelect = {
  id: true,

  displayName: true,

  headline: true,

  location: true,

  visibility: true,

  user: {
    select: {
      username: true,

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
} satisfies Prisma.PortfolioSelect;

const portfolioAuthorizationSelect = {
  id: true,

  userId: true,

  visibility: true,

  deletedAt: true,
} satisfies Prisma.PortfolioSelect;

const portfolioPublicDetailsInclude = {
  user: {
    select: {
      id: true,

      username: true,

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
    },
  },

  settings: true,

  resumeAsset: {
    select: {
      id: true,
      secureUrl: true,
      width: true,
      height: true,
      format: true,
      mimeType: true,
    },
  },

  links: {
    orderBy: {
      order: "asc",
    },
  },

  technologies: {
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

          technologies: {
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

const portfolioEditorInclude = {
  user: {
    select: {
      id: true,

      username: true,

      name: true,

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
    },
  },

  settings: true,

  resumeAsset: {
    select: {
      id: true,
      secureUrl: true,
      width: true,
      height: true,
      format: true,
      mimeType: true,
    },
  },

  links: {
    orderBy: {
      order: "asc",
    },
  },

  technologies: {
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
    where: {
      project: {
        deletedAt: null,
      },
    },

    orderBy: {
      displayOrder: "asc",
    },

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

          technologies: {
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

export type PortfolioSummaryEntity = Prisma.PortfolioGetPayload<{
  select: typeof portfolioSummarySelect;
}>;

export type PortfolioPublicDetailsEntity = Prisma.PortfolioGetPayload<{
  include: typeof portfolioPublicDetailsInclude;
}>;

export type PortfolioEditorEntity = Prisma.PortfolioGetPayload<{
  include: typeof portfolioEditorInclude;
}>;

export type PortfolioAuthorizationEntity = Prisma.PortfolioGetPayload<{
  select: typeof portfolioAuthorizationSelect;
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

      include: portfolioEditorInclude,
    });
  }

  async findByUserIdOrThrow({
    userId,
  }: {
    userId: string;
  }): Promise<PortfolioPublicDetailsEntity> {
    const portfolio = await this.findByUserId({
      userId,
    });

    if (!portfolio) {
      throw new PortfolioNotFoundError();
    }

    return portfolio;
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

  async findEditorByUserIdOrThrow({
    userId,
  }: {
    userId: string;
  }): Promise<PortfolioEditorEntity> {
    const portfolio = await this.findEditorByUserId({
      userId,
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

  async existsByUserId({ userId }: { userId: string }): Promise<boolean> {
    const portfolio = await this.db.portfolio.findUnique({
      where: {
        userId,
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

        include: portfolioEditorInclude,
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

    include: portfolioEditorInclude,
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
