import { z } from "zod";

import { TechnologyType } from "@/generated/prisma";

/**
 * The admin listing's filters. Deliberately does NOT own `page`/`limit` —
 * this repo's pagination (`parsePagination`/`buildPaginationMeta` in
 * `@/lib/search`) clamps those straight off the raw query params the same
 * way `CompetitionService.search` does, rather than through a Zod schema, so
 * this only validates the filters that are specific to this listing.
 */
export const TechnologyListQuerySchema = z.object({
    q: z.string().trim().min(1).max(200).optional(),

    type: z.nativeEnum(TechnologyType).optional(),

    // Query params arrive as strings; only the literal "true" opts in, any
    // other value (missing, "false", garbage) behaves as the safe default.
    includeDeleted: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .transform((value) => {
            const raw = Array.isArray(value) ? value[0] : value;
            return raw === "true";
        }),
});

export type TechnologyListQuery = z.infer<typeof TechnologyListQuerySchema>;
