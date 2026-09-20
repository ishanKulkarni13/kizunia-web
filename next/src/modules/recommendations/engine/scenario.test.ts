/**
 * The controlled scenario from the Phase 0 product brief, used to validate
 * the engine's end-to-end behavior conceptually — not to pin exact score
 * values, which are an implementation detail of the current formula.
 *
 * This profile intentionally mirrors `backend/preference-profile.provider.ts`'s
 * `DUMMY_PROFILE` (duplicated here rather than imported, so this pure-engine
 * test has no dependency on `backend/`).
 */
import { describe, expect, it } from "vitest";
import { runRecommendationPipeline } from "./pipeline";
import { normalizeProfile } from "./profile";
import { WeightedCoverageScorer } from "./scoring";
import { DimensionId, type RecommendationConfig } from "./types";
import { buildCandidate, entry } from "./test-helpers";

const PROFILE = normalizeProfile([
  // 0.9, not 1.0 — kept soft on purpose, see DUMMY_PROFILE's own comment in
  // `backend/preference-profile.provider.ts`.
  entry(DimensionId.CATEGORIES, "ai", 0.9),
  entry(DimensionId.CATEGORIES, "web-dev", 0.4),
  entry(DimensionId.TECHNOLOGIES, "python", 0.6),
  entry(DimensionId.REGISTRATION_FEE_TYPE, "FREE", 0.8),
  entry(DimensionId.DIFFICULTY, "INTERMEDIATE", 0.5),
  entry(DimensionId.ELIGIBILITIES, "UNDERGRADUATE", 1.0),
]);

const SYSTEM_WEIGHTS: Record<DimensionId, number> = {
  [DimensionId.CATEGORIES]: 1.0,
  [DimensionId.TECHNOLOGIES]: 0.9,
  [DimensionId.LOCATION]: 0.8,
  [DimensionId.ELIGIBILITIES]: 0.8,
  [DimensionId.MODE]: 0.7,
  [DimensionId.REGISTRATION_FEE_TYPE]: 0.6,
  [DimensionId.DIFFICULTY]: 0.5,
  [DimensionId.REGISTRATION_TYPE]: 0.5,
  [DimensionId.TEAM_SIZE]: 0.5,
  [DimensionId.STATUS]: 0.4,
  [DimensionId.ORGANIZER_TYPE]: 0.3,
  [DimensionId.REGISTRATION_PLATFORM]: 0.3,
  [DimensionId.CERTIFICATE_TYPE]: 0.2,
};

const CONFIG: RecommendationConfig = {
  enabledDimensions: new Set(Object.values(DimensionId)),
  systemWeights: SYSTEM_WEIGHTS,
  threshold: 0.5,
  topN: 5,
  candidateLimit: 500,
  scorer: WeightedCoverageScorer,
};

describe("controlled scenario: AI / Free / Intermediate / Undergraduate-only", () => {
  const competitionA = buildCandidate({
    id: "A-full-match",
    categorySlugs: ["ai"],
    technologySlugs: ["python"],
    registrationFeeType: "FREE",
    difficulty: "INTERMEDIATE",
    eligibilityTypes: ["UNDERGRADUATE"],
    searchAreaIds: ["pune"],
  });

  const competitionB = buildCandidate({
    id: "B-strong-different-tech",
    categorySlugs: ["ai"],
    technologySlugs: ["java"], // mismatch
    registrationFeeType: "FREE",
    difficulty: "INTERMEDIATE",
    eligibilityTypes: ["UNDERGRADUATE"],
    searchAreaIds: ["mumbai"],
  });

  const competitionC = buildCandidate({
    id: "C-moderate-off-topic",
    categorySlugs: ["web-dev"], // soft match, but the user's weaker preference (0.4 vs ai's 1.0)
    technologySlugs: [], // missing — no technology signal at all
    registrationFeeType: "FREE",
    eligibilityTypes: ["UNDERGRADUATE"],
  });

  const competitionD = buildCandidate({
    id: "D-hard-rejected",
    categorySlugs: ["ai"],
    registrationFeeType: "FREE",
    eligibilityTypes: ["POSTGRADUATE"], // violates the hard UG constraint
  });

  const competitionE = buildCandidate({
    id: "E-unrelated",
    categorySlugs: ["blockchain"],
    technologySlugs: ["solidity"],
    registrationFeeType: "PAID",
    eligibilityTypes: ["UNDERGRADUATE"], // still passes the hard constraint
  });

  const { ranked, diagnostics } = runRecommendationPipeline({
    profile: PROFILE,
    candidates: [competitionA, competitionB, competitionC, competitionD, competitionE],
    config: CONFIG,
  });

  it("ranks A above B above C", () => {
    const order = ranked.map((r) => r.candidateId);
    expect(order.indexOf("A-full-match")).toBeLessThan(order.indexOf("B-strong-different-tech"));
    expect(order.indexOf("B-strong-different-tech")).toBeLessThan(
      order.indexOf("C-moderate-off-topic"),
    );
  });

  it("hard-rejects D for violating the undergraduate-only constraint", () => {
    expect(ranked.map((r) => r.candidateId)).not.toContain("D-hard-rejected");

    const trace = diagnostics.traces.find((t) => t.candidateId === "D-hard-rejected")!;
    expect(trace.rejection).toEqual({
      kind: "HARD_CONSTRAINT",
      dimension: DimensionId.ELIGIBILITIES,
    });
  });

  it("does not recommend E — it clears no meaningful preference", () => {
    expect(ranked.map((r) => r.candidateId)).not.toContain("E-unrelated");
  });

  it("A's score is a strong match — every active dimension it carries matches", () => {
    const aRank = ranked.find((r) => r.candidateId === "A-full-match")!;
    expect(aRank.score).toBeGreaterThan(0.9);
  });
});
