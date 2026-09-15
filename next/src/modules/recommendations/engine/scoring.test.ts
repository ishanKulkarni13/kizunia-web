import { describe, expect, it } from "vitest";
import { WeightedCoverageScorer } from "./scoring";
import { normalizeProfile } from "./profile";
import { DimensionId } from "./types";
import { buildCandidate, entry } from "./test-helpers";

const ALL_ENABLED = new Set(Object.values(DimensionId));

const SYSTEM_WEIGHTS = {
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
} as const;

function score(
  profileEntries: Parameters<typeof normalizeProfile>[0],
  candidate: ReturnType<typeof buildCandidate>,
  enabledDimensions = ALL_ENABLED,
) {
  const profile = normalizeProfile(profileEntries);
  return WeightedCoverageScorer.score({
    profile,
    candidate,
    signals: [],
    systemWeights: SYSTEM_WEIGHTS,
    enabledDimensions,
  });
}

describe("WeightedCoverageScorer", () => {
  it("returns 0 when the user has no active preferences at all", () => {
    const result = score([], buildCandidate({ categorySlugs: ["ai"] }));
    expect(result.score).toBe(0);
    expect(result.contributions).toHaveLength(0);
  });

  it("scores a full match at 1", () => {
    const result = score(
      [entry(DimensionId.CATEGORIES, "ai", 1)],
      buildCandidate({ categorySlugs: ["ai"] }),
    );
    expect(result.score).toBe(1);
  });

  it("a mismatch scores lower than a match", () => {
    const match = score(
      [entry(DimensionId.CATEGORIES, "ai", 0.8)],
      buildCandidate({ categorySlugs: ["ai"] }),
    );
    const mismatch = score(
      [entry(DimensionId.CATEGORIES, "ai", 0.8)],
      buildCandidate({ categorySlugs: ["web-dev"] }),
    );

    expect(mismatch.score).toBeLessThan(match.score);
    expect(mismatch.score).toBe(0);
  });

  it("missing competition data scores the same as a mismatch", () => {
    const mismatch = score(
      [entry(DimensionId.CATEGORIES, "ai", 0.8)],
      buildCandidate({ categorySlugs: ["web-dev"] }),
    );
    const missing = score(
      [entry(DimensionId.CATEGORIES, "ai", 0.8)],
      buildCandidate({ categorySlugs: [] }),
    );

    expect(missing.score).toBe(mismatch.score);
  });

  it("a higher user weight raises the score of a mixed match", () => {
    const candidate = buildCandidate({ categorySlugs: ["ai"], technologySlugs: [] });

    const lowUserWeight = score(
      [
        entry(DimensionId.CATEGORIES, "ai", 0.9),
        entry(DimensionId.TECHNOLOGIES, "python", 0.2), // mismatch, low weight
      ],
      candidate,
    );
    const highUserWeight = score(
      [
        entry(DimensionId.CATEGORIES, "ai", 0.9),
        entry(DimensionId.TECHNOLOGIES, "python", 0.9), // mismatch, high weight
      ],
      candidate,
    );

    // A heavier mismatched dimension drags the average down more.
    expect(highUserWeight.score).toBeLessThan(lowUserWeight.score);
  });

  it("system weight changes how much a dimension's match/mismatch moves the score", () => {
    const candidate = buildCandidate({ categorySlugs: ["web-dev"], mode: "ONLINE" });
    const profileEntries = [
      entry(DimensionId.CATEGORIES, "ai", 0.8), // mismatch
      entry(DimensionId.MODE, "ONLINE", 0.8), // match
    ];

    const withNormalWeights = score(profileEntries, candidate);

    const categoriesDominant = {
      ...SYSTEM_WEIGHTS,
      [DimensionId.CATEGORIES]: 5.0,
    };
    const profile = normalizeProfile(profileEntries);
    const withCategoriesDominant = WeightedCoverageScorer.score({
      profile,
      candidate,
      signals: [],
      systemWeights: categoriesDominant,
      enabledDimensions: ALL_ENABLED,
    });

    // Weighting the mismatched dimension much more heavily must pull the
    // overall score down relative to the balanced case.
    expect(withCategoriesDominant.score).toBeLessThan(withNormalWeights.score);
  });

  it("a dimension the user has no preference in never lowers the score", () => {
    const candidate = buildCandidate({ categorySlugs: ["ai"] }); // certificateType: null (missing)

    const result = score([entry(DimensionId.CATEGORIES, "ai", 1)], candidate);

    // Only `categories` is active; certificateType being unset/missing must
    // not contribute at all, so a full category match still scores 1.
    expect(result.score).toBe(1);
    expect(result.contributions.map((c) => c.dimension)).toEqual([DimensionId.CATEGORIES]);
  });

  it("a disabled dimension is excluded from scoring even if the user has a preference in it", () => {
    const candidate = buildCandidate({ categorySlugs: ["web-dev"] }); // would mismatch
    const enabled = new Set(
      [...ALL_ENABLED].filter((d) => d !== DimensionId.CATEGORIES),
    );

    const result = score([entry(DimensionId.CATEGORIES, "ai", 1)], candidate, enabled);

    expect(result.score).toBe(0);
    expect(result.contributions).toHaveLength(0);
  });

  it("stays within [0, 1] across a mix of matches and mismatches", () => {
    const candidate = buildCandidate({
      categorySlugs: ["ai"],
      technologySlugs: ["java"],
      mode: "OFFLINE",
    });

    const result = score(
      [
        entry(DimensionId.CATEGORIES, "ai", 1),
        entry(DimensionId.TECHNOLOGIES, "python", 0.9),
        entry(DimensionId.MODE, "ONLINE", 0.5),
      ],
      candidate,
    );

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it("treats a hard dimension as a guaranteed full-strength match, not re-scored", () => {
    const candidate = buildCandidate({ eligibilityTypes: ["UNDERGRADUATE"] });

    const result = score([entry(DimensionId.ELIGIBILITIES, "UNDERGRADUATE", 1)], candidate);

    expect(result.score).toBe(1);
    expect(result.contributions[0].signal.outcome).toBe("MATCH");
    expect(result.contributions[0].signal.strength).toBe(1);
  });
});
