/**
 * Recommendation Engine — Pipeline Orchestration (PURE)
 *
 * The one function that runs the whole conceptual pipeline once a caller
 * has a normalized profile and a candidate list in hand:
 *
 *   normalized profile + candidates
 *     -> eligibility (hard constraints)
 *     -> scoring
 *     -> threshold
 *     -> ranking
 *     -> top-N
 *     -> PipelineResult
 *
 * This function has no knowledge of Prisma, HTTP, or where its inputs came
 * from — see `backend/recommendation.service.ts` for the only caller, which
 * supplies `now` and both inputs. Because `now` is always injected (never
 * read from the clock in here), the pipeline is exercised in tests with
 * fixed inputs and no time-based flakiness, matching the convention already
 * established by `competitions/lifecycle/resolver.ts`.
 *
 * =============================================================================
 * The threshold-vs-Top-N invariant this function enforces
 * =============================================================================
 *
 * Threshold is a quality floor; Top-N is a quantity cap. They are applied in
 * that order and never traded against each other: if only two candidates
 * clear the threshold and `topN` is five, the result has two items — the
 * threshold is never relaxed to manufacture a fuller list. See
 * `pipeline.test.ts` for the pinned regression on this.
 */
import { evaluateEligibility } from "./eligibility";
import { rankCandidates, type ScoredCandidate } from "./ranking";
import { COMPETITION_DIMENSIONS } from "./dimensions/registry";
import type {
  DimensionId,
  NormalizedProfile,
  PipelineResult,
  RecommendationCandidate,
  RecommendationConfig,
  RecommendationDiagnostics,
  RecommendationTrace,
} from "./types";

export function runRecommendationPipeline(input: {
  readonly profile: NormalizedProfile;
  readonly candidates: readonly RecommendationCandidate[];
  readonly config: RecommendationConfig;
}): PipelineResult {
  const { profile, candidates, config } = input;

  // Built as a mutable shape internally (`BEYOND_TOP_N` is only knowable
  // after ranking, once Top-N has been applied) and frozen into
  // `RecommendationTrace`'s readonly shape at the end.
  type MutableTrace = {
    candidateId: string;
    score: number | null;
    rejection: RecommendationTrace["rejection"];
    contributions: RecommendationTrace["contributions"];
  };

  const traces: MutableTrace[] = [];
  const scored: ScoredCandidate[] = [];

  let rejectedByHardConstraint = 0;
  let belowThreshold = 0;

  for (const candidate of candidates) {
    const eligibility = evaluateEligibility(
      profile,
      candidate,
      COMPETITION_DIMENSIONS,
      config.enabledDimensions,
    );

    if (!eligibility.eligible) {
      rejectedByHardConstraint += 1;
      traces.push({
        candidateId: candidate.id,
        score: null,
        rejection: {
          kind: "HARD_CONSTRAINT",
          dimension: eligibility.rejection!.dimension,
        },
        contributions: [],
      });
      continue;
    }

    const result = config.scorer.score({
      profile,
      candidate,
      signals: eligibility.signals,
      systemWeights: config.systemWeights,
      enabledDimensions: config.enabledDimensions,
    });

    if (result.score < config.threshold) {
      belowThreshold += 1;
      traces.push({
        candidateId: candidate.id,
        score: result.score,
        rejection: { kind: "BELOW_THRESHOLD", score: result.score },
        contributions: result.contributions,
      });
      continue;
    }

    scored.push({ candidate, score: result.score });
    traces.push({
      candidateId: candidate.id,
      score: result.score,
      rejection: null,
      contributions: result.contributions,
    });
  }

  const ranked = rankCandidates(scored);
  const selected = ranked.slice(0, config.topN);
  const selectedIds = new Set(selected.map((s) => s.candidate.id));

  // Candidates that cleared the threshold but fell outside Top-N are a
  // distinct, named rejection reason — not silently indistinguishable from
  // "below threshold" in diagnostics.
  for (const trace of traces) {
    if (trace.rejection === null && !selectedIds.has(trace.candidateId)) {
      trace.rejection = { kind: "BEYOND_TOP_N" };
    }
  }

  const diagnostics: RecommendationDiagnostics = {
    candidatesEvaluated: candidates.length,
    rejectedByHardConstraint,
    belowThreshold,
    returned: selected.length,
    activeDimensions: activeDimensionSummary(profile, config),
    traces,
  };

  return {
    ranked: selected.map((s, index) => ({
      candidateId: s.candidate.id,
      score: s.score,
      rank: index + 1,
    })),
    diagnostics,
  };
}

function activeDimensionSummary(
  profile: NormalizedProfile,
  config: RecommendationConfig,
): RecommendationDiagnostics["activeDimensions"] {
  const summary: {
    dimension: DimensionId;
    userStrength: number;
    systemWeight: number;
    effectiveWeight: number;
  }[] = [];

  for (const [dimensionId, preference] of profile) {
    if (!config.enabledDimensions.has(dimensionId)) continue;

    const systemWeight = config.systemWeights[dimensionId] ?? 0;
    if (systemWeight <= 0) continue;

    summary.push({
      dimension: dimensionId,
      userStrength: preference.userStrength,
      systemWeight,
      effectiveWeight: systemWeight * preference.userStrength,
    });
  }

  return summary;
}
