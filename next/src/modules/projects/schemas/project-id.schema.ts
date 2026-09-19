import { z } from "zod";

export const ProjectIdSchema = z.object({
  id: z.string().cuid(),
});

export type ProjectIdDto = z.infer<
  typeof ProjectIdSchema
>;