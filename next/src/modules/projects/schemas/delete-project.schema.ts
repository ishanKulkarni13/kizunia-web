import { z } from "zod";

export const DeleteProjectSchema = z.object({
  id: z.string().cuid(),
});

export type DeleteProjectDto = z.infer<
  typeof DeleteProjectSchema
>;