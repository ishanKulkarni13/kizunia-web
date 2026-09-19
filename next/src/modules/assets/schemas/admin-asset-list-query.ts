import { z } from "zod";

import { AssetCategory, AssetStatus } from "@/generated/prisma";

/**
 * A query-string date, parsed leniently: missing or unparsable becomes
 * `undefined` (no filter applied) rather than a validation error — this is
 * an admin filter widget, not a strict API contract, and an odd value in a
 * hand-edited URL should degrade rather than 422.
 */
const dateParam = z
  .string()
  .optional()
  .transform((value) => {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  });

/**
 * The admin list's filters. Deliberately does NOT own `page`/`limit` — this
 * repo's pagination (`parsePagination`/`buildPaginationMeta` in
 * `@/lib/search`) clamps those straight off the raw query params the same
 * way `TechnologyListQuerySchema` does, so this only validates filters
 * specific to this listing.
 *
 * No free-text search: `originalFilename` is always `null` today (see
 * `AssetService.finalize`) and `publicId` is a provider identifier this
 * admin surface deliberately never exposes — `id` exact-match is the honest
 * substitute for "find one specific Asset".
 */
export const AdminAssetListQuerySchema = z.object({
  id: z.string().trim().min(1).optional(),

  status: z.nativeEnum(AssetStatus).optional(),

  category: z.nativeEnum(AssetCategory).optional(),

  referenced: z.enum(["yes", "no"]).optional(),

  createdFrom: dateParam,
  createdTo: dateParam,
  detachedFrom: dateParam,
  detachedTo: dateParam,
});

export type AdminAssetListQuery = z.infer<typeof AdminAssetListQuerySchema>;
