import { describe, expect, it } from "vitest";

import { ProviderFailureClass } from "@/generated/prisma";

import {
  applyHealthEvent,
  CLEAN_COOLDOWN_STATE,
  healthEventFor,
  isAuthPinned,
  isClean,
  isCoolingDown,
  type CooldownSettings,
  type CooldownState,
  type ProviderHealthEvent,
} from "./cooldown";

const NOW = new Date("2026-09-25T10:00:00.000Z");
const settings: CooldownSettings = { baseSeconds: 30, capSeconds: 900, consecutiveFailureThreshold: 5 };
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

/** The top and bottom of the jitter range. */
const noJitter = () => 0.999999999;
const fullJitter = () => 0;

function apply(state: CooldownState, event: ProviderHealthEvent, random = noJitter, now = NOW) {
  return applyHealthEvent(state, event, { now, settings, random });
}

const RATE_LIMITED: ProviderHealthEvent = { kind: "RATE_LIMITED" };
const TRANSIENT: ProviderHealthEvent = { kind: "TRANSIENT_FAILURE" };
const HEALTHY: ProviderHealthEvent = { kind: "HEALTHY" };

describe("healthEventFor — what each provider result means", () => {
  it("covers every failure class", () => {
    for (const failureClass of Object.values(ProviderFailureClass)) {
      // A non-exhaustive switch returns undefined, which this catches.
      expect(healthEventFor(failureClass, "fp")).not.toBeUndefined();
    }
  });

  it("treats success and any definite answer as the provider being healthy", () => {
    for (const result of ["SUCCESS", "REJECTED", "NOT_FOUND", "CONCURRENT_OPERATION"] as const) {
      expect(healthEventFor(result, "fp")).toEqual({ kind: "HEALTHY" });
    }
  });

  it("treats a timeout and a 5xx as a transient failure", () => {
    expect(healthEventFor("TIMEOUT", "fp")).toEqual({ kind: "TRANSIENT_FAILURE" });
    expect(healthEventFor("UNAVAILABLE", "fp")).toEqual({ kind: "TRANSIENT_FAILURE" });
  });

  it("carries the key fingerprint on an auth failure", () => {
    expect(healthEventFor("AUTH_FAILURE", "fp-123")).toEqual({ kind: "AUTH_FAILURE", keyFingerprint: "fp-123" });
    expect(healthEventFor("RATE_LIMITED", "fp")).toEqual({ kind: "RATE_LIMITED" });
  });

  it("has no opinion on a malformed body, an unmapped plan, or a call that was never sent", () => {
    for (const result of ["MALFORMED", "UNMAPPED_PLAN", "BUDGET_EXHAUSTED"] as const) {
      expect(healthEventFor(result, "fp")).toBeNull();
    }
  });
});

describe("a 429 enters a jittered cooldown", () => {
  it("starts at the base delay and raises the level", () => {
    const { state, entered } = apply(CLEAN_COOLDOWN_STATE, RATE_LIMITED);

    expect(entered).toBe(true);
    expect(state.cooldownLevel).toBe(1);
    expect(state.cooldownUntil?.getTime()).toBeCloseTo(NOW.getTime() + 30_000, -1);
  });

  it("keeps the delay within [0.5, 1.0] of base · 2^level", () => {
    for (const [level, ceiling] of [
      [0, 30],
      [1, 60],
      [2, 120],
      [3, 240],
    ] as const) {
      const start: CooldownState = { ...CLEAN_COOLDOWN_STATE, cooldownLevel: level };

      const lowest = apply(start, RATE_LIMITED, fullJitter).state.cooldownUntil!.getTime() - NOW.getTime();
      const highest = apply(start, RATE_LIMITED, noJitter).state.cooldownUntil!.getTime() - NOW.getTime();

      expect(lowest).toBeCloseTo(ceiling * 500, -1);
      expect(highest).toBeCloseTo(ceiling * 1000, -1);
    }
  });

  it("escalates on each further 429 and stops at the cap", () => {
    let state = CLEAN_COOLDOWN_STATE;
    const delays: number[] = [];

    for (let i = 0; i < 9; i += 1) {
      state = apply(state, RATE_LIMITED).state;
      delays.push(Math.round((state.cooldownUntil!.getTime() - NOW.getTime()) / 1000));
    }

    expect(delays.slice(0, 5)).toEqual([30, 60, 120, 240, 480]);
    expect(Math.max(...delays)).toBeLessThanOrEqual(900);
    expect(delays.at(-1)).toBe(900);
    expect(state.cooldownLevel).toBe(9);
  });

  it("never moves a running cooldown earlier", () => {
    const running: CooldownState = { ...CLEAN_COOLDOWN_STATE, cooldownUntil: at(600), cooldownLevel: 0 };

    // A short new delay must not shorten the 600 s already running.
    expect(apply(running, RATE_LIMITED, fullJitter).state.cooldownUntil).toEqual(at(600));
  });

  it("extends a running cooldown when the new one ends later", () => {
    const running: CooldownState = { ...CLEAN_COOLDOWN_STATE, cooldownUntil: at(5), cooldownLevel: 4 };

    expect(apply(running, RATE_LIMITED).state.cooldownUntil!.getTime()).toBeGreaterThan(at(5).getTime());
  });

  it("clears the failure count, since the 429 is its own trigger", () => {
    const counting: CooldownState = { ...CLEAN_COOLDOWN_STATE, consecutiveFailures: 3 };

    expect(apply(counting, RATE_LIMITED).state.consecutiveFailures).toBe(0);
  });
});

