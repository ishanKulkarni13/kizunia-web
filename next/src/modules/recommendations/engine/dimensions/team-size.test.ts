import { describe, expect, it } from "vitest";
import { evaluateDimension } from "./dimension";
import { teamSizeDimension } from "./team-size";
import { normalizeProfile } from "../profile";
import { DimensionId } from "../types";
import { buildCandidate, entry } from "../test-helpers";

function preferenceFor(size: string, weight = 0.7) {
  return normalizeProfile([entry(DimensionId.TEAM_SIZE, size, weight)]).get(
    DimensionId.TEAM_SIZE,
  )!;
}

describe("teamSizeDimension", () => {
  it("matches when the requested size is within the competition's bounds", () => {
    const candidate = buildCandidate({ minTeamSize: 2, maxTeamSize: 5 });
    const signal = evaluateDimension(teamSizeDimension, preferenceFor("4"), candidate);

    expect(signal.outcome).toBe("MATCH");
  });

  it("mismatches when the requested size is below the competition's minimum", () => {
    const candidate = buildCandidate({ minTeamSize: 3, maxTeamSize: 5 });
    const signal = evaluateDimension(teamSizeDimension, preferenceFor("1"), candidate);

    expect(signal.outcome).toBe("MISMATCH");
  });

  it("mismatches when the requested size exceeds the competition's maximum", () => {
    const candidate = buildCandidate({ minTeamSize: 1, maxTeamSize: 2 });
    const signal = evaluateDimension(teamSizeDimension, preferenceFor("4"), candidate);

    expect(signal.outcome).toBe("MISMATCH");
  });

  it("treats a fully unconstrained competition as a match, not missing data", () => {
    // Deliberate exception to the general missing-data rule — see the
    // module docstring in `team-size.ts`.
    const candidate = buildCandidate({ minTeamSize: null, maxTeamSize: null });
    const signal = evaluateDimension(teamSizeDimension, preferenceFor("4"), candidate);

    expect(signal.outcome).toBe("MATCH");
  });

  it("treats an open-ended minimum (no floor) as accepting any size up to the max", () => {
    const candidate = buildCandidate({ minTeamSize: null, maxTeamSize: 4 });
    const signal = evaluateDimension(teamSizeDimension, preferenceFor("1"), candidate);

    expect(signal.outcome).toBe("MATCH");
  });

  it("treats an open-ended maximum (no ceiling) as accepting any size at or above the min", () => {
    const candidate = buildCandidate({ minTeamSize: 2, maxTeamSize: null });
    const signal = evaluateDimension(teamSizeDimension, preferenceFor("50"), candidate);

    expect(signal.outcome).toBe("MATCH");
  });
});
