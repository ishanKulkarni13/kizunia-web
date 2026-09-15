import { describe, expect, it } from "vitest";
import { normalizeProfile } from "./profile";
import { DimensionId } from "./types";
import { entry } from "./test-helpers";

describe("normalizeProfile", () => {
  it("drops dimensions with no entries entirely", () => {
    const profile = normalizeProfile([]);
    expect(profile.size).toBe(0);
  });

  it("treats weight 0 as no preference — the dimension does not appear", () => {
    const profile = normalizeProfile([entry(DimensionId.MODE, "ONLINE", 0)]);
    expect(profile.has(DimensionId.MODE)).toBe(false);
  });

  it("keeps a soft preference as non-hard, with the stated weight", () => {
    const profile = normalizeProfile([entry(DimensionId.MODE, "ONLINE", 0.6)]);
    const pref = profile.get(DimensionId.MODE)!;

    expect(pref.hard).toBe(false);
    expect(pref.values.get("ONLINE")).toBe(0.6);
    expect(pref.userStrength).toBe(0.6);
  });

  it("marks a weight-1 dimension as hard", () => {
    const profile = normalizeProfile([entry(DimensionId.ELIGIBILITIES, "UNDERGRADUATE", 1)]);
    const pref = profile.get(DimensionId.ELIGIBILITIES)!;

    expect(pref.hard).toBe(true);
    expect(pref.userStrength).toBe(1);
  });

  it("hard-constraint dominance: a weight-1 value discards softer siblings in the same dimension", () => {
    const profile = normalizeProfile([
      entry(DimensionId.LOCATION, "pune", 1),
      entry(DimensionId.LOCATION, "mumbai", 0.5),
    ]);
    const pref = profile.get(DimensionId.LOCATION)!;

    expect(pref.hard).toBe(true);
    expect(pref.values.has("pune")).toBe(true);
    expect(pref.values.has("mumbai")).toBe(false);
  });

  it("supports multiple soft values in one dimension, each keeping its own weight", () => {
    const profile = normalizeProfile([
      entry(DimensionId.LOCATION, "pune", 1.0 - 0.1), // 0.9, still soft
      entry(DimensionId.LOCATION, "mumbai", 0.7),
    ]);
    const pref = profile.get(DimensionId.LOCATION)!;

    expect(pref.hard).toBe(false);
    expect(pref.values.get("pune")).toBeCloseTo(0.9);
    expect(pref.values.get("mumbai")).toBe(0.7);
    expect(pref.userStrength).toBeCloseTo(0.9);
  });

  it("clamps out-of-range weights instead of trusting the caller", () => {
    const profile = normalizeProfile([entry(DimensionId.MODE, "ONLINE", 1.5)]);
    expect(profile.get(DimensionId.MODE)!.values.get("ONLINE")).toBe(1);
  });

  it("keeps hard and soft dimensions independent of each other", () => {
    const profile = normalizeProfile([
      entry(DimensionId.ELIGIBILITIES, "UNDERGRADUATE", 1),
      entry(DimensionId.CATEGORIES, "ai", 0.5),
    ]);

    expect(profile.get(DimensionId.ELIGIBILITIES)!.hard).toBe(true);
    expect(profile.get(DimensionId.CATEGORIES)!.hard).toBe(false);
  });
});
