/**
 * Competitions Module - Lifecycle Repository
 *
 * Prisma access only, kept separate from `repository.ts` (already large):
 * everything the lifecycle preview/apply/sweep paths need to read and write,
 * and nothing else. No business rules live here — `evaluateLifecycle` is
 * called by `CompetitionLifecycleService`, never by this file.
 */
import { Prisma, type CompetitionStatus } from "@/generated/prisma";
import prisma from "@/lib/prisma";
import { buildCompetitionQuery, type CompetitionSearchPlan } from "../search/plan";

/** The lifecycle fields, and nothing else — no relations, no large text. */
export const LIFECYCLE_ROW_SELECT = {
  id: true,
  title: true,
  slug: true,
  status: true,
  statusUpdatedAt: true,
  registrationStartDate: true,
  registrationDeadline: true,
  startDate: true,
  endDate: true,
  automaticStatusUpdatesDisabled: true,
  deletedAt: true,
} satisfies Prisma.CompetitionSelect;

export type LifecycleRow = Prisma.CompetitionGetPayload<{
  select: typeof LIFECYCLE_ROW_SELECT;
}>;

export class CompetitionLifecycleRepository {
  /**
   * Every competition matching a lifecycle-scoped plan, unpaginated.
   *
   * Deliberately does not apply `skip`/`take` from the plan's own pagination
   * — the admin preview must paginate the *actionable* (changed) set, not
   * the raw filter match, and that split can only happen once every
   * candidate has been evaluated. See `CompetitionLifecycleService.preview`.
   * Ordered by `id` for a stable, deterministic slice across calls.
   */
  static async findLifecycleCandidates(
    plan: CompetitionSearchPlan,
  ): Promise<LifecycleRow[]> {
    const { where } = buildCompetitionQuery(plan);

    return prisma.competition.findMany({
      where,
      select: LIFECYCLE_ROW_SELECT,
      orderBy: { id: "asc" },
    });
  }

  /**
   * Re-reads exactly the requested rows, for the apply step's revalidation.
   * Deliberately takes no `where` beyond the id list — every other
   * eligibility condition (deleted, disabled, CANCELLED) is decided by the
   * service from these fresh values, not by narrowing the query, so the
   * service can report *why* a row was skipped rather than just that it was
   * absent from the result.
   */
  static async findLifecycleByIds(
    ids: readonly string[],
  ): Promise<LifecycleRow[]> {
    return prisma.competition.findMany({
      where: { id: { in: [...ids] } },
      select: LIFECYCLE_ROW_SELECT,
    });
  }

  /**
   * One page of sweep candidates, cursor-paginated by `id`. Restricted at
   * the query level to rows the sweep could possibly need to touch — active,
   * automation enabled, not CANCELLED (including the NULL-safety on that
   * comparison — see `NON_CANCELLED_CLAUSE` in `search/plan.ts`) and known
   * to have at least one lifecycle date — so a table of mostly-irrelevant
   * rows does not have to be paged through in full.
   */
  static async streamSweepBatch(
    cursor: string | null,
    batchSize: number,
  ): Promise<LifecycleRow[]> {
    return prisma.competition.findMany({
      where: {
        deletedAt: null,
        automaticStatusUpdatesDisabled: false,
        OR: [{ status: null }, { status: { not: "CANCELLED" } }],
        AND: [
          {
            OR: [
              { registrationStartDate: { not: null } },
              { registrationDeadline: { not: null } },
              { startDate: { not: null } },
              { endDate: { not: null } },
            ],
          },
        ],
      },
      select: LIFECYCLE_ROW_SELECT,
      orderBy: { id: "asc" },
      take: batchSize,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });
  }

  /**
   * Applies one `(from -> to)` status transition to a group of rows, guarded
   * by compare-and-set: the `where` re-asserts `status: from` and the two
   * automatic-eligibility conditions, so a row another admin or the cron
   * already moved (or disabled, or deleted) between the caller's read and
   * this write is simply left untouched — `result.count` reports the truth.
   *
   * Never touches `updatedById` — automatic lifecycle changes are not
   * attributed to a human. `updatedAt` is bumped by Prisma's `@updatedAt`
   * as normal.
   */
  static async applyStatusGroup(
    tx: Prisma.TransactionClient,
    ids: readonly string[],
    from: CompetitionStatus | null,
    to: CompetitionStatus | null,
    now: Date,
  ): Promise<{ count: number }> {
    return tx.competition.updateMany({
      where: {
        id: { in: [...ids] },
        status: from,
        automaticStatusUpdatesDisabled: false,
        deletedAt: null,
      },
      data: { status: to, statusUpdatedAt: now },
    });
  }

  /**
   * Reconciles a single row within an existing transaction — used by
   * `CompetitionService.update` immediately after a date edit or an
   * automation re-enable. No compare-and-set guard is needed here: the row
   * was already written earlier in the same transaction, so its lock is
   * already held and no concurrent writer can have raced it.
   */
  static async reconcileRow(
    tx: Prisma.TransactionClient,
    id: string,
    status: CompetitionStatus | null,
    now: Date,
  ) {
    return tx.competition.update({
      where: { id },
      data: { status, statusUpdatedAt: now },
    });
  }
}
