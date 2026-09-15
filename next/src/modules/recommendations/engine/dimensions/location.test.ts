import { describe, expect, it } from "vitest";
import { evaluateDimension } from "./dimension";
import { locationDimension } from "./location";
import { normalizeProfile } from "../profile";
import { DimensionId } from "../types";
import { buildCandidate, entry } from "../test-helpers";

function preferenceFor(searchAreaId: string, weight = 0.8) {
  return normalizeProfile([entry(DimensionId.LOCATION, searchAreaId, weight)]).get(
    DimensionId.LOCATION,
  )!;
}

describe("locationDimension", () => {
  it("matches when the candidate carries the preferred search area", () => {
    const candidate = buildCandidate({ searchAreaIds: ["pune", "maharashtra", "india"] });
    const signal = evaluateDimension(locationDimension, preferenceFor("pune"), candidate);

    expect(signal.outcome).toBe("MATCH");
  });

  it("mismatches when the candidate's location resolves to a different area entirely", () => {
    const candidate = buildCandidate({ searchAreaIds: ["bangalore", "karnataka", "india"] });
    const signal = evaluateDimension(locationDimension, preferenceFor("pune"), candidate);

    expect(signal.outcome).toBe("MISMATCH");
  });

  it("is missing when the competition has no location at all", () => {
    const candidate = buildCandidate({ searchAreaIds: [] });
    const signal = evaluateDimension(locationDimension, preferenceFor("pune"), candidate);

    expect(signal.outcome).toBe("MISSING");
  });

  it("expands downward: preferring the broad area matches a narrower competition", () => {
    // "maharashtra" contains "pune" in the materialized containment set, so a
    // Pune-only competition's searchAreaIds already includes "maharashtra".
    const candidate = buildCandidate({ searchAreaIds: ["pune", "maharashtra", "india"] });
    const signal = evaluateDimension(locationDimension, preferenceFor("maharashtra"), candidate);

    expect(signal.outcome).toBe("MATCH");
  });

  it("never expands upward: preferring the narrow area does not match a broader-only competition", () => {
    // The competition only resolved to "maharashtra" (e.g. a state-wide
    // event), never linked to "pune" specifically.
    const candidate = buildCandidate({ searchAreaIds: ["maharashtra", "india"] });
    const signal = evaluateDimension(locationDimension, preferenceFor("pune"), candidate);

    expect(signal.outcome).toBe("MISMATCH");
  });

  it("performs no distance/coordinate computation — the candidate shape has no coordinates", () => {
    const candidate = buildCandidate({ searchAreaIds: ["pune"] });

    // TypeScript enforces this structurally: `RecommendationCandidate` has
    // no latitude/longitude field, so there is nothing a distance
    // calculation could read even if one were added here by mistake.
    expect((candidate as unknown as Record<string, unknown>).latitude).toBeUndefined();
    expect((candidate as unknown as Record<string, unknown>).longitude).toBeUndefined();

    const signal = evaluateDimension(locationDimension, preferenceFor("pune"), candidate);
    expect(signal.outcome).toBe("MATCH");
  });
});
