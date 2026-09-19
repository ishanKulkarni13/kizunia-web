import { createCompetitionTool } from "./competitions/create-competition.tool";
import { getCompetitionTool } from "./competitions/get-competition.tool";
import { searchCompetitionsTool } from "./competitions/search-competitions.tool";
import { updateCompetitionTool } from "./competitions/update-competition.tool";
import type { McpTool } from "./types";

/**
 * Every MCP tool this server exposes, keyed by name.
 *
 * Adding a tool is: write its schema, use case, and adapter, then add one
 * line here. Nothing else in `server/` changes.
 */
export const MCP_TOOLS: ReadonlyMap<string, McpTool> = new Map(
  (
    [
      searchCompetitionsTool,
      getCompetitionTool,
      createCompetitionTool,
      updateCompetitionTool,
    ] as const
  ).map((tool) => [tool.name, tool as McpTool]),
);
