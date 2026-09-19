import { Prisma } from "@/generated/prisma";
import prisma from "@/lib/prisma";

import type { TaxonomyQuery } from "../schemas/taxonomy-query";

/**
 * Counts only competitions a public search could actually return.
 *
 * If this diverged from the public scope's guard, an option would advertise a
 * count and then return fewer — or zero — results, which reads as a bug in
 * search rather than as a difference in visibility rules. Kept alongside the
 * scope guard in `competitions/search/definition.ts`; the two must move
 * together.
 */
const COMPETITION_PUBLICLY_VISIBLE: Prisma.CompetitionWhereInput = {
  deletedAt: null,
  visibility: "PUBLIC",
};

/**
 * Counts only projects the public `/projects` listing could actually
 * return. Mirrors the public scope guard in
 * `projects/search/definition.ts` exactly — both clauses, not just
 * `visibility` — for the same reason as the competition guard above: a
 * project that is `PUBLIC` but still `DRAFT` must not inflate a taxonomy
 * option's count when it would never appear in the results that count
 * describes.
 */
const PROJECT_PUBLICLY_VISIBLE: Prisma.ProjectWhereInput = {
  deletedAt: null,
  visibility: "PUBLIC",
  status: "PUBLISHED",
};

export class TaxonomyRepository {
  /**
   * Database Layer
   *
   * Responsibilities
   * ----------------
   * ✓ Build Prisma queries
   * ✓ Execute database operations
   * ✓ Return Prisma models
   *
   * Does NOT
   * ----------------
   * ✗ Business rules
   * ✗ Authentication
   * ✗ Authorization
   * ✗ DTO Mapping
   */

  static async findCategories(query: TaxonomyQuery) {
    if (query.entity === "project") {
      return prisma.category.findMany({
        where: this.nameFilter(query),

        select: {
          name: true,
          slug: true,
          _count: {
            select: {
              projects: {
                where: { project: PROJECT_PUBLICLY_VISIBLE },
              },
            },
          },
        },

        orderBy: { name: "asc" },

        take: query.limit,
      });
    }

    return prisma.category.findMany({
      where: this.nameFilter(query),

      select: {
        name: true,
        slug: true,
        _count: {
          select: {
            competitions: {
              where: { competition: COMPETITION_PUBLICLY_VISIBLE },
            },
          },
        },
      },

      orderBy: { name: "asc" },

      take: query.limit,
    });
  }

  static async findTechnologies(query: TaxonomyQuery) {
    // Soft-deleted Technologies are never valid taxonomy/filter options —
    // excluded regardless of caller, matching every other Technology
    // selector/picker in the app.
    const activeFilter = { ...this.nameFilter(query), deletedAt: null };

    if (query.entity === "project") {
      return prisma.technology.findMany({
        where: activeFilter,

        select: {
          name: true,
          slug: true,
          _count: {
            select: {
              projects: {
                where: { project: PROJECT_PUBLICLY_VISIBLE },
              },
            },
          },
        },

        orderBy: { name: "asc" },

        take: query.limit,
      });
    }

    return prisma.technology.findMany({
      where: activeFilter,

      select: {
        name: true,
        slug: true,
        _count: {
          select: {
            competitions: {
              where: { competition: COMPETITION_PUBLICLY_VISIBLE },
            },
          },
        },
      },

      orderBy: { name: "asc" },

      take: query.limit,
    });
  }

  /**
   * Narrows by name when a query was supplied.
   *
   * Filtering happens here rather than after loading because a taxonomy is
   * unbounded in principle — the picker must stay responsive as it grows.
   */
  private static nameFilter(query: TaxonomyQuery) {
    if (!query.q) {
      return {};
    }

    return {
      name: {
        contains: query.q,
        mode: Prisma.QueryMode.insensitive,
      },
    };
  }
}
