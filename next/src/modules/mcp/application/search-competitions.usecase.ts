import { CompetitionService } from "@/modules/competitions/backend/service";
import type { CompetitionSearchResult } from "@/modules/competitions/search/types";
import type { CompetitionCardDTO } from "@/modules/competitions/types/dto";

import { requireScope } from "../authorization/authorize-mcp";
import { McpScope } from "../auth/scopes";
import type { McpRequestContext } from "../server/context/request-context";
import {
  toRawSearchParams,
  type SearchCompetitionsInput,
} from "../schemas/competitions/search-competitions.schema";

/**
 * Application layer for `search_competitions`.
 *
 * A use case, not a tool: it knows about `McpRequestContext` and MCP scopes,
 * but nothing about JSON-RPC, tool schemas as MCP wire types, or transport.
 * The tool adapter (`tools/competitions/search-competitions.tool.ts`) is the
 * only thing that knows this is being called from MCP at all.
 *
 * =============================================================================
 * Authorization
 * =============================================================================
 *
 * `CompetitionService.search` is Kizunia's existing *public* search — the
 * same one the unauthenticated marketing site uses, scoped server-side to
 * public, non-deleted competitions. There is no Kizunia authorization
 * decision to make beyond that scope, which the query itself enforces, so
 * the only gate here is the MCP capability check: does this token carry
 * `competitions:read`.
 */
export class SearchCompetitionsUseCase {
  static async execute(
    context: McpRequestContext,
    input: SearchCompetitionsInput,
  ): Promise<CompetitionSearchResult<CompetitionCardDTO>> {
    requireScope(context, McpScope.COMPETITIONS_READ);

    return CompetitionService.search(toRawSearchParams(input));
  }
}
