import { z } from "zod";

export const AttachProjectTechnologySchema = z.object({
  technologyId: z.string().trim().min(1),
});

export type AttachProjectTechnologyInput = z.infer<
  typeof AttachProjectTechnologySchema
>;

/**
 * Full reordering by identity: position in the array becomes `displayOrder`.
 * The request must name every technology of the project exactly once — mirrors
 * `ReorderProjectLinksSchema`/`ReorderProjectTestimonialsSchema`.
 */
export const ReorderProjectTechnologiesSchema = z.object({
  ids: z
    .array(z.string().trim().min(1))
    .min(1, "At least one technology id must be provided."),
});

export type ReorderProjectTechnologiesInput = z.infer<
  typeof ReorderProjectTechnologiesSchema
>;
