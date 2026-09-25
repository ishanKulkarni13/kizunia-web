import { describe, expect, it } from "vitest";

import { settleOperations, type SettleableOperation, type SettlementObservation } from "./operation-settlement";

const SENT = new Date("2026-10-01T12:00:00.000Z");
const AFTER = new Date("2026-10-01T12:05:00.000Z");

function op(overrides: Partial<SettleableOperation>): SettleableOperation {
  return {
    id: "op_1",
    kind: "CANCEL_IMMEDIATELY",
    status: "OUTCOME_UNKNOWN",
    requestSentAt: SENT,
    request: {},
    ...overrides,
  };
}

function observation(overrides: Partial<SettlementObservation> = {}): SettlementObservation {
  return {
    observationAt: AFTER,
    rawStatus: "active",
    plan: "PRO",
    cycle: "MONTHLY",
    hasScheduledChanges: false,
    scheduledPlan: null,
    scheduledCycle: null,
    ...overrides,
  };
}

describe("settleOperations", () => {
  it("settles an immediate cancel by whether cancelled is observed", () => {
    expect(settleOperations([op({})], observation({ rawStatus: "cancelled" }))).toEqual([
      { operationId: "op_1", status: "SUCCEEDED" },
    ]);
    expect(settleOperations([op({})], observation())).toEqual([{ operationId: "op_1", status: "NOT_APPLIED" }]);
  });

  it("settles a plan change by the current or the pending plan", () => {
    const update = op({ kind: "UPDATE_PLAN", request: { plan: "PRO_PLUS", cycle: "MONTHLY" } });

    expect(settleOperations([update], observation({ plan: "PRO_PLUS" }))).toEqual([
      { operationId: "op_1", status: "SUCCEEDED" },
    ]);
    expect(
      settleOperations([update], observation({ scheduledPlan: "PRO_PLUS", scheduledCycle: "MONTHLY" })),
    ).toEqual([{ operationId: "op_1", status: "SUCCEEDED" }]);
    expect(settleOperations([update], observation())).toEqual([{ operationId: "op_1", status: "NOT_APPLIED" }]);
  });

  it("never guesses at a plan change whose request does not parse", () => {
    const update = op({ kind: "UPDATE_PLAN", request: { plan: "GOLD" } });

    expect(settleOperations([update], observation())).toEqual([
      { operationId: "op_1", status: "UNPARSEABLE_REQUEST" },
    ]);
  });

  it("settles a scheduled-change cancel by the flag", () => {
    const cancel = op({ kind: "CANCEL_SCHEDULED_CHANGE" });

    expect(settleOperations([cancel], observation())).toEqual([{ operationId: "op_1", status: "SUCCEEDED" }]);
    expect(settleOperations([cancel], observation({ hasScheduledChanges: true }))).toEqual([
      { operationId: "op_1", status: "NOT_APPLIED" },
    ]);
  });

  it("settles a cycle-end cancel only on an observed cancellation, never NOT_APPLIED (A2)", () => {
    const cancel = op({ kind: "CANCEL_AT_CYCLE_END" });

    expect(settleOperations([cancel], observation({ rawStatus: "cancelled" }))).toEqual([
      { operationId: "op_1", status: "SUCCEEDED" },
    ]);
    expect(settleOperations([cancel], observation())).toEqual([]);
  });

  it("leaves creates and composed parents alone", () => {
    const ops = (["CREATE_SUBSCRIPTION", "SUPERSEDE", "CHANGE_PLAN"] as const).map((kind) => op({ kind }));

    expect(settleOperations(ops, observation({ rawStatus: "cancelled" }))).toEqual([]);
  });

  it("settles a cycle-end update proven only by the provider flag, adopting its target (Phase VI)", () => {
    const update = op({ kind: "UPDATE_PLAN", request: { plan: "PRO", cycle: "YEARLY", scheduleChangeAt: "CYCLE_END" } });

    expect(settleOperations([update], observation({ plan: "PRO_PLUS", hasScheduledChanges: true }))).toEqual([
      { operationId: "op_1", status: "SUCCEEDED", adoptTarget: { plan: "PRO", cycle: "YEARLY" } },
    ]);
  });

  it("does not adopt a flag that another target already explains, nor for an immediate update", () => {
    const cycleEnd = op({ kind: "UPDATE_PLAN", request: { plan: "PRO", cycle: "YEARLY", scheduleChangeAt: "CYCLE_END" } });
    const now = op({ kind: "UPDATE_PLAN", request: { plan: "PRO", cycle: "YEARLY", scheduleChangeAt: "NOW" } });
    const flaggedOther = observation({ plan: "PRO_PLUS", hasScheduledChanges: true, scheduledPlan: "PRO", scheduledCycle: "MONTHLY" });

    expect(settleOperations([cycleEnd], flaggedOther)).toEqual([{ operationId: "op_1", status: "NOT_APPLIED" }]);
    expect(settleOperations([now], observation({ plan: "PRO_PLUS", hasScheduledChanges: true }))).toEqual([
      { operationId: "op_1", status: "NOT_APPLIED" },
    ]);
  });

  it("reads a Phase IV/V update request without a timing as immediate", () => {
    const legacy = op({ kind: "UPDATE_PLAN", request: { plan: "PRO", cycle: "YEARLY" } });

    expect(settleOperations([legacy], observation({ plan: "PRO_PLUS", hasScheduledChanges: true }))).toEqual([
      { operationId: "op_1", status: "NOT_APPLIED" },
    ]);
  });

  it("only settles OUTCOME_UNKNOWN operations whose request was sent strictly before the observation", () => {
    const ops = [
      op({ id: "in_flight", status: "IN_FLIGHT" }),
      op({ id: "done", status: "SUCCEEDED" }),
      op({ id: "never_sent", requestSentAt: null }),
      op({ id: "same_instant", requestSentAt: AFTER }),
      op({ id: "later", requestSentAt: new Date(AFTER.getTime() + 1) }),
      op({ id: "earlier" }),
    ];

    expect(settleOperations(ops, observation({ rawStatus: "cancelled" }))).toEqual([
      { operationId: "earlier", status: "SUCCEEDED" },
    ]);
  });
});
