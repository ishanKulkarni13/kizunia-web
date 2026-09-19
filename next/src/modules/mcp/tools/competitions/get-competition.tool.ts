import { RateLimitPolicyId } from "@/lib/rate-limit";

import { GetCompetitionUseCase } from "../../application/get-competition.usecase";
import {
  GetCompetitionSchema,
  type GetCompetitionInput,
} from "../../schemas/competitions/get-competition.schema";
import type { McpRequestContext } from "../../server/context/request-context";
import type { McpTool } from "../types";

export const getCompetitionTool: McpTool<GetCompetitionInput> = {
  name: "get_competition",

  description:
    "Fetch the full detail of one Kizunia competition by its slug — " +
    "description, documentation content, categories, technologies, " +
    "eligibilities, and locations. Read-only and requires the " +
    "'competitions:read' scope. Applies the same visibility rules as the " +
    "public competition page: PUBLIC and UNLISTED competitions are visible " +
    "to anyone; PRIVATE and ARCHIVED competitions are not returned.",

  inputSchema: GetCompetitionSchema,

  rateLimitPolicy: RateLimitPolicyId.MCP_TOOLS_READ,

  execute(context: McpRequestContext, input: GetCompetitionInput) {
    return GetCompetitionUseCase.execute(context, input);
  },
};
