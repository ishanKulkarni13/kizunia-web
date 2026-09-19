import { z } from "zod";

import { ShortDescriptionSchema, SlugSchema, TitleSchema } from "@/lib/validation/index";

export const CreateProjectSchema = z.object({
  title: TitleSchema,

  slug: SlugSchema,

  shortDescription: ShortDescriptionSchema,
});

export type CreateProjectDto = z.infer<
  typeof CreateProjectSchema
>;