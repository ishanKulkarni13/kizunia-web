import type { StrictAuthorizationActor } from "@/authorization";
import { PlatformAction } from "@/authorization/platform/actions";
import { PlatformAuthorizer } from "@/authorization/platform/authorizer";
import type { Prisma, SuggestionStatus } from "@/generated/prisma";
import { parsePagination, buildPaginationMeta, toSkipTake } from "@/lib/search/pagination";
import type { RawSearchParams } from "@/lib/search/types";

import { CompetitionSuggestionAuthorizer } from "./authorization/authorizer";
import { CompetitionSuggestionPolicy } from "./authorization/policy";
import { CompetitionSuggestionAction } from "./authorization/actions";
import type { CompetitionSuggestionAdminTableDTO } from "./authorization/dto/suggestion-admin-table.dto";
import {
  suggestionReviewBlockedReason,
  type CompetitionSuggestionAdminDetailDTO,
} from "./authorization/dto/suggestion-admin-detail.dto";

import { withAssetDownloadUrls, withAssetDownloadUrlsMany } from "./asset-view";
import { competitionSuggestionRepository } from "./repository";
import { CreateCompetitionSuggestionInput } from "../../schemas/create-competition-suggestion";
import { UpdateCompetitionSuggestionInput } from "../../schemas/update-competition-suggestion";
import {
  CompetitionSuggestionAdminQuerySchema,
} from "../../search/suggestion-admin-query";
import { CompetitionSuggestionContextResolver } from "./authorization/resolver";
import type { CompetitionSuggestionContext } from "./authorization/context";
import { PlatformContextResolver } from "@/authorization/platform/resolver";
import type { CompetitionSuggestionAssetDTO } from "../../types/suggestion";

export class CompetitionSuggestionService {
  // ===========================================================================
  // Create
  // ===========================================================================

  static async create({
    actor,
    dto,
  }: {
    actor: StrictAuthorizationActor;
    dto: CreateCompetitionSuggestionInput;
  }) {
    const context = await PlatformContextResolver.resolve(actor);

    CompetitionSuggestionAuthorizer.create(context);

    return withAssetDownloadUrls(
      await competitionSuggestionRepository.create({
        data: dto,
        submittedById: actor.id,
      }),
    );
  }

  // ===========================================================================
  // Read
  // ===========================================================================

  static async findById({
    actor,
    id,
  }: {
    actor: StrictAuthorizationActor;
    id: string;
  }) {
    const context = await CompetitionSuggestionContextResolver.resolve({
      actor,
      suggestionId: id,
    });

    CompetitionSuggestionAuthorizer.read(context);

    return withAssetDownloadUrls(context.suggestion);
  }

  // ===========================================================================
  // Read Mine
  // ===========================================================================

  static async findMine({ actor }: { actor: StrictAuthorizationActor }) {
    const context = await PlatformContextResolver.resolve(actor);

    CompetitionSuggestionAuthorizer.create(context); // TODO: This is a bit of a hack, but it works for now. We should probably have a separate authorizer for this.

    return withAssetDownloadUrlsMany(
      await competitionSuggestionRepository.findManyBySubmitter(actor.id),
    );
  }

  // ===========================================================================
  // Update
  // ===========================================================================

  static async update({
    actor,
    id,
    dto,
  }: {
    actor: StrictAuthorizationActor;
    id: string;
    dto: UpdateCompetitionSuggestionInput;
  }) {
    const context = await CompetitionSuggestionContextResolver.resolve({
      actor,
      suggestionId: id,
    });

    CompetitionSuggestionAuthorizer.edit(context);

    return withAssetDownloadUrls(
      await competitionSuggestionRepository.update({
        id,
        data: dto,
      }),
    );
  }

  // ===========================================================================
  // Submit
  // ===========================================================================

  static async submit({
    actor,
    id,
  }: {
    actor: StrictAuthorizationActor;
    id: string;
  }) {
    const context = await CompetitionSuggestionContextResolver.resolve({
      actor,
      suggestionId: id,
    });

    CompetitionSuggestionAuthorizer.submit(context);

    // Always refreshed, including on a CHANGES_REQUESTED -> DRAFT ->
    // resubmission round trip: preserving the original submission time would
    // make a resubmitted suggestion sort to the bottom of an admin queue
    // ordered by submittedAt, effectively hiding it forever.
    return withAssetDownloadUrls(
      await competitionSuggestionRepository.markUnderReview({
        id,
        submittedAt: new Date(),
      }),
    );
  }

