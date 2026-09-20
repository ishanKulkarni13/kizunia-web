import { describe, expect, it } from "vitest";
import { runRecommendationPipeline } from "./pipeline";
import { normalizeProfile } from "./profile";
import { WeightedCoverageScorer } from "./scoring";
import { DimensionId, type RecommendationConfig } from "./types";
import { buildCandidate, entry } from "./test-helpers";

const SYSTEM_WEIGHTS: Record<DimensionId, number> = Object.fromEntries(
  Object.values(DimensionId).map((id) => [id, 1]),
) as Record<DimensionId, number>;

function config(overrides: Partial<RecommendationConfig> = {}): RecommendationConfig {
  return {
    enabledDimensions: new Set(Object.values(DimensionId)),
    systemWeights: SYSTEM_WEIGHTS,
    threshold: 0.5,
    topN: 5,
    candidateLimit: 500,
    scorer: WeightedCoverageScorer,
    ...overrides,
  };
}

describe("runRecommendationPipeline", () => {
  it("returns candidates that clear the threshold, ranked", () => {
    const profile = normalizeProfile([entry(DimensionId.CATEGORIES, "ai", 0.9)]);
    const candidates = [
      buildCandidate({ id: "match", categorySlugs: ["ai"] }),
      buildCandidate({ id: "mismatch", categorySlugs: ["web-dev"] }),
    ];

    const { ranked } = runRecommendationPipeline({ profile, candidates, config: config() });

    expect(ranked).toHaveLength(1);
    expect(ranked[0].candidateId).toBe("match");
  });

  it("excludes candidates that fail a hard constraint before scoring ever runs", () => {
    const profile = normalizeProfile([
      entry(DimensionId.CATEGORIES, "ai", 0.9),
      entry(DimensionId.ELIGIBILITIES, "UNDERGRADUATE", 1),
    ]);
    const candidates = [
      buildCandidate({
        id: "eligible",
        categorySlugs: ["ai"],
        eligibilityTypes: ["UNDERGRADUATE"],
      }),
      buildCandidate({
        id: "ineligible",
        categorySlugs: ["ai"], // would otherwise score well
        eligibilityTypes: ["POSTGRADUATE"],
      }),
    ];

    const { ranked, diagnostics } = runRecommendationPipeline({
      profile,
      candidates,
      config: config(),
    });

    expect(ranked.map((r) => r.candidateId)).toEqual(["eligible"]);
    expect(diagnostics.rejectedByHardConstraint).toBe(1);

    const ineligibleTrace = diagnostics.traces.find((t) => t.candidateId === "ineligible")!;
    expect(ineligibleTrace.score).toBeNull();
    expect(ineligibleTrace.rejection).toEqual({
      kind: "HARD_CONSTRAINT",
      dimension: DimensionId.ELIGIBILITIES,
    });
  });

  it("never lowers the threshold to fill Top-N", () => {
    const profile = normalizeProfile([entry(DimensionId.CATEGORIES, "ai", 0.9)]);
    const candidates = [
      buildCandidate({ id: "a", categorySlugs: ["ai"] }),
      buildCandidate({ id: "b", categorySlugs: ["ai"] }),
      buildCandidate({ id: "c", categorySlugs: ["web-dev"] }), // below threshold
      buildCandidate({ id: "d", categorySlugs: ["web-dev"] }), // below threshold
      buildCandidate({ id: "e", categorySlugs: ["web-dev"] }), // below threshold
    ];

    const { ranked, diagnostics } = runRecommendationPipeline({
      profile,
      candidates,
      config: config({ threshold: 0.6, topN: 5 }),
    });

    expect(ranked).toHaveLength(2);
    expect(diagnostics.belowThreshold).toBe(3);
  });

  it("caps results at topN even when more candidates clear the threshold", () => {
    const profile = normalizeProfile([entry(DimensionId.CATEGORIES, "ai", 0.9)]);
    const candidates = Array.from({ length: 5 }, (_, i) =>
      buildCandidate({ id: `c${i}`, categorySlugs: ["ai"] }),
    );

    const { ranked, diagnostics } = runRecommendationPipeline({
      profile,
      candidates,
      config: config({ threshold: 0.5, topN: 2 }),
    });

    expect(ranked).toHaveLength(2);
    expect(diagnostics.returned).toBe(2);

    const beyondTopN = diagnostics.traces.filter(
      (t) => t.rejection?.kind === "BEYOND_TOP_N",
    );
    expect(beyondTopN).toHaveLength(3);
  });

  it("excludes a disabled dimension from both eligibility and scoring", () => {
    const profile = normalizeProfile([
      entry(DimensionId.ELIGIBILITIES, "UNDERGRADUATE", 1), // would hard-reject
    ]);
    const candidate = buildCandidate({ id: "x", eligibilityTypes: ["POSTGRADUATE"] });

    const enabledWithoutEligibility = new Set(
      Object.values(DimensionId).filter((d) => d !== DimensionId.ELIGIBILITIES),
    );

    const { ranked } = runRecommendationPipeline({
      profile,
      candidates: [candidate],
      config: config({ enabledDimensions: enabledWithoutEligibility, threshold: 0 }),
    });

    // With eligibilities disabled, nothing hard-rejects it, and no active
    // dimension remains to score it below the (zero) threshold either.
    expect(ranked.map((r) => r.candidateId)).toEqual(["x"]);
  });

  it("reconciles diagnostics counts against the total candidates evaluated", () => {
    const profile = normalizeProfile([entry(DimensionId.CATEGORIES, "ai", 0.9)]);
    const candidates = [
      buildCandidate({ id: "a", categorySlugs: ["ai"] }), // returned
      buildCandidate({ id: "b", categorySlugs: ["ai"] }), // returned
      buildCandidate({ id: "c", categorySlugs: ["ai"] }), // beyond top-N
      buildCandidate({ id: "d", categorySlugs: ["web-dev"] }), // below threshold
    ];

    const { diagnostics } = runRecommendationPipeline({
      profile,
      candidates,
      config: config({ topN: 2, threshold: 0.5 }),
    });

    const beyondTopN = diagnostics.traces.filter(
      (t) => t.rejection?.kind === "BEYOND_TOP_N",
    ).length;

    expect(diagnostics.candidatesEvaluated).toBe(4);
    expect(
      diagnostics.rejectedByHardConstraint + diagnostics.belowThreshold + diagnostics.returned + beyondTopN,
    ).toBe(diagnostics.candidatesEvaluated);
  });

  it("returns an empty result, not everything, when the user has no active preferences", () => {
    const profile = normalizeProfile([]);
    const candidates = [buildCandidate({ id: "a" }), buildCandidate({ id: "b" })];

    const { ranked, diagnostics } = runRecommendationPipeline({
      profile,
      candidates,
      config: config(),
    });

    expect(ranked).toHaveLength(0);
    expect(diagnostics.belowThreshold).toBe(2);
    expect(diagnostics.activeDimensions).toHaveLength(0);
  });
});
