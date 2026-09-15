import { describe, expect, it } from "vitest";
import { evaluateEligibility } from "./eligibility";
import { normalizeProfile } from "./profile";
import { COMPETITION_DIMENSIONS } from "./dimensions/registry";
import { DimensionId } from "./types";
import { buildCandidate, entry } from "./test-helpers";

const ALL_ENABLED = new Set(Object.values(DimensionId));

describe("evaluateEligibility", () => {
  it("passes when a hard constraint matches", () => {
    const profile = normalizeProfile([entry(DimensionId.ELIGIBILITIES, "UNDERGRADUATE", 1)]);
    const candidate = buildCandidate({ eligibilityTypes: ["UNDERGRADUATE"] });

    const result = evaluateEligibility(profile, candidate, COMPETITION_DIMENSIONS, ALL_ENABLED);

    expect(result.eligible).toBe(true);
  });

  it("rejects when a hard constraint mismatches", () => {
    const profile = normalizeProfile([entry(DimensionId.ELIGIBILITIES, "UNDERGRADUATE", 1)]);
    const candidate = buildCandidate({ eligibilityTypes: ["POSTGRADUATE"] });

    const result = evaluateEligibility(profile, candidate, COMPETITION_DIMENSIONS, ALL_ENABLED);

    expect(result.eligible).toBe(false);
    expect(result.rejection).toEqual({
      dimension: DimensionId.ELIGIBILITIES,
      reason: "HARD_MISMATCH",
    });
  });

  it("rejects when a hard constraint's competition data is missing", () => {
    const profile = normalizeProfile([entry(DimensionId.ELIGIBILITIES, "UNDERGRADUATE", 1)]);
    const candidate = buildCandidate({ eligibilityTypes: [] });

    const result = evaluateEligibility(profile, candidate, COMPETITION_DIMENSIONS, ALL_ENABLED);

    expect(result.eligible).toBe(false);
    expect(result.rejection).toEqual({
      dimension: DimensionId.ELIGIBILITIES,
      reason: "HARD_MISSING",
    });
  });

  it("does not reject on a soft mismatch — only hard dimensions are checked", () => {
    const profile = normalizeProfile([
      entry(DimensionId.CATEGORIES, "ai", 0.8), // soft
      entry(DimensionId.ELIGIBILITIES, "UNDERGRADUATE", 1), // hard
    ]);
    const candidate = buildCandidate({
      categorySlugs: ["web-dev"], // soft mismatch
      eligibilityTypes: ["UNDERGRADUATE"], // hard match
    });

    const result = evaluateEligibility(profile, candidate, COMPETITION_DIMENSIONS, ALL_ENABLED);

    expect(result.eligible).toBe(true);
  });

  it("ignores a hard dimension that has been disabled", () => {
    const profile = normalizeProfile([entry(DimensionId.ELIGIBILITIES, "UNDERGRADUATE", 1)]);
    const candidate = buildCandidate({ eligibilityTypes: ["POSTGRADUATE"] });

    const enabled = new Set(
      [...ALL_ENABLED].filter((d) => d !== DimensionId.ELIGIBILITIES),
    );

    const result = evaluateEligibility(profile, candidate, COMPETITION_DIMENSIONS, enabled);

    expect(result.eligible).toBe(true);
  });

  it("is eligible with no hard constraints at all", () => {
    const profile = normalizeProfile([entry(DimensionId.CATEGORIES, "ai", 0.5)]);
    const candidate = buildCandidate();

    const result = evaluateEligibility(profile, candidate, COMPETITION_DIMENSIONS, ALL_ENABLED);

    expect(result.eligible).toBe(true);
  });
});
