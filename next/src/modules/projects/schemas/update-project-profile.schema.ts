import { z } from "zod";

import { ProjectStatus, ProjectVisibility } from "@/generated/prisma";
import { ShortDescriptionSchema, SlugSchema, TitleSchema } from "@/lib/validation/index";

export const UpdateProjectProfileSchema = z.object({
  title: TitleSchema.optional(),

  slug: SlugSchema.optional(),

  shortDescription: ShortDescriptionSchema.optional(),

  status: z.nativeEnum(ProjectStatus).optional(),

  visibility: z.nativeEnum(ProjectVisibility).optional(),
});

export type UpdateProjectProfileInput = z.infer<
  typeof UpdateProjectProfileSchema
>;
