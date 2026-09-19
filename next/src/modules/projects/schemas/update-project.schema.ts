import { z } from "zod";

import { ProjectVisibility } from "@/generated/prisma";

/**
 * @deprecated Superseded by the split, per-section update schemas:
 * `UpdateProjectProfileSchema` (title/slug/shortDescription/status/visibility)
 * and `UpdateProjectContentSchema` (content). Do not add new fields here or
 * introduce new callers.
 */
export const UpdateProjectSchema = z.object({
  title: z.string().trim().min(1).max(150).optional(),

  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(100)
    .regex(/^[a-z0-9-]+$/)
    .optional(),

  shortDescription: z
    .string()
    .trim()
    .max(500)
    .optional(),

  content: z.string().trim().optional(),

  visibility: z
    .nativeEnum(ProjectVisibility)
    .optional(),

  logoAssetId: z.string().cuid().nullable().optional(),

  coverAssetId: z.string().cuid().nullable().optional(),

  startDate: z.coerce.date().nullable().optional(),

  endDate: z.coerce.date().nullable().optional(),
});

/**
 * @deprecated See `UpdateProjectSchema`.
 */
export type UpdateProjectDto = z.infer<
  typeof UpdateProjectSchema
>;