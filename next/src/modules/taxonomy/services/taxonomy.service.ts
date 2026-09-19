import { TaxonomyRepository } from "../repository/taxonomy.repository";
import type { TaxonomyQuery } from "../schemas/taxonomy-query";
import type { TaxonomyOptionDTO } from "../types/taxonomy-option.dto";

/**
 * A row shaped like every taxonomy the filter UI consumes.
 *
 * The repository's `_count` key name tracks `entity` — `competitions` for
 * `entity: "competition"`, `projects` for `entity: "project"` — so this
 * type carries both as optional and `toOptions` reads whichever one the
 * request actually asked for.
 */
interface CountedTaxonomyRow {
  readonly name: string;
  readonly slug: string;
  readonly _count: {
    readonly competitions?: number;
    readonly projects?: number;
  };
}

export class TaxonomyService {
  /**
   * Business Layer
   *
   * Responsibilities
   * ----------------
   * ✓ Business rules
   * ✓ Repository orchestration
   * ✓ Mapping database models
   *
   * Does NOT
   * ----------------
   * ✗ Parse HTTP requests
   * ✗ Authenticate users
   * ✗ Authorize users
   * ✗ Query Prisma directly
   * ✗ Return NextResponse
   */

  /**
   * Category options for the filter picker.
   *
   * Categories and technologies are separate tables but identical from the
   * filter's point of view, so both funnel through one mapper. If they ever
   * diverge — a technology gaining an icon the picker should render — that is
   * the moment to split them, not before.
   */
  static async listCategories(
    query: TaxonomyQuery,
  ): Promise<TaxonomyOptionDTO[]> {
    const rows = await TaxonomyRepository.findCategories(query);

    return this.toOptions(rows, query);
  }

  static async listTechnologies(
    query: TaxonomyQuery,
  ): Promise<TaxonomyOptionDTO[]> {
    const rows = await TaxonomyRepository.findTechnologies(query);

    return this.toOptions(rows, query);
  }

  /**
   * Drops options nothing public uses, unless explicitly asked for them.
   *
   * Filtered here rather than in the query because the count is what decides
   * it, and expressing "having at least one visible row" in Prisma would need
   * a second, more expensive relational condition for the same answer this
   * already has in hand.
   */
  private static toOptions(
    rows: readonly CountedTaxonomyRow[],
    query: TaxonomyQuery,
  ): TaxonomyOptionDTO[] {
    const countOf = (row: CountedTaxonomyRow): number =>
      query.entity === "project"
        ? (row._count.projects ?? 0)
        : (row._count.competitions ?? 0);

    return rows
      .filter((row) => query.includeEmpty || countOf(row) > 0)
      .map((row) => ({
        value: row.slug,
        label: row.name,
        count: countOf(row),
      }));
  }
}
