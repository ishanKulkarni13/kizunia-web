import { RateLimitPolicyId } from "@/lib/rate-limit";

import { UpdateCompetitionUseCase } from "../../application/update-competition.usecase";
import {
  UpdateCompetitionToolSchema,
  type UpdateCompetitionToolInput,
} from "../../schemas/competitions/update-competition.schema";
import type { McpRequestContext } from "../../server/context/request-context";
import type { McpTool } from "../types";

export const updateCompetitionTool: McpTool<UpdateCompetitionToolInput> = {
  name: "update_competition",

  description:
    "Update an existing Kizunia competition, identified by its current " +
    "slug in `target.slug`. Only the fields present in `patch` are changed " +
    "— omit anything you don't want to touch. Requires the " +
    "'competitions:write' scope, AND the authenticated Kizunia user must " +
    "independently be an OWNER/ORGANIZER/MAINTAINER of the competition or " +
    "hold platform ADMIN/SUPER_ADMIN authority. Does not change the " +
    "competition's visibility or publish it — use Kizunia's own admin " +
    "console for that.",

  inputSchema: UpdateCompetitionToolSchema,

  rateLimitPolicy: RateLimitPolicyId.MCP_TOOLS_WRITE,

  execute(context: McpRequestContext, input: UpdateCompetitionToolInput) {
    return UpdateCompetitionUseCase.execute(context, input);
  },
};
