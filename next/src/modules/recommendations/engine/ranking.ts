/**
 * Recommendation Engine — Ranking (PURE)
 *
 * Deterministic, total order over scored candidates:
 *
 *   1. score, descending
 *   2. registrationDeadline, ascending, nulls last
 *   3. startDate, ascending, nulls last
 *   4. id, ascending
 *
 * The date fields are used here purely as tiebreakers, exactly as
 * `CompetitionCardDTO`'s date fields are — never as a scored dimension (see
 * `engine/types.ts`'s docstring on `RecommendationCandidate`). Rule 4 is the
 * same final tiebreaker convention `competitionSortRegistry` uses
 * (`{ id: "asc" }`), so two candidates can never compare equal.
 *
 * No randomness anywhere in this module.
 */
import type { RecommendationCandidate } from "./types";

export interface ScoredCandidate {
  readonly candidate: RecommendationCandidate;
  readonly score: number;
}

export function rankCandidates(
  scored: readonly ScoredCandidate[],
): readonly ScoredCandidate[] {
  return [...scored].sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;

    const deadlineCompare = compareDatesAscNullsLast(
      a.candidate.registrationDeadline,
      b.candidate.registrationDeadline,
    );
    if (deadlineCompare !== 0) return deadlineCompare;

    const startCompare = compareDatesAscNullsLast(
      a.candidate.startDate,
      b.candidate.startDate,
    );
    if (startCompare !== 0) return startCompare;

    return a.candidate.id < b.candidate.id
      ? -1
      : a.candidate.id > b.candidate.id
        ? 1
        : 0;
  });
}

function compareDatesAscNullsLast(a: Date | null, b: Date | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.getTime() - b.getTime();
}
