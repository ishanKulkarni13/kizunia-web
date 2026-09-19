import { z } from "zod";

import { LinkTitleSchema, LinkTypeSchema, LinkUrlSchema } from "@/modules/links";

export const CreateProjectLinkSchema = z.object({
  title: LinkTitleSchema,

  url: LinkUrlSchema,

  type: LinkTypeSchema,
});

export type CreateProjectLinkInput = z.infer<typeof CreateProjectLinkSchema>;

export const UpdateProjectLinkSchema = z
  .object({
    title: LinkTitleSchema.optional(),

    url: LinkUrlSchema.optional(),

    type: LinkTypeSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided.",
  });

export type UpdateProjectLinkInput = z.infer<typeof UpdateProjectLinkSchema>;

/**
 * Full reordering by identity: position in the array becomes `order`. The
 * request must name every link of the project exactly once.
 */
export const ReorderProjectLinksSchema = z.object({
  ids: z
    .array(z.string().trim().min(1))
    .min(1, "At least one link id must be provided."),
});

export type ReorderProjectLinksInput = z.infer<
  typeof ReorderProjectLinksSchema
>;
