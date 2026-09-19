import { NextRequest } from "next/server";

import { ApiResponse } from "@/lib/http";
import { Route } from "@/lib/http/route";
import { SessionService } from "@/lib/auth/session";


import { CompetitionSuggestionService } from "./service";
import { CompetitionSuggestionAssetService } from "./asset-service";
import { CreateCompetitionSuggestionSchema } from "../../schemas/create-competition-suggestion";
import { UpdateCompetitionSuggestionSchema } from "../../schemas/update-competition-suggestion";
import { AttachCompetitionSuggestionAssetSchema } from "../../schemas/attach-competition-suggestion-asset";
import {
  RejectCompetitionSuggestionSchema,
  RequestChangesCompetitionSuggestionSchema,
} from "../../schemas/review-competition-suggestion";

/** Reason fields are genuinely optional, so a caller may send no body (or an
 * unparseable one) at all — treat that as `{}` rather than a 400. */
async function readOptionalJsonBody(request: NextRequest): Promise<unknown> {
  return request.json().catch(() => ({}));
}

export class CompetitionSuggestionController {
  // ===========================================================================
  // Create
  // ===========================================================================

  static async create(request: NextRequest) {
    return Route.execute(async () => {
      // -----------------------------------------------------------------------
      // Authentication
      // -----------------------------------------------------------------------

      const actor = await SessionService.getStrictActor(request);

      // -----------------------------------------------------------------------
      // Validation
      // -----------------------------------------------------------------------

      const data = CreateCompetitionSuggestionSchema.parse(
        await request.json(),
      );

      // -----------------------------------------------------------------------
      // Business Logic
      // -----------------------------------------------------------------------

      const suggestion = await CompetitionSuggestionService.create({
        actor: {
          id: actor.id,
          role: actor.role,
          banned: actor.banned,
        },
        dto: data,
      });

      // -----------------------------------------------------------------------
      // Response
      // -----------------------------------------------------------------------

      return ApiResponse.created(suggestion);
    });
  }

  // ===========================================================================
  // Read
  // ===========================================================================

  static async findById(
    request: NextRequest,
    suggestionId: string,
  ) {
    return Route.execute(async () => {
      // -----------------------------------------------------------------------
      // Authentication
      // -----------------------------------------------------------------------

      const actor = await SessionService.getStrictActor(request);

      // -----------------------------------------------------------------------
      // Business Logic
      // -----------------------------------------------------------------------

      const suggestion = await CompetitionSuggestionService.findById({
        actor: {
          id: actor.id,
          role: actor.role,
          banned: actor.banned,
        },
        id: suggestionId,
      });

      // -----------------------------------------------------------------------
      // Response
      // -----------------------------------------------------------------------

      return ApiResponse.ok(suggestion);
    });
  }


static async findMine(request: NextRequest) {
  return Route.execute(async () => {
    const actor = await SessionService.getStrictActor(request);

    const suggestions =
      await CompetitionSuggestionService.findMine({
        actor: {
          id: actor.id,
          role: actor.role,
          banned: actor.banned,
        },
      });

    return ApiResponse.ok(suggestions);
  });
}

  // ===========================================================================
  // Update
  // ===========================================================================

  static async update(
    request: NextRequest,
    suggestionId: string,
  ) {
    return Route.execute(async () => {
      // -----------------------------------------------------------------------
      // Authentication
      // -----------------------------------------------------------------------

      const actor = await SessionService.getStrictActor(request);

      // -----------------------------------------------------------------------
      // Validation
      // -----------------------------------------------------------------------

      const data = UpdateCompetitionSuggestionSchema.parse(
        await request.json(),
      );

      // -----------------------------------------------------------------------
      // Business Logic
      // -----------------------------------------------------------------------

      const suggestion = await CompetitionSuggestionService.update({
        actor: {
          id: actor.id,
          role: actor.role,
          banned: actor.banned,
        },
        id: suggestionId,
        dto: data,
      });

      // -----------------------------------------------------------------------
      // Response
      // -----------------------------------------------------------------------

      return ApiResponse.ok(suggestion);
    });
  }

  // ===========================================================================
  // Submit
  // ===========================================================================

  static async submit(
    request: NextRequest,
    suggestionId: string,
  ) {
    return Route.execute(async () => {
      // -----------------------------------------------------------------------
      // Authentication
      // -----------------------------------------------------------------------

      const actor = await SessionService.getStrictActor(request);

      // -----------------------------------------------------------------------
      // Business Logic
      // -----------------------------------------------------------------------

      const suggestion = await CompetitionSuggestionService.submit({
        actor: {
          id: actor.id,
          role: actor.role,
          banned: actor.banned,
        },
        id: suggestionId,
      });

      // -----------------------------------------------------------------------
      // Response
      // -----------------------------------------------------------------------

      return ApiResponse.ok(suggestion);
    });
  }

  // ===========================================================================
  // Reopen (CHANGES_REQUESTED -> DRAFT)
  // ===========================================================================

  static async reopen(
    request: NextRequest,
    suggestionId: string,
  ) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      const suggestion = await CompetitionSuggestionService.reopen({
        actor: {
          id: actor.id,
          role: actor.role,
          banned: actor.banned,
        },
        id: suggestionId,
      });

