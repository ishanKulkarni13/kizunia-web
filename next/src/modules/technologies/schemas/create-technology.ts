import { z } from "zod";

import { TechnologyType } from "@/generated/prisma";

export const CreateTechnologySchema = z.object({
    name: z
        .string()
        .trim()
        .min(2, "Name must be at least 2 characters.")
        .max(100, "Name cannot exceed 100 characters."),

    type: z.nativeEnum(TechnologyType),

    description: z
        .string()
        .trim()
        .max(500, "Description cannot exceed 500 characters.")
        .optional(),
});

export type CreateTechnologyInput = z.infer<typeof CreateTechnologySchema>;
