import { describe, expect, it } from "vitest";
import { evaluateDimension } from "./dimension";
import { listDimension, scalarDimension } from "./set-dimension";
import { normalizeProfile } from "../profile";
import { DimensionId } from "../types";
import { buildCandidate, entry } from "../test-helpers";

describe("scalarDimension", () => {
  const modeDimension = scalarDimension(DimensionId.MODE, (c) => c.mode);

  it("matches a single nullable scalar field", () => {
    const preference = normalizeProfile([entry(DimensionId.MODE, "ONLINE", 0.5)]).get(
      DimensionId.MODE,
    )!;
    const signal = evaluateDimension(modeDimension, preference, buildCandidate({ mode: "ONLINE" }));

    expect(signal.outcome).toBe("MATCH");
  });

  it("is missing when the scalar field is null", () => {
    const preference = normalizeProfile([entry(DimensionId.MODE, "ONLINE", 0.5)]).get(
      DimensionId.MODE,
    )!;
    const signal = evaluateDimension(modeDimension, preference, buildCandidate({ mode: null }));

    expect(signal.outcome).toBe("MISSING");
  });
});

describe("listDimension", () => {
  const categoriesDimension = listDimension(DimensionId.CATEGORIES, (c) => c.categorySlugs);

  it("matches when any preferred value is present in the list", () => {
    const preference = normalizeProfile([entry(DimensionId.CATEGORIES, "ai", 0.5)]).get(
      DimensionId.CATEGORIES,
    )!;
    const signal = evaluateDimension(
      categoriesDimension,
      preference,
      buildCandidate({ categorySlugs: ["ai", "web-dev"] }),
    );

    expect(signal.outcome).toBe("MATCH");
  });

  it("treats an empty list the same as no data (MISSING, not MISMATCH)", () => {
    const preference = normalizeProfile([entry(DimensionId.CATEGORIES, "ai", 0.5)]).get(
      DimensionId.CATEGORIES,
    )!;
    const signal = evaluateDimension(
      categoriesDimension,
      preference,
      buildCandidate({ categorySlugs: [] }),
    );

    expect(signal.outcome).toBe("MISSING");
  });

  it("mismatches when the list has values, none of which are preferred", () => {
    const preference = normalizeProfile([entry(DimensionId.CATEGORIES, "ai", 0.5)]).get(
      DimensionId.CATEGORIES,
    )!;
    const signal = evaluateDimension(
      categoriesDimension,
      preference,
      buildCandidate({ categorySlugs: ["web-dev"] }),
    );

    expect(signal.outcome).toBe("MISMATCH");
  });

  it("multiple values: matches at the best-matching value's relative strength", () => {
    // 0.8, not 1.0 — kept soft on purpose. A weight-1 value would trigger
    // hard-constraint dominance (`profile.test.ts`) and discard "web-dev"
    // entirely, which is not what this test is checking.
    const preference = normalizeProfile([
      entry(DimensionId.CATEGORIES, "ai", 0.8),
      entry(DimensionId.CATEGORIES, "web-dev", 0.4),
    ]).get(DimensionId.CATEGORIES)!;

    const strongMatch = evaluateDimension(
      categoriesDimension,
      preference,
      buildCandidate({ categorySlugs: ["ai"] }),
    );
    const weakerMatch = evaluateDimension(
      categoriesDimension,
      preference,
      buildCandidate({ categorySlugs: ["web-dev"] }),
    );

    expect(strongMatch.strength).toBeCloseTo(1);
    expect(weakerMatch.strength).toBeCloseTo(0.5); // 0.4 / 0.8
    expect(weakerMatch.strength).toBeLessThan(strongMatch.strength);
  });
});

describe("listDimension (competitionType)", () => {
  const competitionTypeDimension = listDimension(
    DimensionId.COMPETITION_TYPE,
    (c) => c.competitionTypes,
  );

  it("matches when a preferred type is among the competition's attached types", () => {
    const preference = normalizeProfile([
      entry(DimensionId.COMPETITION_TYPE, "HACKATHON", 0.5),
    ]).get(DimensionId.COMPETITION_TYPE)!;
    const signal = evaluateDimension(
      competitionTypeDimension,
      preference,
      buildCandidate({ competitionTypes: ["HACKATHON", "QUIZ"] }),
    );

    expect(signal.outcome).toBe("MATCH");
  });

  it("treats an unclassified competition (zero types) as MISSING, not MISMATCH", () => {
    const preference = normalizeProfile([
      entry(DimensionId.COMPETITION_TYPE, "HACKATHON", 0.5),
    ]).get(DimensionId.COMPETITION_TYPE)!;
    const signal = evaluateDimension(
      competitionTypeDimension,
      preference,
      buildCandidate({ competitionTypes: [] }),
    );

    expect(signal.outcome).toBe("MISSING");
  });

  it("mismatches when the competition has types, none of which are preferred", () => {
    const preference = normalizeProfile([
      entry(DimensionId.COMPETITION_TYPE, "HACKATHON", 0.5),
    ]).get(DimensionId.COMPETITION_TYPE)!;
    const signal = evaluateDimension(
      competitionTypeDimension,
      preference,
      buildCandidate({ competitionTypes: ["QUIZ"] }),
    );

    expect(signal.outcome).toBe("MISMATCH");
  });
});
