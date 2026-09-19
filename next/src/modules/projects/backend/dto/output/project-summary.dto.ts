import { ProjectStatus } from "@/generated/prisma";

/**
 * One row of the public `/projects` discovery listing.
 *
 * Every row this DTO is built from already satisfies the public scope
 * guard (`visibility: PUBLIC`, `status: PUBLISHED` — see
 * `search/definition.ts`), so `visibility` is deliberately not a field
 * here: a value that is always the same constant on every row this type
 * can ever describe would only invite a caller to start branching on it,
 * which is exactly the caller-side visibility check this listing must
 * never need. Distinct from `ProjectMineSummaryDto`, which does carry
 * `visibility` (its rows span every visibility) plus membership fields
 * (`myRole`, `canEdit`) that must never appear on a public row.
 */
export interface ProjectSummaryDto {
  id: string;

  title: string;

  slug: string;

  shortDescription: string;

  logo: {
    id: string;
    url: string;
  } | null;

  status: ProjectStatus;

  startDate: Date | null;

  endDate: Date | null;

  updatedAt: Date;

  categories: {
    slug: string;
    name: string;
  }[];

  technologies: {
    slug: string;
    name: string;
  }[];
}