  // ===========================================================================
  // Reopen (CHANGES_REQUESTED -> DRAFT)
  // ===========================================================================

  static async reopen({
    actor,
    id,
  }: {
    actor: StrictAuthorizationActor;
    id: string;
  }) {
    const context = await CompetitionSuggestionContextResolver.resolve({
      actor,
      suggestionId: id,
    });

    CompetitionSuggestionAuthorizer.reopen(context);

    return withAssetDownloadUrls(
      await competitionSuggestionRepository.markDraft(id),
    );
  }

  // ===========================================================================
  // Delete
  // ===========================================================================

  static async delete({
    actor,
    id,
  }: {
    actor: StrictAuthorizationActor;
    id: string;
  }) {
    const context = await CompetitionSuggestionContextResolver.resolve({
      actor,
      suggestionId: id,
    });

    CompetitionSuggestionAuthorizer.delete(context);

    await competitionSuggestionRepository.softDelete(id);
  }

  // ===========================================================================
  // Admin: Review Queue
  // ===========================================================================

  static async searchForReview({
    actor,
    params,
  }: {
    actor: StrictAuthorizationActor;
    params: RawSearchParams;
  }) {
    const platformContext = await PlatformContextResolver.resolve(actor);

    PlatformAuthorizer.can(
      platformContext,
      PlatformAction.VIEW_COMPETITION_SUGGESTIONS,
    );

    const query = CompetitionSuggestionAdminQuerySchema.parse(params);

    const where: Prisma.CompetitionSuggestionWhereInput = {
      deletedAt: null,
      ...(query.status !== "ALL" && {
        status: query.status as SuggestionStatus,
      }),
      ...(query.search && {
        suggestionTitle: {
          contains: query.search,
          mode: "insensitive",
        },
      }),
    };

    const pagination = parsePagination(params);
    const { skip, take } = toSkipTake(pagination);

    // Drafts and un-reviewed rows have null `submittedAt`/`reviewedAt`, so
    // an explicit `nulls: "last"` plus a `createdAt` tiebreaker keeps sort
    // order predictable and pagination stable across pages.
    const primarySort: Prisma.CompetitionSuggestionOrderByWithRelationInput =
      query.sortBy === "submittedAt"
        ? { submittedAt: { sort: query.sortOrder, nulls: "last" } }
        : query.sortBy === "reviewedAt"
          ? { reviewedAt: { sort: query.sortOrder, nulls: "last" } }
          : { createdAt: query.sortOrder };

    const [rows, total] = await Promise.all([
      competitionSuggestionRepository.findManyForReview({
        where,
        orderBy: [primarySort, { createdAt: "desc" }],
        skip,
        take,
      }),
      competitionSuggestionRepository.countForReview(where),
    ]);

    const items: CompetitionSuggestionAdminTableDTO[] = rows.map((row) => {
      const reviewContext = CompetitionSuggestionContextResolver.fromData({
        actor,
        // The list include omits fields the full detail context type
        // expects (suggestionContent, competition, links, full assets).
        // `REVIEW`'s predicates only ever read `status`/`deletedAt`, so this
        // is safe without widening the light include just to satisfy the
        // type.
        suggestion: row as unknown as CompetitionSuggestionContext["suggestion"],
      });

      return {
        id: row.id,
        suggestionTitle: row.suggestionTitle,
        status: row.status,
        submittedAt: row.submittedAt,
        createdAt: row.createdAt,
        reviewedAt: row.reviewedAt,
        submitter: {
          id: row.submittedBy.id,
          name: row.submittedBy.name,
          email: row.submittedBy.email,
        },
        assetCount: row._count.assets,
        canReview: CompetitionSuggestionPolicy.can(
          reviewContext,
          CompetitionSuggestionAction.REVIEW,
        ).allowed,
      };
    });

    return {
      items,
      pagination: buildPaginationMeta(pagination, total),
      query,
    };
  }

