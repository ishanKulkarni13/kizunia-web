import { describe, expect, it } from "vitest";

import { nextAttemptAt, nextAttemptDelayMs, type BackoffPolicy } from "./backoff";

const POLICY: BackoffPolicy = {
  baseSeconds: 60,
  factor: 2,
  capSeconds: 3600,
  jitterRatio: 0.5,
};

/** No jitter, so the underlying curve is observable. */
const noJitter = () => 0;
/** Maximum jitter, for the other end of the range. */
const maxJitter = () => 1;

describe("nextAttemptDelayMs", () => {
  it("waits exactly the base delay before the first retry", () => {
    expect(nextAttemptDelayMs(1, POLICY, noJitter)).toBe(60_000);
  });

  it("grows by the configured factor per attempt", () => {
    expect(nextAttemptDelayMs(1, POLICY, noJitter)).toBe(60_000);
    expect(nextAttemptDelayMs(2, POLICY, noJitter)).toBe(120_000);
    expect(nextAttemptDelayMs(3, POLICY, noJitter)).toBe(240_000);
    expect(nextAttemptDelayMs(4, POLICY, noJitter)).toBe(480_000);
  });

  it("never exceeds the cap, however many attempts have been made", () => {
    // Without a cap this would be ~17 hours; the cap is what keeps a job
    // scheduled for today resolved today.
    expect(nextAttemptDelayMs(20, POLICY, maxJitter)).toBe(
      Math.round(3600 * 1.5 * 1000),
    );
  });

  it("only ever delays further, never sooner", () => {
    // Additive-upward jitter, not symmetric: retrying *earlier* than the
    // backoff curve is the opposite of what backoff is for.
    for (let attempts = 1; attempts <= 6; attempts += 1) {
      const floor = nextAttemptDelayMs(attempts, POLICY, noJitter);
      const ceiling = nextAttemptDelayMs(attempts, POLICY, maxJitter);

      expect(ceiling).toBeGreaterThan(floor);
      expect(ceiling).toBeLessThanOrEqual(floor * (1 + POLICY.jitterRatio));
    }
  });

  it("spreads simultaneous failures across a window rather than a point", () => {
    // The property that matters at 2,000 users: one scheduler pass enqueues
    // one job per user, so a shared dependency failing fails all of them at
    // once. Without jitter they would all retry at the same instant and
    // reproduce the overload.
    const values = new Set<number>();
    let seed = 0;
    const pseudoRandom = () => {
      seed += 1;
      return (seed % 100) / 100;
    };

    for (let i = 0; i < 50; i += 1) {
      values.add(nextAttemptDelayMs(1, POLICY, pseudoRandom));
    }

    expect(values.size).toBeGreaterThan(40);
  });

  it("treats a zeroth attempt as the first, rather than going backwards", () => {
    // Defensive: a caller passing 0 should not produce a sub-base delay via a
    // negative exponent.
    expect(nextAttemptDelayMs(0, POLICY, noJitter)).toBe(60_000);
  });

  it("collapses to a fixed delay when the factor is 1", () => {
    const flat: BackoffPolicy = { ...POLICY, factor: 1, jitterRatio: 0 };

    expect(nextAttemptDelayMs(1, flat, noJitter)).toBe(60_000);
    expect(nextAttemptDelayMs(5, flat, noJitter)).toBe(60_000);
  });
});

describe("nextAttemptAt", () => {
  it("resolves the delay against the supplied now, not the clock", () => {
    const now = new Date("2026-09-17T13:00:00.000Z");

    expect(nextAttemptAt(now, 1, POLICY, noJitter).toISOString()).toBe(
      "2026-09-17T13:01:00.000Z",
    );
  });
});
