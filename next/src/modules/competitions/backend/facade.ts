import { SessionService } from "@/lib/auth/session";

import { CompetitionAuthorizer } from "./authorization/authorizer";
import { CompetitionContextResolver } from "./authorization/context-resolver";
import { CompetitionService } from "./service";
import { PlatformAction } from "@/authorization/platform/actions";
import { PlatformAuthorizer } from "@/authorization/platform/authorizer";

export class CompetitionFacade {
  // contoller kinda thing for the backend
  static async adminGetForEdit(competitionId: string) {
    const actor = await SessionService.getActor();

    const context = await CompetitionContextResolver.resolve({
      actor,
      competitionId,
    });

    PlatformAuthorizer.can({ actor }, PlatformAction.ACCESS_ADMIN_DASHBOARD);
    CompetitionAuthorizer.edit(context);

    return CompetitionService.adminFindForEdit(context);
  }
}
