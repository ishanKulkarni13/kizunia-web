/**
 * Projects - Filter specifications (CLIENT-SAFE)
 *
 * Every Project filter for the public discovery page, described as the
 * person using the page experiences it. Mirrors the shape Competitions
 * established in `src/modules/competitions/search/ui.ts` — see that file
 * for the fuller rationale.
 *
 * Must remain importable from a `"use client"` component: no import of
 * `@/generated/prisma`, directly or through a barrel.
 *
 * Deliberately has no `status`/`statuses` filter. A project's workflow
 * stage is not a caller-facing question on this page: the public scope
 * guard in `definition.ts` requires `status: PUBLISHED` unconditionally,
 * alongside `visibility: PUBLIC` — both are non-negotiable scope
 * predicates, not filters someone could toggle. Registering one here as
 * `guardedKeys` would make that a startup failure, exactly as it would for
 * `visibility`.
 */

import {
  assertUniqueFilterParams,
  type FilterSpec,
  type RelationMultiSpec,
  type TextSpec,
} from "@/lib/search/client";

// =============================================================================
// Quick filters
// =============================================================================

const search: TextSpec = {
  kind: "text",
  key: "search",
  label: "Search",
  placeholder: "Search projects",
  group: "quick",
  weight: 0,
  description: "Matches the project title and short description. Substring, case-insensitive.",
};

const categories: RelationMultiSpec = {
  kind: "relation-multi",
  key: "categories",
  label: "Category",
  group: "quick",
  weight: 10,
  optionsEndpoint: "/api/v1/categories",
  searchPlaceholder: "Search categories",
  description: "The themes a project is about.",
};

const technologies: RelationMultiSpec = {
  kind: "relation-multi",
  key: "technologies",
  label: "Technology",
  group: "quick",
  weight: 20,
  optionsEndpoint: "/api/v1/technologies",
  searchPlaceholder: "Search technologies",
  description: "Tools and stacks a project is built with.",
};

// =============================================================================
// Registry
// =============================================================================

/**
 * Every Project discovery filter, addressable by name.
 *
 * `definition.ts` reads from this object when declaring the server registry,
 * so a filter's key, label and options exist in exactly one place.
 */
export const projectFilterSpecs = {
  search,
  categories,
  technologies,
} as const;

export type ProjectFilterKey = keyof typeof projectFilterSpecs;

/**
 * The specs in declaration order, validated for parameter collisions at
 * module load.
 */
export const PROJECT_FILTER_SPECS: readonly FilterSpec[] =
  assertUniqueFilterParams(Object.values(projectFilterSpecs));

/**
 * Sort options, as plain data for the sort control.
 *
 * Mirrors the keys in `definition.ts`'s sort registry, which remains the
 * authority: an unknown token there degrades to the default rather than
 * erroring, so a stale entry here would produce a harmless no-op.
 */
export const PROJECT_SORT_OPTIONS = [
  { key: "newest", label: "Newest" },
  { key: "oldest", label: "Oldest" },
  { key: "alphabetical-asc", label: "Title A–Z" },
  { key: "alphabetical-desc", label: "Title Z–A" },
  { key: "recently-updated", label: "Recently updated" },
] as const;

/** The sort applied when the URL names none. Must match the server registry. */
export const PROJECT_DEFAULT_SORT = "newest";
