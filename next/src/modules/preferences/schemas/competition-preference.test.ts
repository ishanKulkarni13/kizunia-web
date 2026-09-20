import { describe, expect, it } from "vitest";

import { DimensionId } from "@/modules/recommendations";

import { UpdateCompetitionPreferencesSchema } from "./competition-preference";

describe("UpdateCompetitionPreferencesSchema", () => {
  it("accepts an empty preferences array (a valid, meaningful reset)", () => {
    const result = UpdateCompetitionPreferencesSchema.parse({ preferences: [] });

    expect(result.preferences).toEqual([]);
  });

  it("accepts one preference", () => {
    const result = UpdateCompetitionPreferencesSchema.parse({
      preferences: [{ dimension: DimensionId.MODE, value: "ONLINE", weight: 0.5 }],
    });

    expect(result.preferences).toHaveLength(1);
  });

  it("accepts a competitionType preference", () => {
    const result = UpdateCompetitionPreferencesSchema.parse({
      preferences: [{ dimension: DimensionId.COMPETITION_TYPE, value: "HACKATHON", weight: 0.7 }],
    });

    expect(result.preferences).toHaveLength(1);
  });

  it("accepts multiple values within one dimension", () => {
    const result = UpdateCompetitionPreferencesSchema.parse({
      preferences: [
        { dimension: DimensionId.LOCATION, value: "search-area-1", weight: 0.8 },
        { dimension: DimensionId.LOCATION, value: "search-area-2", weight: 0.3 },
      ],
    });

    expect(result.preferences).toHaveLength(2);
  });

  it.each([0, 0.5, 1])("accepts weight %s", (weight) => {
    expect(() =>
      UpdateCompetitionPreferencesSchema.parse({
        preferences: [{ dimension: DimensionId.MODE, value: "ONLINE", weight }],
      }),
    ).not.toThrow();
  });

  it.each([-0.1, 1.1, 2])("rejects out-of-range weight %s", (weight) => {
    expect(() =>
      UpdateCompetitionPreferencesSchema.parse({
        preferences: [{ dimension: DimensionId.MODE, value: "ONLINE", weight }],
      }),
    ).toThrow();
  });

  it("rejects an unknown dimension", () => {
    expect(() =>
      UpdateCompetitionPreferencesSchema.parse({
        preferences: [{ dimension: "notARealDimension", value: "x", weight: 0.5 }],
      }),
    ).toThrow();
  });

  it("rejects an empty value", () => {
    expect(() =>
      UpdateCompetitionPreferencesSchema.parse({
        preferences: [{ dimension: DimensionId.MODE, value: "", weight: 0.5 }],
      }),
    ).toThrow();
  });

  it("rejects more than 200 entries", () => {
    const preferences = Array.from({ length: 201 }, (_, i) => ({
      dimension: DimensionId.LOCATION,
      value: `search-area-${i}`,
      weight: 0.5,
    }));

    expect(() => UpdateCompetitionPreferencesSchema.parse({ preferences })).toThrow();
  });
});
