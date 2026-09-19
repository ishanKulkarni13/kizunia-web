import prisma from "@/lib/prisma";

import type { Prisma, PrismaClient, SuggestionStatus } from "@/generated/prisma";


import { NotFoundError } from "@/lib/errors";
import { CreateCompetitionSuggestionInput } from "../../schemas/create-competition-suggestion";
import { UpdateCompetitionSuggestionInput } from "../../schemas/update-competition-suggestion";

/** Full detail include, shared by every method that returns a complete
 * suggestion. */
const SUGGESTION_INCLUDE = {
  suggestionContent: true,

  competition: true,

  submittedBy: true,

  reviewedBy: true,

  links: true,

  assets: {
    include: {
      asset: true,
    },
    orderBy: {
      order: "asc" as const,
    },
  },
} satisfies Prisma.CompetitionSuggestionInclude;

/** Lighter include for admin queue rows — the table never renders the
 * content body, links, or full asset records, only a count. */
const SUGGESTION_LIST_INCLUDE = {
  submittedBy: true,

  _count: {
    select: {
      assets: true,
    },
  },
} satisfies Prisma.CompetitionSuggestionInclude;

export class CompetitionSuggestionRepository {
  // ===========================================================================
  // Read
  // ===========================================================================

  static async findById(
    id: string,
    db: PrismaClient | Prisma.TransactionClient = prisma,
  ) {
    return db.competitionSuggestion.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      include: {
        suggestionContent: true,

        competition: true,

        submittedBy: true,

        reviewedBy: true,

        links: true,

        assets: {
          include: {
            asset: true,
          },
          orderBy: {
            order: "asc",
          },
        },
      },
    });
  }

  static async findByIdOrThrow(
    id: string,
    db: PrismaClient | Prisma.TransactionClient = prisma,
  ) {
    const suggestion = await this.findById(id, db);

    if (!suggestion) {
      throw new NotFoundError({
        code: "competition_suggestion_not_found",
        message: "Competition suggestion not found.",
      });
    }

    return suggestion;
  }

  static async findManyBySubmitter(submittedById: string) {
    return prisma.competitionSuggestion.findMany({
      where: {
        submittedById,
        deletedAt: null,
      },

      include: {
        suggestionContent: true,

        competition: true,

        submittedBy: true,

        reviewedBy: true,

        links: true,

        assets: {
          include: {
            asset: true,
          },
          orderBy: {
            order: "asc",
          },
        },
      },

      orderBy: {
        createdAt: "desc",
      },
    });
  }

  // ===========================================================================
  // Create
  // ===========================================================================

  static async create({
    data,
    submittedById,
  }: {
    data: CreateCompetitionSuggestionInput;
    submittedById: string;
  }) {
    return prisma.competitionSuggestion.create({
      data: {
        suggestionTitle: data.suggestionTitle,

        submittedBy: {
          connect: {
            id: submittedById,
          },
        },

        ...(data.suggestionContent !== undefined && {
          suggestionContent: {
            create: {
              content: data.suggestionContent,
            },
          },
        }),
      },

      include: {
        suggestionContent: true,

        assets: {
          include: {
            asset: true,
          },
          orderBy: {
            order: "asc",
          },
        },
      },
    });
  }

  // ===========================================================================
  // Update
  // ===========================================================================

  static async update({
    id,
    data,
  }: {
    id: string;
    data: UpdateCompetitionSuggestionInput;
  }) {
    return prisma.$transaction(async (tx) => {
      const suggestion = await tx.competitionSuggestion.findFirst({
        where: {
          id,
          deletedAt: null,
        },

        select: {
          suggestionContentId: true,
        },
      });

      if (!suggestion) {
        throw new NotFoundError({
          code: "competition_suggestion_not_found",
          message: "Competition suggestion not found.",
        });
      }

      const updateData: Prisma.CompetitionSuggestionUpdateInput = {};

      if (data.suggestionTitle !== undefined) {
        updateData.suggestionTitle = data.suggestionTitle;
      }

      // -----------------------------------------------------------------------
      // Existing Content
      // -----------------------------------------------------------------------

      if (
        data.suggestionContent !== undefined &&
        suggestion.suggestionContentId
      ) {
        await tx.content.update({
          where: {
            id: suggestion.suggestionContentId,
          },

          data: {
            content: data.suggestionContent,

            version: {
              increment: 1,
            },
          },
        });
      }

      // -----------------------------------------------------------------------
      // Create Content
      // -----------------------------------------------------------------------

      if (
        data.suggestionContent !== undefined &&
        !suggestion.suggestionContentId
      ) {
        const content = await tx.content.create({
          data: {
            content: data.suggestionContent,
          },
        });

        updateData.suggestionContent = {
          connect: {
            id: content.id,
          },
        };
      }

      return tx.competitionSuggestion.update({
        where: {
          id,
        },

        data: updateData,

        include: {
          suggestionContent: true,

          competition: true,

          submittedBy: true,

          reviewedBy: true,

          links: true,

          assets: {
            include: {
              asset: true,
            },

            orderBy: {
              order: "asc",
            },
          },
        },
      });
    });
  }

  // ===========================================================================
  // Assets
  // ===========================================================================

  /** Attaches an already-finalized Asset. Duplicate attachment is prevented
   * by the `@@id([suggestionId, assetId])` composite key, not application
   * code. */
  static async addAsset(
    tx: Prisma.TransactionClient,
    suggestionId: string,
    assetId: string,
  ) {
    return tx.competitionSuggestionAsset.create({
      data: {
        suggestionId,
        assetId,
      },
    });
  }

  /** Removes the join row only — the underlying Asset is detached, not
   * deleted, by the caller (see CompetitionSuggestionAssetService). */
  static async removeAsset(
    tx: Prisma.TransactionClient,
    suggestionId: string,
    assetId: string,
  ) {
    return tx.competitionSuggestionAsset.delete({
      where: {
        suggestionId_assetId: {
          suggestionId,
          assetId,
        },
      },
    });
  }

  // ===========================================================================
  // Workflow Persistence
  // ===========================================================================

  /**
   * Persists the transition to UNDER_REVIEW.
   *
   * The service decides whether submittedAt should be populated. Any
   * moderation feedback from a prior CHANGES_REQUESTED round is cleared
   * here — once resubmitted, that feedback is no longer current, and this
   * codebase deliberately keeps only the latest moderation decision rather
   * than a review-history log.
   */
  static async markUnderReview({
    id,
    submittedAt,
  }: {
    id: string;
    submittedAt: Date | null;
  }) {
    return prisma.competitionSuggestion.update({
      where: {
        id,
      },

      data: {
        status: "UNDER_REVIEW",

        reviewNotes: null,
        rejectionReason: null,

        ...(submittedAt !== null && {
          submittedAt,
        }),
      },

      include: {
        suggestionContent: true,

        competition: true,

        submittedBy: true,

        reviewedBy: true,

        links: true,

        assets: {
          include: {
            asset: true,
          },

          orderBy: {
            order: "asc",
          },
        },
      },
    });
  }

  /**
   * Persists the CHANGES_REQUESTED -> DRAFT transition. Feedback fields are
   * intentionally left untouched — the contributor needs to keep seeing the
   * admin's note while editing; it's cleared once they resubmit (see
   * `markUnderReview`).
   */
  static async markDraft(id: string) {
    return prisma.competitionSuggestion.update({
      where: {
        id,
      },

      data: {
        status: "DRAFT",
      },

      include: SUGGESTION_INCLUDE,
    });
  }

  // ===========================================================================
  // Soft Delete
  // ===========================================================================

  static async softDelete(id: string) {
    return prisma.competitionSuggestion.update({
      where: {
        id,
      },

      data: {
        deletedAt: new Date(),
      },
    });
  }

  // ===========================================================================
  // Admin Review Queue
  // ===========================================================================

  static async findManyForReview({
    where,
    orderBy,
    skip,
    take,
  }: {
    where: Prisma.CompetitionSuggestionWhereInput;
    orderBy: Prisma.CompetitionSuggestionOrderByWithRelationInput[];
    skip: number;
    take: number;
  }) {
    return prisma.competitionSuggestion.findMany({
      where,
      orderBy,
      skip,
      take,
      include: SUGGESTION_LIST_INCLUDE,
    });
  }

  static async countForReview(
    where: Prisma.CompetitionSuggestionWhereInput,
  ) {
    return prisma.competitionSuggestion.count({ where });
  }

  /**
   * Persists a single moderation decision (approve / reject / request
   * changes). One method for all three — they differ only in which values
   * are passed, never in shape. Both feedback fields are always written
   * together so a decision never leaves a stale note from a previous round
   * behind (e.g. an old change-request note surviving into an APPROVED
   * suggestion).
   */
  static async applyReviewDecision({
    id,
    status,
    reviewedById,
    reviewedAt,
    reviewNotes,
    rejectionReason,
  }: {
    id: string;
    status: SuggestionStatus;
    reviewedById: string;
    reviewedAt: Date;
    reviewNotes: string | null;
    rejectionReason: string | null;
  }) {
    return prisma.competitionSuggestion.update({
      where: {
        id,
      },

      data: {
        status,
        reviewedById,
        reviewedAt,
        reviewNotes,
        rejectionReason,
      },

      include: SUGGESTION_INCLUDE,
    });
  }
}

export const competitionSuggestionRepository =
  CompetitionSuggestionRepository;