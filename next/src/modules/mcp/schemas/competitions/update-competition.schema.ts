import { z } from "zod";

import { SlugSchema } from "@/lib/validation/index";

import { CompetitionImportSchema } from "./competition-import.schema";

/**
 * `update_competition` input.
 *
 * `.partial()` over the shared import contract: every field becomes
 * optional (matching `UpdateCompetitionSchema`'s "send only what changed"
 * shape), and `target.slug` addresses the competition being updated —
 * distinct from `patch.slug`, which (like `UpdateCompetitionSchema.slug`)
 * renames it.
 *
 * No `null`-clearing convention exists here, unlike `UpdateCompetitionSchema`
 * — a field simply absent from `patch` is left untouched. Clearing a field
 * via MCP is not a first-version requirement, and adding it later is a
 * additive schema change, not a breaking one.
 */
export const UpdateCompetitionToolSchema = z.object({
  target: z.object({
    slug: SlugSchema,
  }),

  patch: CompetitionImportSchema.partial(),
});

export type UpdateCompetitionToolInput = z.infer<typeof UpdateCompetitionToolSchema>;
