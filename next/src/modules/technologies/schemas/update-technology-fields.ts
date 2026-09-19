import { z } from "zod";

import { TechnologyType } from "@/generated/prisma";

// Deliberately excludes `slug` — changing a Technology's display name or
// type must never silently change its slug (and vice versa). Slug changes
// go through UpdateTechnologySlugSchema instead, on their own endpoint.
export const UpdateTechnologyFieldsSchema = z.object({
    name: z
        .string()
        .trim()
        .min(2, "Name must be at least 2 characters.")
        .max(100, "Name cannot exceed 100 characters.")
        .optional(),

    type: z.nativeEnum(TechnologyType).optional(),

    description: z
        .string()
        .trim()
        .max(500, "Description cannot exceed 500 characters.")
        .nullable()
        .optional(),
});

export type UpdateTechnologyFieldsInput = z.infer<
    typeof UpdateTechnologyFieldsSchema
>;