  static async findByIdForReview({
    actor,
    id,
  }: {
    actor: StrictAuthorizationActor;
    id: string;
  }): Promise<CompetitionSuggestionAdminDetailDTO> {
    const context = await CompetitionSuggestionContextResolver.resolve({
      actor,
      suggestionId: id,
    });

    CompetitionSuggestionAuthorizer.readAny(context);

    const { suggestion } = context;

    const canApprove = CompetitionSuggestionPolicy.can(
      context,
      CompetitionSuggestionAction.REVIEW,
    ).allowed;

    const canRemoveAssets = CompetitionSuggestionPolicy.can(
      context,
      CompetitionSuggestionAction.MODERATE_ASSETS,
    ).allowed;

    return {
      id: suggestion.id,
      suggestionTitle: suggestion.suggestionTitle,
      status: suggestion.status,

      suggestionContent: suggestion.suggestionContent
        ? {
            id: suggestion.suggestionContent.id,
            content: suggestion.suggestionContent.content,
            version: suggestion.suggestionContent.version,
          }
        : null,

      submittedAt: suggestion.submittedAt,
      createdAt: suggestion.createdAt,
      updatedAt: suggestion.updatedAt,
      reviewedAt: suggestion.reviewedAt,

      reviewNotes: suggestion.reviewNotes,
      rejectionReason: suggestion.rejectionReason,

      competitionId: suggestion.competitionId,

      submitter: {
        id: suggestion.submittedBy.id,
        name: suggestion.submittedBy.name,
        email: suggestion.submittedBy.email,
      },

      reviewedBy: suggestion.reviewedBy
        ? { id: suggestion.reviewedBy.id, name: suggestion.reviewedBy.name }
        : null,

      assets: withAssetDownloadUrls(suggestion)
        .assets as unknown as CompetitionSuggestionAssetDTO[],

      canApprove,
      canReject: canApprove,
      canRequestChanges: canApprove,
      canRemoveAssets,
      reviewBlockedReason: suggestionReviewBlockedReason(suggestion.status),
    };
  }

  // ===========================================================================
  // Admin: Moderation Decisions
  // ===========================================================================

  private static async applyDecision({
    actor,
    id,
    status,
    reviewNotes,
    rejectionReason,
  }: {
    actor: StrictAuthorizationActor;
    id: string;
    status: SuggestionStatus;
    reviewNotes: string | null;
    rejectionReason: string | null;
  }) {
    const context = await CompetitionSuggestionContextResolver.resolve({
      actor,
      suggestionId: id,
    });

    CompetitionSuggestionAuthorizer.review(context);

    return withAssetDownloadUrls(
      await competitionSuggestionRepository.applyReviewDecision({
        id,
        status,
        reviewedById: actor.id,
        reviewedAt: new Date(),
        reviewNotes,
        rejectionReason,
      }),
    );
  }

  /**
   * Approves the suggestion. Deliberately does NOT create a Competition —
   * the admin creates that separately, by hand, once approved. Any leftover
   * feedback from a prior CHANGES_REQUESTED/REJECTED round is cleared so an
   * APPROVED suggestion never carries a stale rejection/change-request note.
   */
  static async approve({
    actor,
    id,
  }: {
    actor: StrictAuthorizationActor;
    id: string;
  }) {
    return this.applyDecision({
      actor,
      id,
      status: "APPROVED",
      reviewNotes: null,
      rejectionReason: null,
    });
  }

  static async reject({
    actor,
    id,
    reason,
  }: {
    actor: StrictAuthorizationActor;
    id: string;
    reason?: string;
  }) {
    return this.applyDecision({
      actor,
      id,
      status: "REJECTED",
      reviewNotes: null,
      rejectionReason: reason?.trim() || null,
    });
  }

  static async requestChanges({
    actor,
    id,
    reason,
  }: {
    actor: StrictAuthorizationActor;
    id: string;
    reason?: string;
  }) {
    return this.applyDecision({
      actor,
      id,
      status: "CHANGES_REQUESTED",
      reviewNotes: reason?.trim() || null,
      rejectionReason: null,
    });
  }
}

export const competitionSuggestionService = CompetitionSuggestionService;
