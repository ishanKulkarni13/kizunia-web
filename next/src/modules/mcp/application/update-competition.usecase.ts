import { CompetitionService } from "@/modules/competitions/backend/service";
import { CompetitionContextResolver } from "@/modules/competitions/backend/authorization/context-resolver";
import { CompetitionAuthorizer } from "@/modules/competitions/backend/authorization/authorizer";
import { PlatformAction } from "@/authorization/platform/actions";
import { PlatformAuthorizer } from "@/authorization/platform/authorizer";
import { ValidationError } from "@/lib/errors";

import { requireScope } from "../authorization/authorize-mcp";
import { McpScope } from "../auth/scopes";
import type { McpRequestContext } from "../server/context/request-context";
import { CompetitionImportMapper } from "../mappers/competition-import.mapper";
import type { UpdateCompetitionToolInput } from "../schemas/competitions/update-competition.schema";

/**
 * Application layer for `update_competition`.
 *
 * Resolves the target by slug (see `get-competition.schema.ts` for why MCP
 * addresses competitions by slug rather than id), then runs the exact same
 * `CompetitionContextResolver` → `CompetitionAuthorizer.edit` →
 * `CompetitionService.update` sequence `CompetitionController.update` runs
 * for the REST API. An MCP caller without a `CompetitionMember` row on the
 * target — true for every non-admin MCP user, since creation grants no
 * membership — is refused by `CompetitionPolicy.canManage` requiring
 * membership, unless `platformOverride()` (ADMIN/SUPER_ADMIN) applies
 * first. This is the same IDOR guard the REST endpoint relies on: nothing
 * MCP-specific stands between an arbitrary slug in the request and this
 * check.
 *
 * The lifecycle-automation flag mirrors the REST controller's own gate:
 * toggling `automaticStatusUpdatesDisabled` is a platform capability
 * (`PlatformAction.MANAGE_COMPETITION_LIFECYCLE`), independent of ordinary
 * `EDIT` authority, so it is re-derived here rather than assumed to follow
 * from `CompetitionAuthorizer.edit` succeeding.
 */
export class UpdateCompetitionUseCase {
  static async execute(context: McpRequestContext, input: UpdateCompetitionToolInput) {
    requireScope(context, McpScope.COMPETITIONS_WRITE);

    if (Object.keys(input.patch).length === 0) {
      throw new ValidationError({
        code: "MCP_EMPTY_PATCH",
        status: 422,
        message: "At least one field must be provided in `patch`.",
      });
    }

    const editContext = await CompetitionContextResolver.resolveBySlug({
      actor: context.actor,
      slug: input.target.slug,
    });

    CompetitionAuthorizer.edit(editContext);

    const data = CompetitionImportMapper.toUpdateInput(input.patch);

    if (data.automaticStatusUpdatesDisabled !== undefined) {
      PlatformAuthorizer.can(
        { actor: editContext.actor },
        PlatformAction.MANAGE_COMPETITION_LIFECYCLE,
      );
    }

    return CompetitionService.update({
      context: editContext,
      data,
    });
  }
}
