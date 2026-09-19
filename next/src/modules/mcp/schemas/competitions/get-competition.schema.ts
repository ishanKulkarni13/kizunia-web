import { z } from "zod";

import { SlugSchema } from "@/lib/validation/index";

/**
 * `get_competition` input.
 *
 * Slug, not id: the slug is the stable, human-meaningful identifier the
 * rest of Kizunia already treats as the public handle for a competition
 * (`GET /api/v1/competitions/[slug]`, `CompetitionService.findPublicBySlug`).
 * An MCP client has no legitimate way to learn a database id without first
 * seeing a slug, so accepting only slugs here also closes off id
 * enumeration as an avenue into this tool.
 */
export const GetCompetitionSchema = z.object({
  slug: SlugSchema,
});

export type GetCompetitionInput = z.infer<typeof GetCompetitionSchema>;
