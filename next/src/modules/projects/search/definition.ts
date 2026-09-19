/**
 * Projects - Search definition (SERVER ONLY)
 *
 * Owns the half of a filter that cannot leave the server: the translation
 * from a decoded value into a Prisma clause, the scope guard, and the sort
 * registry. Labels, options, groups and weights live in `./ui.ts`, which is
 * client-safe; this module consumes it. See
 * `src/modules/competitions/search/definition.ts` for the fuller rationale
 * behind this split.
 *
 * =============================================================================
 * The public scope guard
 * =============================================================================
 *
 * This is the fix for the live defect this discovery page replaces (see
 * docs/project/feature-specification/search/01-current-state.md §D):
 * `visibility` is not a filter a caller can request — the vocabulary to ask
 * for it does not exist in `projectFilterSpecs` — it is imposed entirely by
 * `publicScope.guard`, which `defineSearch` enforces cannot collide with any
 * registered filter key (`guardedKeys`).
 *
 * The guard requires **both** `visibility: "PUBLIC"` and `status:
 * "PUBLISHED"` — a project is public only once it is both, since every
 * project defaults to `visibility: PUBLIC` at creation while still
 * `status: DRAFT`. This mirrors the two-clause guard the Blogs module
 * spec anticipates (04-module-adoption.md §3): a workflow-state predicate
 * alongside the visibility one, both non-negotiable, both ANDed last.
 */

import { Prisma, ProjectStatus } from "@/generated/prisma";

import {
  bindFilter,
  defineScope,
  defineSearch,
  defineSortRegistry,
  multiFieldTextFilter,
  relationMultiFilter,
} from "@/lib/search";

import { projectFilterSpecs as specs } from "./ui";

type ProjectWhere = Prisma.ProjectWhereInput;
type ProjectOrderBy = Prisma.ProjectOrderByWithRelationInput;

/**
 * No scope currently needs actor data; kept as a named (empty) type, rather
 * than inlining `Record<string, never>` at each call site, for parity with
 * Competitions' shape — so a future management/admin scope can add fields
 * here without touching every call site.
 */
export type ProjectSearchContext = Record<string, never>;

// =============================================================================
// Ordinary filters
// =============================================================================

const search = multiFieldTextFilter<ProjectWhere>({
  spec: specs.search,
  toWhere: (value) => ({
    OR: [
      { title: { contains: value, mode: "insensitive" } },
      { shortDescription: { contains: value, mode: "insensitive" } },
    ],
  }),
});

const categories = relationMultiFilter<ProjectWhere>({
  spec: specs.categories,
  toWhere: (slugs) => ({
    categories: { some: { category: { slug: { in: slugs } } } },
  }),
});

const technologies = relationMultiFilter<ProjectWhere>({
  spec: specs.technologies,
  toWhere: (slugs) => ({
    technologies: { some: { technology: { slug: { in: slugs } } } },
  }),
});

// =============================================================================
// Sorting
// =============================================================================

export const ProjectSort = {
  NEWEST: "newest",
  OLDEST: "oldest",
  ALPHABETICAL_ASC: "alphabetical-asc",
  ALPHABETICAL_DESC: "alphabetical-desc",
  RECENTLY_UPDATED: "recently-updated",
} as const;

export type ProjectSort = (typeof ProjectSort)[keyof typeof ProjectSort];

export const projectSortRegistry = defineSortRegistry<ProjectOrderBy>({
  defaultKey: ProjectSort.NEWEST,
  tiebreaker: { id: "asc" },
  options: [
    {
      key: ProjectSort.NEWEST,
      label: "Newest",
      orderBy: [{ createdAt: "desc" }],
    },
    {
      key: ProjectSort.OLDEST,
      label: "Oldest",
      orderBy: [{ createdAt: "asc" }],
    },
    {
      key: ProjectSort.ALPHABETICAL_ASC,
      label: "Title A–Z",
      orderBy: [{ title: "asc" }],
    },
    {
      key: ProjectSort.ALPHABETICAL_DESC,
      label: "Title Z–A",
      orderBy: [{ title: "desc" }],
    },
    {
      key: ProjectSort.RECENTLY_UPDATED,
      label: "Recently updated",
      orderBy: [{ updatedAt: "desc" }],
    },
  ],
});

// =============================================================================
// Scopes
// =============================================================================

/**
 * The public scope requires three non-negotiable conditions:
 *
 * - deletedAt must be null — soft-deleted projects are never public.
 * - visibility must be PUBLIC.
 * - status must be PUBLISHED.
 *
 * All three conditions are ANDed together and cannot be overridden by
 * caller-supplied filters.
 */

const publicScope = defineScope<ProjectWhere, ProjectSearchContext>({
  id: "public",
  allowedFilters: "all",
  guardedKeys: ["visibility", "status", "deletedAt"],
  guard: () => [
    { deletedAt: null },
    { visibility: "PUBLIC" },
    { status: ProjectStatus.PUBLISHED },
  ],
});

// =============================================================================
// Definition
// =============================================================================

export const projectSearchDefinition = defineSearch<
  ProjectWhere,
  ProjectOrderBy,
  ProjectSearchContext
>({
  entity: "Project",

  filters: [
    bindFilter(search),
    bindFilter(categories),
    bindFilter(technologies),
  ],

  sorts: projectSortRegistry,

  scopes: {
    public: publicScope,
  },
});
