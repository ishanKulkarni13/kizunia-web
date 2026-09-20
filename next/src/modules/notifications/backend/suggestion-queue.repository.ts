/**
 * Notifications — Suggestion Queue Repository
 *
 * Database Layer
 *
 * The two reads the admin notice needs: which suggestions are sitting in the
 * review queue, and who reviews them.
 *
 * Its own queries rather than calls into `CompetitionSuggestionService`,
 * following the boundary rule this repository tree already follows twice
 * (`module-boundaries.md`, and the same note atop
 * `recommendations/backend/candidate.repository.ts`): a consumer defines the
 * read contract it needs rather than pushing a notification-shaped query into
 * another module or borrowing its internals.
 *
 * There is a second, sharper reason here. `CompetitionSuggestionService`'s
 * reads all take a `StrictAuthorizationActor` and run an authorizer, because
 * they answer "may *this person* see this?". A sweep has no person. Calling
 * those methods would mean inventing a synthetic admin actor to satisfy a check
 * that is not the one being made — and a fake actor circulating through the
 * authorization layer is precisely the kind of shortcut that later gets reused
 * somewhere it is not safe.
 *
 * Responsibilities
 * ----------------
 * ✓ Find suggestions awaiting review inside a bounded window
 * ✓ Find the users who may review them, in pages
 * ✓ Read one suggestion's current state for re-validation
 *
 * Does NOT
 * ----------------
 * ✗ Decide whether a notice is still warranted — that is the policy's job
 * ✗ Decide who *should* be told, as opposed to who *may* review
 * ✗ Create, render or deliver anything
 */
import { PlatformAction } from "@/authorization/platform/actions";
import { rolesWithAction } from "@/authorization/platform/roles-with-action";
import { NotificationIntent, SuggestionStatus } from "@/generated/prisma";
import prisma from "@/lib/prisma";

export interface PendingSuggestion {
  readonly id: string;
  /** Never null — the query requires it. Narrowed here so callers need no guard. */
  readonly submittedAt: Date;
}

export interface SuggestionReviewState {
  readonly id: string;
  readonly suggestionTitle: string;
  readonly status: SuggestionStatus;
  readonly deletedAt: Date | null;
  readonly reviewedAt: Date | null;
  readonly submittedAt: Date | null;
  readonly submittedById: string;
  readonly submittedByName: string | null;
}

export interface ReviewerPage {
  readonly id: string;
  /** Resolved against the default, so the caller never sees "no row". */
  readonly intentEnabled: boolean;
}

/**
 * The roles that receive these notices.
 *
 * Computed once at module load from the permission set, not written out: the
 * recipient list *is* "whoever may review suggestions", and restating it as
 * role names would create a second definition free to drift from the first.
 */
const REVIEWER_ROLES = rolesWithAction(
  PlatformAction.REVIEW_COMPETITION_SUGGESTIONS,
);

export class SuggestionQueueRepository {
  /**
   * Suggestions that have been waiting at least `submittedBefore`, and no
   * longer than `submittedAfter` ago.
   *
   * The lower bound is the notice delay; the upper bound stops a first
   * deployment from sweeping up a pre-existing backlog. Both are computed by
   * the caller from the frozen anchor, never from this layer's clock.
   *
   * Ordered and paged by id, matching every other keyset scan in this
   * subsystem: stable, unique and indexed, so pagination stays correct while
   * suggestions are being submitted underneath it. Ordering by `submittedAt`
   * would be more meaningful to read and less correct to page.
   */
  static async findAwaitingReview(input: {
    readonly submittedAfter: Date;
    readonly submittedBefore: Date;
    readonly take: number;
    readonly cursor?: string;
  }): Promise<PendingSuggestion[]> {
    const rows = await prisma.competitionSuggestion.findMany({
      where: {
        status: SuggestionStatus.UNDER_REVIEW,
        deletedAt: null,
        reviewedAt: null,
        submittedAt: {
          gte: input.submittedAfter,
          lte: input.submittedBefore,
        },
        ...(input.cursor ? { id: { gt: input.cursor } } : {}),
      },
      select: { id: true, submittedAt: true },
      orderBy: { id: "asc" },
      take: input.take,
    });

    // `submittedAt` is non-null by construction — the `gte`/`lte` filter cannot
    // match a null — but Prisma types it optional because the column is. The
    // filter keeps the type honest without an assertion.
    return rows.flatMap((row) =>
      row.submittedAt ? [{ id: row.id, submittedAt: row.submittedAt }] : [],
    );
  }

  /**
   * One suggestion's current state, for re-validation at notice time.
   *
   * Deliberately re-read rather than carried in the job payload. The payload
   * freezes the *occasion* (ND-D-07); it must not freeze the *state*, because
   * the entire value of the notice delay is that state may have changed since
   * — and a notice about a suggestion someone already reviewed is worse than no
   * notice at all (ND-D-12).
   */
  static async findReviewState(
    suggestionId: string,
  ): Promise<SuggestionReviewState | null> {
    const row = await prisma.competitionSuggestion.findUnique({
      where: { id: suggestionId },
      select: {
        id: true,
        suggestionTitle: true,
        status: true,
        deletedAt: true,
        reviewedAt: true,
        submittedAt: true,
        submittedById: true,
        submittedBy: { select: { name: true } },
      },
    });

    if (!row) return null;

    return {
      id: row.id,
      suggestionTitle: row.suggestionTitle,
      status: row.status,
      deletedAt: row.deletedAt,
      reviewedAt: row.reviewedAt,
      submittedAt: row.submittedAt,
      submittedById: row.submittedById,
      submittedByName: row.submittedBy?.name ?? null,
    };
  }

  /**
   * One page of users who may review suggestions, with this intent's state
   * resolved.
   *
   * Reads **users**, then their preference row, rather than reading preference
   * rows — the inversion the announcement fan-out makes, and for the same
   * reason: this intent defaults *on*, so most recipients have no row at all
   * and a query over preferences would find almost nobody.
   *
   * Unlike the announcement query, the opt-out is fetched rather than expressed
   * as a `NOT ... some` exclusion. The policy decides whether an opted-out
   * recipient is skipped; doing it in SQL would put half of one decision in the
   * database and half in a pure function, which is exactly the split this
   * module's `policy/` ÷ `backend/` boundary exists to prevent.
   */
  static async findReviewersPage(input: {
    readonly take: number;
    readonly cursor: string | null;
  }): Promise<ReviewerPage[]> {
    const rows = await prisma.user.findMany({
      where: {
        role: { in: [...REVIEWER_ROLES] },
        status: "ACTIVE",
        banned: { not: true },
        ...(input.cursor ? { id: { gt: input.cursor } } : {}),
      },
      select: {
        id: true,
        notificationPreferences: {
          where: { intent: NotificationIntent.ADMIN_COMPETITION_SUGGESTION },
          select: { enabled: true },
          take: 1,
        },
      },
      orderBy: { id: "asc" },
      take: input.take,
    });

    return rows.map((row) => ({
      id: row.id,
      // No row means enabled: this intent is operational, and an admin who has
      // never visited their notification settings should still hear about work
      // arriving in their queue (ND-P-16's reasoning, applied to a role-scoped
      // intent rather than an editorial one).
      intentEnabled: row.notificationPreferences[0]?.enabled ?? true,
    }));
  }

  /** The roles this notice reaches. Exposed for tests and diagnostics. */
  static reviewerRoles(): readonly string[] {
    return REVIEWER_ROLES;
  }
}
