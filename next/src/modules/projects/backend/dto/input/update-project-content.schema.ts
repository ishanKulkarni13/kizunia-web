import { ContentSchema } from "@/lib/validation/string";
import { z } from "zod";

export const UpdateProjectContentSchema = z.object({
  content: ContentSchema,
});

export type UpdateProjectContentInput = z.infer<
  typeof UpdateProjectContentSchema
>;