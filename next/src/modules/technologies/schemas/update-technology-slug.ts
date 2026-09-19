import { z } from "zod";

export const UpdateTechnologySlugSchema = z.object({
    slug: z
        .string()
        .trim()
        .min(2, "Slug must be at least 2 characters.")
        .max(100, "Slug cannot exceed 100 characters.")
        .regex(
            /^[a-z0-9-]+$/,
            "Slug may only contain lowercase letters, numbers, and hyphens.",
        ),
});

export type UpdateTechnologySlugInput = z.infer<
    typeof UpdateTechnologySlugSchema
>;
