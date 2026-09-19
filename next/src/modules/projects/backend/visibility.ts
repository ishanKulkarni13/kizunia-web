/**
 * Project - Public visibility predicates
 *
 * The single query-side definition of "a project that may be surfaced on a
 * public listing surface". Other modules that render projects they do not
 * own (portfolios, and any future aggregation surface) must compose this
 * rather than re-typing the tuple, so the rule changes in exactly one place.
 *
 * Deliberately narrower than `ProjectPolicy.canView`, which additionally
 * admits UNLISTED: an unlisted project is reachable by direct link but must
 * never be *listed*. See `modules/projects/search/definition.ts`, whose
 * `publicScope` guard expresses the same rule for the search engine.
 */

import { Prisma, ProjectStatus, ProjectVisibility } from "@/generated/prisma";

export const publiclyListableProjectWhere = {
  deletedAt: null,

  visibility: ProjectVisibility.PUBLIC,

  status: ProjectStatus.PUBLISHED,
} satisfies Prisma.ProjectWhereInput;
