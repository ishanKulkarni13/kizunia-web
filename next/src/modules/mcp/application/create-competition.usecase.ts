import { PlatformContextResolver } from "@/authorization/platform/resolver";
import { CompetitionService } from "@/modules/competitions/backend/service";
import { CompetitionContextResolver } from "@/modules/competitions/backend/authorization/context-resolver";
import { CompetitionAuthorizer } from "@/modules/competitions/backend/authorization/authorizer";

import { requireScope } from "../authorization/authorize-mcp";
import { McpScope } from "../auth/scopes";
import type { McpRequestContext } from "../server/context/request-context";
import { CompetitionImportMapper } from "../mappers/competition-import.mapper";
import type { CreateCompetitionToolInput } from "../schemas/competitions/create-competition.schema";

/**
 * Application layer for `create_competition`.
 *
 * =============================================================================
 * Authorization — reusing Kizunia's own decision, not re-deriving it
 * =============================================================================
 *
 * Creation is a *platform*-level capability in Kizunia (there is no
 * competition yet to hold a membership against), so this calls
 * `CompetitionAuthorizer.create` — the exact function
 * `CompetitionController.create` calls for the REST API — against a
 * `PlatformContext` built from `context.actor`. In the current permission
 * set only ADMIN/SUPER_ADMIN hold `PlatformAction.CREATE_COMPETITION`
 * (`PlatformPermissionSet`), so an ordinary read-scoped MCP user is refused
 * here regardless of which scopes their token carries — exactly the
 * "selected MCP users can read, cannot write unless Kizunia authorization
 * independently allows it" requirement.
 *
 * =============================================================================
 * Draft-first
 * =============================================================================
 *
 * `Competition.visibility` defaults to `PRIVATE` in the schema — creating a
 * competition is already Kizunia's draft state; nothing becomes publicly
 * visible until an authorized human changes its visibility (or, for
 * SUPER_ADMIN, this tool is later extended to accept an explicit
 * visibility). MCP never sets `visibility` on create, so an imported
 * competition can never silently start out published.
 *
 * =============================================================================
 * Two-step write, one attributable actor
 * =============================================================================
 *
 * `CreateCompetitionSchema` covers only a handful of fields (title, slug,
 * shortDescription, organizer, website, registrationLink, content) — see the
 * audit. Everything else the import contract carries (dates, team size,
 * registration platform, …) is applied immediately afterward through
 * `CompetitionService.update`, the same call `CompetitionController.update`
 * makes, so lifecycle reconciliation and every other side effect of an
 * update run identically regardless of entry point. Both writes carry the
 * same actor, so `createdById`/`updatedById` attribute consistently to the
 * human whose token this was.
 */
export class CreateCompetitionUseCase {
  static async execute(
    context: McpRequestContext,
    input: CreateCompetitionToolInput,
  ) {
    requireScope(context, McpScope.COMPETITIONS_WRITE);

    const platformContext = await PlatformContextResolver.resolve(context.actor);

    CompetitionAuthorizer.create(platformContext);

    const slug = await CompetitionImportMapper.resolveSlug(input);

    const created = await CompetitionService.create({
      context: platformContext,
      data: CompetitionImportMapper.toCreateInput(input, slug),
    });

    // Always followed by an (at minimum trivial) update through the exact
    // path `CompetitionController.update` uses. This re-resolves the
    // context — competition row plus the actor's (absent) membership —
    // rather than constructing one by hand, so `CompetitionAuthorizer.edit`
    // runs the identical check an admin's own follow-up PATCH would go
    // through, and the response DTO always comes from the same
    // `CompetitionService.update` shaping regardless of how much the
    // import contract actually supplied beyond `create_competition`'s
    // minimal set of fields.
    const editContext = await CompetitionContextResolver.resolve({
      actor: platformContext.actor,
      competitionId: created.id,
    });

    CompetitionAuthorizer.edit(editContext);

    return CompetitionService.update({
      context: editContext,
      data: CompetitionImportMapper.toCreateFollowUpUpdate(input) ?? {
        // `UpdateCompetitionSchema` requires at least one key. When the
        // import carried nothing beyond what `create` already persisted,
        // re-assert the title — a no-op write, but one that still exercises
        // the identical update path and returns the identical DTO shape.
        title: input.title,
      },
    });
  }
}
