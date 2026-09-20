/**
 * Notifications — Deadline Window Repository
 *
 * Database Layer
 *
 * The reads the deadline intent needs: which competitions close inside this
 * sweep's window, and which of them this user has saved or already registered
 * for.
 *
 * Its own query rather than a call into the competitions module's search
 * service, following the same boundary rule the recommendation module follows:
 * a consumer defines the read contract it needs, rather than pushing a
 * notification-shaped query into another module or borrowing its internals
 * (`module-boundaries.md`). The one thing it does reuse is
 * `competitionMapper.toCardDTO` — the *public* shape of a competition, which is
 * exactly the kind of thing modules are supposed to share.
 *
 * Responsibilities
 * ----------------
 * ✓ Build and execute the window and relationship queries
 * ✓ Map rows to the established public card shape
 *
 * Does NOT
 * ----------------
 * ✗ Decide eligibility, ranking, or how many to include
 */
import { CompetitionVisibility, type Prisma } from "@/generated/prisma";
import prisma from "@/lib/prisma";
import { competitionMapper } from "@/modules/competitions/backend/mapper";
import type { CompetitionCardDTO } from "@/modules/competitions/types/dto";

const CARD_INCLUDE = {
  logoAsset: true,
  coverAsset: true,
  locations: { include: { location: true } },
  types: true,
} satisfies Prisma.CompetitionInclude;

export interface ClosingCompetition {
  readonly competitionId: string;
  readonly deadline: Date;
  readonly card: CompetitionCardDTO;
}

export class DeadlineWindowRepository {
  /**
   * Competitions whose registration closes inside `[start, end)`.
   *
   * Half-open on purpose: consecutive sweeps tile without a gap or an overlap,
   * so every deadline is evaluated exactly once (ND-I-19).
   *
   * Deleted and non-public competitions are excluded here rather than filtered
   * later — telling a user about something they cannot see would be a
   * disclosure, not merely a wasted notification.
   *
   * Bounded by `limit`. A window containing an implausible number of deadlines
   * is a data problem, and loading all of it into memory for every user would
   * turn that problem into an outage.
   */
  static async findClosingBetween(input: {
    start: Date;
    end: Date;
    limit: number;
  }): Promise<ClosingCompetition[]> {
    const rows = await prisma.competition.findMany({
      where: {
        registrationDeadline: { gte: input.start, lt: input.end },
        deletedAt: null,
        visibility: CompetitionVisibility.PUBLIC,
      },
      include: CARD_INCLUDE,
      orderBy: { registrationDeadline: "asc" },
      take: input.limit,
    });

    return rows.flatMap((row) =>
      row.registrationDeadline
        ? [
            {
              competitionId: row.id,
              deadline: row.registrationDeadline,
              card: competitionMapper.toCardDTO(row),
            },
          ]
        : [],
    );
  }

  /** Which of these the user has saved. */
  static async findBookmarkedIds(
    userId: string,
    competitionIds: readonly string[],
  ): Promise<Set<string>> {
    if (competitionIds.length === 0) return new Set();

    const rows = await prisma.competitionBookmark.findMany({
      where: { userId, competitionId: { in: [...competitionIds] } },
      select: { competitionId: true },
    });

    return new Set(rows.map((row) => row.competitionId));
  }

  /**
   * Which of these the user has told Kizunia they registered for.
   *
   * A self-declared relationship, never verified external registration data
   * (ND-I-16). It is used only to *stop* notifying, which is the one direction
   * in which trusting it unverified is harmless.
   */
  static async findRegisteredIds(
    userId: string,
    competitionIds: readonly string[],
  ): Promise<Set<string>> {
    if (competitionIds.length === 0) return new Set();

    const rows = await prisma.competitionRegistration.findMany({
      where: { userId, competitionId: { in: [...competitionIds] } },
      select: { competitionId: true },
    });

    return new Set(rows.map((row) => row.competitionId));
  }
}
