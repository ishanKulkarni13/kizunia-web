import { describe, expect, it } from "vitest";

import { backoffCeilingSeconds, backoffDelaySeconds, JITTER_MAX, JITTER_MIN } from "./backoff";

const settings = { baseSeconds: 60, capSeconds: 3600 };

describe("backoffCeilingSeconds", () => {
  it("doubles from the base", () => {
    expect([0, 1, 2, 3].map((n) => backoffCeilingSeconds(settings, n))).toEqual([60, 120, 240, 480]);
  });

  it("stops at the cap, and stays there indefinitely", () => {
    expect(backoffCeilingSeconds(settings, 6)).toBe(3600);
    expect(backoffCeilingSeconds(settings, 7)).toBe(3600);
    expect(backoffCeilingSeconds(settings, 40)).toBe(3600);
  });

  it("survives an exponent large enough to overflow", () => {
    expect(backoffCeilingSeconds(settings, 5_000)).toBe(3600);
  });

  it("treats a negative or fractional exponent as a whole, non-negative step", () => {
    expect(backoffCeilingSeconds(settings, -3)).toBe(60);
    expect(backoffCeilingSeconds(settings, 2.9)).toBe(240);
  });

  it("never exceeds a cap below the base", () => {
    expect(backoffCeilingSeconds({ baseSeconds: 100, capSeconds: 30 }, 0)).toBe(30);
  });
});

describe("backoffDelaySeconds — jitter", () => {
  it("multiplies by a factor between 0.5 and 1.0", () => {
    expect(JITTER_MIN).toBe(0.5);
    expect(JITTER_MAX).toBe(1);

    expect(backoffDelaySeconds(settings, 2, () => 0)).toBe(120); // 240 × 0.5
    expect(backoffDelaySeconds(settings, 2, () => 0.5)).toBe(180); // 240 × 0.75
    expect(backoffDelaySeconds(settings, 2, () => 0.999999)).toBeCloseTo(240, 3);
  });

  it("stays inside [0.5 × ceiling, ceiling] for any random value", () => {
    for (let exponent = 0; exponent < 12; exponent += 1) {
      const ceiling = backoffCeilingSeconds(settings, exponent);

      for (const random of [0, 0.001, 0.25, 0.5, 0.75, 0.999, 0.9999999]) {
        const delay = backoffDelaySeconds(settings, exponent, () => random);

        expect(delay).toBeGreaterThanOrEqual(ceiling * 0.5);
        expect(delay).toBeLessThanOrEqual(ceiling);
      }
    }
  });

  it("only ever shortens: the cap is a true upper bound", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(backoffDelaySeconds(settings, 30)).toBeLessThanOrEqual(3600);
    }
  });

  it("actually varies, so a shared outage does not re-synchronize", () => {
    const delays = new Set(Array.from({ length: 50 }, () => backoffDelaySeconds(settings, 3)));

    expect(delays.size).toBeGreaterThan(10);
  });
});
