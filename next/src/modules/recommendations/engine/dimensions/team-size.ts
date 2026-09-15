/**
 * Recommendation Engine — Team Size Dimension (PURE)
 *
 * =============================================================================
 * Why this dimension overrides `match`
 * =============================================================================
 *
 * Every other dimension asks "does the candidate carry one of the values I
 * prefer" — plain set intersection. Team size asks a containment question
 * instead: "can a team of my declared size actually enter this
 * competition", which is exactly the question
 * `search/team-size-clause.ts` answers for explicit search. This dimension
 * reuses that same containment semantics — a null bound means the organizer
 * declared no limit on that side, not "unknown" — rather than re-deriving
 * a different rule for recommendations. It cannot reuse the Prisma clause
 * itself (the engine is pure and has no query builder), so the containment
 * check is re-expressed here in plain arithmetic; if the search-side rule
 * ever changes, this needs to change with it.
 *
 * =============================================================================
 * The one deliberate exception to "missing = mismatch"
 * =============================================================================
 *
 * A competition with no `minTeamSize`/`maxTeamSize` at all is not "unknown
 * data" here — the domain already treats a fully-open pair as "this
 * competition imposes no restriction", which is evidence *for* a match, not
 * an absence of evidence. So an unconstrained competition is a MATCH at the
 * user's full preference strength, not a MISSING. Every other dimension in
 * Phase 0 treats `null` as MISSING; this is the one field where the domain
 * itself defines what an absent value means, and that meaning is not
 * "unknown". See `docs/architecture/recommendation/dimensions.md`.
 *
 * A preference value is the participant's own team size, encoded as the
 * decimal string of a positive integer (e.g. `"4"`).
 */
import {
  DimensionId,
  type DimensionPreference,
  type DimensionSignal,
  type RecommendationCandidate,
  type RecommendationDimension,
} from "../types";

function contains(
  min: number | null,
  max: number | null,
  size: number,
): boolean {
  const effectiveMin = min ?? 1;
  const effectiveMax = max ?? Number.POSITIVE_INFINITY;
  return effectiveMin <= size && size <= effectiveMax;
}

function match(
  preference: DimensionPreference,
  candidate: RecommendationCandidate,
): DimensionSignal {
  const { minTeamSize, maxTeamSize } = candidate;
  const unconstrained = minTeamSize === null && maxTeamSize === null;

  let bestWeight = 0;
  const consideredSizes: string[] = [];

  for (const [rawSize, weight] of preference.values) {
    const size = Number.parseInt(rawSize, 10);
    if (!Number.isFinite(size)) continue;

    consideredSizes.push(rawSize);

    if (unconstrained || contains(minTeamSize, maxTeamSize, size)) {
      if (weight > bestWeight) bestWeight = weight;
    }
  }

  if (consideredSizes.length === 0) {
    // No parseable preference value — nothing to evaluate against.
    return {
      dimension: DimensionId.TEAM_SIZE,
      outcome: "MISMATCH",
      strength: 0,
      candidateValues: [],
    };
  }

  const candidateValues = [
    minTeamSize !== null ? `min:${minTeamSize}` : "min:unset",
    maxTeamSize !== null ? `max:${maxTeamSize}` : "max:unset",
  ];

  return {
    dimension: DimensionId.TEAM_SIZE,
    outcome: bestWeight > 0 ? "MATCH" : "MISMATCH",
    strength: bestWeight > 0 ? bestWeight / preference.userStrength : 0,
    candidateValues,
  };
}

export const teamSizeDimension: RecommendationDimension = {
  id: DimensionId.TEAM_SIZE,
  // Not used for matching (see `match` above), but still required so
  // diagnostics/tests can ask "what did this candidate carry" uniformly.
  extract: (candidate) =>
    candidate.minTeamSize === null && candidate.maxTeamSize === null
      ? null
      : [
          `min:${candidate.minTeamSize ?? "unset"}`,
          `max:${candidate.maxTeamSize ?? "unset"}`,
        ],
  match,
};
