import { SearchCompetitionsUseCase } from "../../application/search-competitions.usecase";
import {
  SearchCompetitionsSchema,
  type SearchCompetitionsInput,
} from "../../schemas/competitions/search-competitions.schema";
import type { McpRequestContext } from "../../server/context/request-context";
import type { McpTool } from "../types";

/**
 * `search_competitions` — thin MCP adapter.
 *
 * Everything this tool does: describe itself, validate input against its
 * schema (performed by the transport before `execute` runs), and delegate.
 * It holds no business logic, no authorization rule, and no Prisma import —
 * see `SearchCompetitionsUseCase` for the actual work.
 */
export const searchCompetitionsTool: McpTool<SearchCompetitionsInput> = {
  name: "search_competitions",

  description:
    "Search Kizunia competitions by keyword and structured filters " +
    "(mode, status, difficulty, entry fee, registration platform, " +
    "category/technology slugs, eligibility). Read-only and requires the " +
    "'competitions:read' scope. Returns competition cards, not full detail " +
    "— call get_competition with a result's slug for the complete record.",

  inputSchema: SearchCompetitionsSchema,

  execute(context: McpRequestContext, input: SearchCompetitionsInput) {
    return SearchCompetitionsUseCase.execute(context, input);
  },
};