      return ApiResponse.ok(suggestion);
    });
  }

  // ===========================================================================
  // Assets
  // ===========================================================================

  static async attachAsset(
    request: NextRequest,
    suggestionId: string,
  ) {
    return Route.execute(async () => {
      // -----------------------------------------------------------------------
      // Authentication
      // -----------------------------------------------------------------------

      const actor = await SessionService.getStrictActor(request);

      // -----------------------------------------------------------------------
      // Validation
      // -----------------------------------------------------------------------

      const data = AttachCompetitionSuggestionAssetSchema.parse(
        await request.json(),
      );

      // -----------------------------------------------------------------------
      // Business Logic
      // -----------------------------------------------------------------------

      const suggestion = await CompetitionSuggestionAssetService.attach({
        actor: {
          id: actor.id,
          role: actor.role,
          banned: actor.banned,
        },
        suggestionId,
        assetId: data.assetId,
      });

      // -----------------------------------------------------------------------
      // Response
      // -----------------------------------------------------------------------

      return ApiResponse.created(suggestion);
    });
  }

  static async detachAsset(
    request: NextRequest,
    suggestionId: string,
    assetId: string,
  ) {
    return Route.execute(async () => {
      // -----------------------------------------------------------------------
      // Authentication
      // -----------------------------------------------------------------------

      const actor = await SessionService.getStrictActor(request);

      // -----------------------------------------------------------------------
      // Business Logic
      // -----------------------------------------------------------------------

      const suggestion = await CompetitionSuggestionAssetService.detach({
        actor: {
          id: actor.id,
          role: actor.role,
          banned: actor.banned,
        },
        suggestionId,
        assetId,
      });

      // -----------------------------------------------------------------------
      // Response
      // -----------------------------------------------------------------------

      return ApiResponse.ok(suggestion);
    });
  }

  // ===========================================================================
  // Admin: Review Queue
  // ===========================================================================

  static async searchForReview(request: NextRequest) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      const result = await CompetitionSuggestionService.searchForReview({
        actor: {
          id: actor.id,
          role: actor.role,
          banned: actor.banned,
        },
        params: Object.fromEntries(request.nextUrl.searchParams),
      });

      return ApiResponse.ok(result);
    });
  }

  static async findByIdForReview(
    request: NextRequest,
    suggestionId: string,
  ) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      const suggestion = await CompetitionSuggestionService.findByIdForReview({
        actor: {
          id: actor.id,
          role: actor.role,
          banned: actor.banned,
        },
        id: suggestionId,
      });

      return ApiResponse.ok(suggestion);
    });
  }

  // ===========================================================================
  // Admin: Moderation Decisions
  //
  // Authorization for every method below lives in the service (via
  // `CompetitionSuggestionAuthorizer.review`/`.moderateAssets`), consistent
  // with how every other suggestion method in this module works — the
  // service is what's authoritative here, not this route layer or the
  // admin page's own guard.
  // ===========================================================================

  static async approve(
    request: NextRequest,
    suggestionId: string,
  ) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      const suggestion = await CompetitionSuggestionService.approve({
        actor: {
          id: actor.id,
          role: actor.role,
          banned: actor.banned,
        },
        id: suggestionId,
      });

      return ApiResponse.ok(suggestion);
    });
  }

  static async reject(
    request: NextRequest,
    suggestionId: string,
  ) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      const data = RejectCompetitionSuggestionSchema.parse(
        await readOptionalJsonBody(request),
      );

      const suggestion = await CompetitionSuggestionService.reject({
        actor: {
          id: actor.id,
          role: actor.role,
          banned: actor.banned,
        },
        id: suggestionId,
        reason: data.reason,
      });

      return ApiResponse.ok(suggestion);
    });
  }

  static async requestChanges(
    request: NextRequest,
    suggestionId: string,
  ) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      const data = RequestChangesCompetitionSuggestionSchema.parse(
        await readOptionalJsonBody(request),
      );

      const suggestion = await CompetitionSuggestionService.requestChanges({
        actor: {
          id: actor.id,
          role: actor.role,
          banned: actor.banned,
        },
        id: suggestionId,
        reason: data.reason,
      });

      return ApiResponse.ok(suggestion);
    });
  }

  // ===========================================================================
  // Admin: Asset Removal
  // ===========================================================================

  static async adminDetachAsset(
    request: NextRequest,
    suggestionId: string,
    assetId: string,
  ) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      const suggestion = await CompetitionSuggestionAssetService.adminDetach({
        actor: {
          id: actor.id,
          role: actor.role,
          banned: actor.banned,
        },
        suggestionId,
        assetId,
      });

      return ApiResponse.ok(suggestion);
    });
  }

  // ===========================================================================
  // Delete
  // ===========================================================================

  static async delete(
    request: NextRequest,
    suggestionId: string,
  ) {
    return Route.execute(async () => {
      // -----------------------------------------------------------------------
      // Authentication
      // -----------------------------------------------------------------------

      const actor = await SessionService.getStrictActor(request);

      // -----------------------------------------------------------------------
      // Business Logic
      // -----------------------------------------------------------------------

      await CompetitionSuggestionService.delete({
        actor: {
          id: actor.id,
          role: actor.role,
          banned: actor.banned,
        },
        id: suggestionId,
      });

      // -----------------------------------------------------------------------
      // Response
      // -----------------------------------------------------------------------

      return ApiResponse.ok({});
    });
  }
}