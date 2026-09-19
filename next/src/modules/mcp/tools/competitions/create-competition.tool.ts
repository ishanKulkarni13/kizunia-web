import { RateLimitPolicyId } from "@/lib/rate-limit";

import { CreateCompetitionUseCase } from "../../application/create-competition.usecase";
import {
  CreateCompetitionToolSchema,
  type CreateCompetitionToolInput,
} from "../../schemas/competitions/create-competition.schema";
import type { McpRequestContext } from "../../server/context/request-context";
import type { McpTool } from "../types";

export const createCompetitionTool: McpTool<CreateCompetitionToolInput> = {
  name: "create_competition",

  description:
    "Create a new Kizunia competition from structured information you have " +
    "already researched and extracted (e.g. from an organizer's website or " +
    "a listing site). Requires the 'competitions:write' scope, AND the " +
    "authenticated Kizunia user must independently hold competition-creation " +
    "authority — currently platform ADMIN/SUPER_ADMIN. The competition is " +
    "created PRIVATE (Kizunia's draft state): it is not publicly visible or " +
    "discoverable until an authorized Kizunia user changes its visibility. " +
    "Only `title` is required; supply every other field you can confidently " +
    "extract. If a source URL is available, put the organizer's own site in " +
    "`website` and the registration page in `registrationLink` — Kizunia has " +
    "no separate field for where imported data came from.",

  inputSchema: CreateCompetitionToolSchema,

  rateLimitPolicy: RateLimitPolicyId.MCP_TOOLS_WRITE,

  execute(context: McpRequestContext, input: CreateCompetitionToolInput) {
    return CreateCompetitionUseCase.execute(context, input);
  },
};
