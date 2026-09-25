import { describe, expect, it } from "vitest";

import { applyScheduledChange, type ScheduledChangeInput, type ScheduledChangeState } from "./scheduled-change";

const WHEN = new Date("2026-11-01T00:00:00.000Z");
const NONE: ScheduledChangeState = {
  scheduledPlan: null,
  scheduledCycle: null,
  scheduledProviderPlanId: null,
  scheduledChangeAt: null,
  scheduledByOperationId: null,
};
const TARGETED: ScheduledChangeState = {
  scheduledPlan: "PRO",
  scheduledCycle: "MONTHLY",
  scheduledProviderPlanId: "plan_pro_m",
  scheduledChangeAt: WHEN,
  scheduledByOperationId: "op_1",
};

function apply(overrides: Partial<ScheduledChangeInput>) {
  return applyScheduledChange({
    current: NONE,
    previouslyFlagged: false,
    hasScheduledChanges: false,
    changeScheduledAt: null,
    observedPlan: "PRO_PLUS",
    observedCycle: "MONTHLY",
    ...overrides,
  });
}

describe("applyScheduledChange", () => {
  it("nothing scheduled, nothing flagged: unchanged", () => {
    expect(apply({})).toEqual({ next: NONE, transition: "UNCHANGED" });
  });

  it("keeps Kizunia's target while the flag stays set, refreshing the time when the provider gives one", () => {
    const later = new Date("2026-11-02T00:00:00.000Z");
    expect(apply({ current: TARGETED, hasScheduledChanges: true, previouslyFlagged: true })).toEqual({
      next: TARGETED,
      transition: "UNCHANGED",
    });
    expect(
      apply({ current: TARGETED, hasScheduledChanges: true, previouslyFlagged: true, changeScheduledAt: later }).next
        .scheduledChangeAt,
    ).toEqual(later);
  });

  it("records a Dashboard-scheduled change as flag only, once", () => {
    expect(apply({ hasScheduledChanges: true, changeScheduledAt: WHEN })).toEqual({
      next: { ...NONE, scheduledChangeAt: WHEN },
      transition: "FLAGGED",
    });
    expect(apply({ hasScheduledChanges: true, previouslyFlagged: true }).transition).toBe("UNCHANGED");
  });

  it("clears the change as applied when the target plan is observed, flag or not", () => {
    for (const hasScheduledChanges of [false, true]) {
      expect(
        apply({ current: TARGETED, hasScheduledChanges, observedPlan: "PRO", observedCycle: "MONTHLY" }),
      ).toEqual({ next: NONE, transition: "APPLIED" });
    }
  });

  it("clears the change as cancelled when the flag drops and the plan did not change", () => {
    expect(apply({ current: TARGETED, previouslyFlagged: true })).toEqual({ next: NONE, transition: "CANCELLED" });
  });

  it("a flag-only change that disappears is cleared as cancelled", () => {
    expect(apply({ current: { ...NONE, scheduledChangeAt: WHEN }, previouslyFlagged: true })).toEqual({
      next: NONE,
      transition: "CANCELLED",
    });
  });

  it("the same plan in another cycle is not the target", () => {
    expect(
      apply({ current: TARGETED, previouslyFlagged: true, observedPlan: "PRO", observedCycle: "YEARLY" }).transition,
    ).toBe("CANCELLED");
  });
});