describe("consecutive timeouts and 5xx", () => {
  it("only count until the threshold", () => {
    let state = CLEAN_COOLDOWN_STATE;

    for (let i = 1; i <= 4; i += 1) {
      const transition = apply(state, TRANSIENT);
      state = transition.state;

      expect(transition.entered).toBe(false);
      expect(state.consecutiveFailures).toBe(i);
      expect(state.cooldownUntil).toBeNull();
    }
  });

  it("enter a cooldown at the threshold, and restart the count", () => {
    const counting: CooldownState = { ...CLEAN_COOLDOWN_STATE, consecutiveFailures: 4 };

    const transition = apply(counting, TRANSIENT);

    expect(transition.entered).toBe(true);
    expect(transition.state.cooldownLevel).toBe(1);
    expect(transition.state.consecutiveFailures).toBe(0);
    expect(isCoolingDown(transition.state, NOW)).toBe(true);
  });

  it("are broken by any healthy result", () => {
    const counting: CooldownState = { ...CLEAN_COOLDOWN_STATE, consecutiveFailures: 4 };

    expect(apply(counting, HEALTHY).state.consecutiveFailures).toBe(0);
  });
});

describe("recovery", () => {
  it("does not end a cooldown that is still running, even on a success", () => {
    // A priority-1 call got through during the cooldown. Others stay off.
    const running: CooldownState = { ...CLEAN_COOLDOWN_STATE, cooldownUntil: at(120), cooldownLevel: 2 };

    const { state, left } = apply(running, HEALTHY);

    expect(left).toBe(false);
    expect(state.cooldownUntil).toEqual(at(120));
    expect(state.cooldownLevel).toBe(2);
    expect(isCoolingDown(state, NOW)).toBe(true);
  });

  it("clears an ended cooldown on the first success and reports that it was left", () => {
    const ended: CooldownState = { ...CLEAN_COOLDOWN_STATE, cooldownUntil: at(-1), cooldownLevel: 3 };

    const { state, left } = apply(ended, HEALTHY);

    expect(left).toBe(true);
    expect(state.cooldownUntil).toBeNull();
    expect(state.cooldownLevel).toBe(2);
  });

  it("decays the level by one per healthy result, back to zero, without going below", () => {
    let state: CooldownState = { ...CLEAN_COOLDOWN_STATE, cooldownUntil: at(-1), cooldownLevel: 3 };
    const levels: number[] = [];

    for (let i = 0; i < 5; i += 1) {
      state = apply(state, HEALTHY).state;
      levels.push(state.cooldownLevel);
    }

    expect(levels).toEqual([2, 1, 0, 0, 0]);
  });

  it("reports left only once", () => {
    const ended: CooldownState = { ...CLEAN_COOLDOWN_STATE, cooldownUntil: at(-1), cooldownLevel: 2 };
    const first = apply(ended, HEALTHY);

    expect(first.left).toBe(true);
    expect(apply(first.state, HEALTHY).left).toBe(false);
  });

  it("treats the instant the cooldown ends as ended", () => {
    const boundary: CooldownState = { ...CLEAN_COOLDOWN_STATE, cooldownUntil: NOW, cooldownLevel: 1 };

    expect(isCoolingDown(boundary, NOW)).toBe(false);
    expect(apply(boundary, HEALTHY).left).toBe(true);
  });

  it("changes nothing on a clean state", () => {
    const transition = apply(CLEAN_COOLDOWN_STATE, HEALTHY);

    expect(transition.state).toEqual(CLEAN_COOLDOWN_STATE);
    expect(transition).toMatchObject({ entered: false, left: false });
    expect(isClean(CLEAN_COOLDOWN_STATE)).toBe(true);
  });
});

describe("the auth-failure pin", () => {
  const pinned: CooldownState = { ...CLEAN_COOLDOWN_STATE, authFailurePinnedKeyFingerprint: "fp-old" };

  it("pins the failing key's fingerprint", () => {
    const { state } = apply(CLEAN_COOLDOWN_STATE, { kind: "AUTH_FAILURE", keyFingerprint: "fp-old" });

    expect(state.authFailurePinnedKeyFingerprint).toBe("fp-old");
    expect(isClean(state)).toBe(false);
  });

  it("holds only while the configured key is the one that failed", () => {
    expect(isAuthPinned(pinned, "fp-old")).toBe(true);
    // The key was rotated and the app redeployed: un-pinned, with no manual SQL.
    expect(isAuthPinned(pinned, "fp-new")).toBe(false);
    expect(isAuthPinned(CLEAN_COOLDOWN_STATE, "fp-old")).toBe(false);
  });

  it("is cleared by a call that works, which proves the key is good", () => {
    expect(apply(pinned, HEALTHY).state.authFailurePinnedKeyFingerprint).toBeNull();
  });

  it("does not start a cooldown by itself: it refuses every priority on its own", () => {
    const { state, entered } = apply(CLEAN_COOLDOWN_STATE, { kind: "AUTH_FAILURE", keyFingerprint: "fp" });

    expect(entered).toBe(false);
    expect(state.cooldownUntil).toBeNull();
  });
});
