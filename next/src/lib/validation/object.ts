// lib/validation/object.ts

import { z } from "zod";

export function requireAtLeastOneField<T extends z.ZodRawShape>(
    schema: z.ZodObject<T>,
) {
    return schema.refine(
        (data) => Object.keys(data).length > 0,
        {
            message: "At least one field must be provided.",
        },
    );
}