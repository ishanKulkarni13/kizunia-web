import { describe, expect, it } from "vitest";

import { validateObservation, type ObservationValidationInput } from "./observation-validation";

const catalog: Record<string, { plan: "PRO" | "PRO_PLUS"; cycle: "MONTHLY" | "YEARLY" }> = {
  plan_pro_m: { plan: "PRO", cycle: "MONTHLY" },
};

function validate(overrides: Partial<ObservationValidationInput> = {}) {
  return validateObservation({
    subscriptionId: "sub_local_1",
    rowMode: "TEST",
    resolvedMode: "TEST",
    rawStatus: "active",
    providerPlanId: "plan_pro_m",
    notes: {},
    findPlan: (id) => catalog[id],
    ...overrides,
  });
}

describe("validateObservation", () => {
  it("accepts a known status and a catalogued plan, and resolves the plan and cycle", () => {
    expect(validate()).toEqual({ ok: true, plan: "PRO", cycle: "MONTHLY" });
  });

  it("accepts matching notes, and absent notes (a Dashboard-created subscription has none)", () => {
    expect(validate({ notes: { kz_sub: "sub_local_1", kz_env: "TEST", kz_op: "op_1" } }).ok).toBe(true);
    expect(validate({ notes: { kz_env: "test" } }).ok).toBe(true);
  });

  it("refuses a row of another mode", () => {
    expect(validate({ rowMode: "LIVE" })).toMatchObject({ ok: false, problem: "MODE_MISMATCH" });
  });

  it("refuses notes naming another mode", () => {
    expect(validate({ notes: { kz_env: "LIVE" } })).toMatchObject({ ok: false, problem: "MODE_MISMATCH" });
  });

  it("refuses notes naming another Kizunia subscription", () => {
    expect(validate({ notes: { kz_sub: "sub_local_2" } })).toMatchObject({
      ok: false,
      problem: "NOTES_CONFLICT",
      detail: { notedSubscriptionId: "sub_local_2" },
    });
  });

  it("refuses an unknown status", () => {
    expect(validate({ rawStatus: "on_hold" })).toMatchObject({ ok: false, problem: "UNKNOWN_STATUS" });
  });

  it("refuses a plan the catalog does not know", () => {
    expect(validate({ providerPlanId: "plan_other" })).toMatchObject({
      ok: false,
      problem: "UNMAPPED_PLAN",
      detail: { providerPlanId: "plan_other" },
    });
  });

  it("reports the first problem: mode before notes before status before plan", () => {
    expect(
      validate({ rowMode: "LIVE", notes: { kz_sub: "x" }, rawStatus: "?", providerPlanId: "nope" }),
    ).toMatchObject({ problem: "MODE_MISMATCH" });
    expect(validate({ notes: { kz_sub: "x" }, rawStatus: "?", providerPlanId: "nope" })).toMatchObject({
      problem: "NOTES_CONFLICT",
    });
    expect(validate({ rawStatus: "?", providerPlanId: "nope" })).toMatchObject({ problem: "UNKNOWN_STATUS" });
  });
});
