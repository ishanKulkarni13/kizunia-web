import { ProjectStatus } from "@/generated/prisma";

/**
 * Query shape for the membership-scoped "my projects" listing.
 *
 * Deliberately narrower than the public discovery registry
 * (`projectSearchDefinition` in `./definition.ts`): `category`/`technology`
 * don't apply to this scope, and adding them here would let the API surface
 * imply support it doesn't have. `visibility` is never a field here either —
 * membership is the scope, not a caller-supplied filter.
 */
export type ProjectMineQueryDto = {
  search?: string;

  status?: ProjectStatus;

  sortBy: "createdAt" | "updatedAt" | "title";

  sortOrder: "asc" | "desc";

  page: number;

  pageSize: number;
};
