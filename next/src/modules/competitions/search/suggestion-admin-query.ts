/**
 * Admin Competition Suggestion Review - Query schema
 *
 * Deliberately not built on the heavier `src/lib/search` filter-spec/preset
 * engine the public/admin Competition listing uses — this list has exactly
 * one real filter (status) plus an optional title search, so a small zod
 * schema in the `ProjectQuerySchema` style is the right amount of machinery.
 * Pagination itself still comes from `src/lib/search/pagination.ts`
 * (`parsePagination`/`buildPaginationMeta`/`toSkipTake`), so `page`/`limit`
 * stay compatible with the existing `SearchPagination` component.
 */

import { z } from "zod";

export const SUGGESTION_ADMIN_STATUS_FILTERS = [
  "UNDER_REVIEW",
  "DRAFT",
  "CHANGES_REQUESTED",
  "APPROVED",
  "REJECTED",
  "WITHDRAWN",
  "ALL",
] as const;

export type SuggestionAdminStatusFilter =
  (typeof SUGGESTION_ADMIN_STATUS_FILTERS)[number];

export const CompetitionSuggestionAdminQuerySchema = z.object({
  // Absent means UNDER_REVIEW — this is where "DRAFT is never shown by
  // default" is enforced, in the schema rather than in a page.
  status: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.enum(SUGGESTION_ADMIN_STATUS_FILTERS))
    .default("UNDER_REVIEW"),

  search: z.string().trim().min(1).optional(),

  sortBy: z
    .enum(["submittedAt", "createdAt", "reviewedAt"])
    .default("submittedAt"),

  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export type CompetitionSuggestionAdminQueryInput = z.infer<
  typeof CompetitionSuggestionAdminQuerySchema
>;
