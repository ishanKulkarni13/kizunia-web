import { CompetitionService } from "@/modules/competitions/backend/service";
import { CompetitionNotFoundError } from "@/modules/competitions/errors";
import type { CompetitionDetailDTO } from "@/modules/competitions/types/dto";

import { requireScope } from "../authorization/authorize-mcp";
import { McpScope } from "../auth/scopes";
import type { McpRequestContext } from "../server/context/request-context";
import type { GetCompetitionInput } from "../schemas/competitions/get-competition.schema";

/**
 * Application layer for `get_competition`.
 *
 * Uses `CompetitionService.findPublicBySlug` — the same public,
 * unauthenticated read the competition detail page uses, which already
 * applies `CompetitionPolicy.canView` (PUBLIC/UNLISTED visible to anyone,
 * PRIVATE/ARCHIVED only to members or platform admins) internally.
 *
 * That policy call happens with a null actor today (see the audit note on
 * `findPublicBySlug`), so an MCP caller sees exactly what an anonymous web
 * visitor would see — never more. Extending this to show a caller their own
 * PRIVATE competitions is future work in `CompetitionService` itself, not
 * something to special-case from the MCP layer.
 */
export class GetCompetitionUseCase {
  static async execute(
    context: McpRequestContext,
    input: GetCompetitionInput,
  ): Promise<CompetitionDetailDTO> {
    requireScope(context, McpScope.COMPETITIONS_READ);

    const competition = await CompetitionService.findPublicBySlug(input.slug);

    if (!competition) {
      throw new CompetitionNotFoundError();
    }

    return competition;
  }
}
