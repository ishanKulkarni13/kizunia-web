/**
 * Recommendations — Candidate Repository
 *
 * The one Prisma read this module performs. Deliberately its own query
 * rather than a call into `CompetitionRepository`: `docs/architecture/notifications/module-boundaries.md`
 * (which applies to this module too — see `README.md`) is explicit that a
 * consumer needing competition data defines its own read contract instead
 * of building notification/recommendation-shaped queries inside, or
 * borrowing internals from, the competitions module.
 *
 * Responsibilities
 * ----------------
 * ✓ Build the one Prisma query candidate selection needs
 * ✓ Execute it, return Prisma models
 *
 * Does NOT
 * ----------------
 * ✗ Apply preference/hard-constraint logic — that is the engine's job
 * ✗ Score or rank anything
 * ✗ Map to DTOs
 */
import prisma from "@/lib/prisma";
import { CompetitionStatus, type Prisma } from "@/generated/prisma";

/**
 * Everything the recommendation engine and the result DTO need about a
 * candidate competition, in one query. See `mapper.ts` for how this is
 * split into `RecommendationCandidate` (engine input) and
 * `CompetitionCardDTO` (result display).
 *
 * `satisfies`, not `as const`: Prisma's generated input types want a
 * mutable `orderBy` array, and `as const` on the whole object would make
 * the nested array `readonly` and fail to typecheck against them — the
 * same reason `competitions/backend/repository.ts`'s `locationsInclude`
 * uses `satisfies` instead of `as const`.
 */
export const CANDIDATE_INCLUDE = {
  logoAsset: true,
  coverAsset: true,
  categories: { include: { category: { select: { slug: true } } } },
  // A retired (soft-deleted) technology no longer counts as one of the
  // competition's technologies for scoring.
  technologies: {
    where: { technology: { deletedAt: null } },
    include: { technology: { select: { slug: true } } },
  },
  eligibilities: { select: { type: true } },
  types: { select: { type: true } },
  locations: {
    include: {
      location: { include: { searchAreas: { select: { searchAreaId: true } } } },
    },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  },
} satisfies Prisma.CompetitionInclude;

export class CandidateRepository {
  /**
   * Candidates for one user's Top Relevant Competition evaluation.
   *
   * Phase 0 simplification (explicit product direction): "registration is
   * open" is read directly from `Competition.status === REGISTRATION_OPEN`
   * — not inferred from `registrationStartDate`/`registrationDeadline`
   * timestamps. The existing notification spec
   * (`docs/architecture/notifications/recommendation/candidate-selection.md`)
   * flags that `status` is a sweep-materialized value that can lag the raw
   * dates, and recommends reasoning from timestamps for exactness. Phase 0
   * accepts that lag deliberately, because this is a manual testing surface
   * for the engine, not the daily cron path Phase 1 will build; Phase 1
   * must revisit this before relying on it for real notification delivery.
   *
   * Hard constraints (eligibility, location, etc.) are intentionally NOT
   * pushed into this query — see `docs/architecture/recommendation/candidate-selection.md`
   * for why filtering must run in the engine, not in SQL.
   */
  static async selectOpenForRecommendation(limit: number) {
    return prisma.competition.findMany({
      where: {
        visibility: "PUBLIC",
        deletedAt: null,
        status: CompetitionStatus.REGISTRATION_OPEN,
      },
      orderBy: [{ registrationDeadline: "asc" }, { id: "asc" }],
      take: limit,
      include: CANDIDATE_INCLUDE,
    });
  }
}

export type CandidateRow = Awaited<
  ReturnType<typeof CandidateRepository.selectOpenForRecommendation>
>[number];
