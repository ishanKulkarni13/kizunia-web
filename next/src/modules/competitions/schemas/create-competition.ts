import { z } from "zod";

export const CreateCompetitionSchema = z.object({
    title: z
        .string()
        .trim()
        .min(3, "Title must be at least 3 characters.")
        .max(150, "Title cannot exceed 150 characters."),

    slug: z
        .string()
        .trim()
        .min(3, "Slug must be at least 3 characters.")
        .max(150, "Slug cannot exceed 150 characters.")
        .regex(
            /^[a-z0-9-]+$/,
            "Slug may only contain lowercase letters, numbers, and hyphens.",
        ),

    shortDescription: z
        .string()
        .trim()
        .max(500, "Short description cannot exceed 500 characters.")
        .optional(),

    organizer: z
        .string()
        .trim()
        .max(150)
        .optional(),

    website: z
        .string()
        .url("Please enter a valid website URL.")
        .optional()
        .or(z.literal("")),

    registrationLink: z
        .string()
        .url("Please enter a valid registration URL.")
        .optional()
        .or(z.literal("")),

    content: z
        .string()
        .optional()
});

export type CreateCompetitionInput =
    z.infer<typeof CreateCompetitionSchema>;