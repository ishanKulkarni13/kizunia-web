import { z } from "zod";

import { ProjectStatus } from "@/generated/prisma";

/**
 * Validates query params for GET /api/v1/projects/mine.
 *
 * A dedicated schema rather than a reuse of the public discovery registry
 * (`projectSearchDefinition` in `./definition.ts`) — that one carries
 * `category`/`technology` filters that don't apply to a membership scope,
 * and accepting-but-ignoring them would be a misleading API surface. There
 * is deliberately no `userId` field: the actor is always derived from the
 * authenticated session, never from the request.
 */
export const ProjectMineQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),

  status: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.nativeEnum(ProjectStatus))
    .optional(),

  sortBy: z
    .enum([
      "createdAt",
      "updatedAt",
      "title",
    ])
    .default("createdAt"),

  sortOrder: z
    .enum([
      "asc",
      "desc",
    ])
    .default("desc"),

  page: z.coerce
    .number()
    .int()
    .positive()
    .default(1),

  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20),
});

export type ProjectMineQueryInput = z.infer<typeof ProjectMineQuerySchema>;
