import { describe, expect, it } from "vitest";

import type { SubscriptionPhase } from "@/generated/prisma";

import { detectCancellationNotEffective, type CancellationEffectivenessInput } from "./cancellation-effectiveness";

const HOUR = 3_600_000;
const REQUESTED_AT = new Date("2026-09-01T10:00:00Z");
const PERIOD_END = new Date("2026-10-01T10:00:00Z");
const MARGIN_SECONDS = 2 * 3600;

function input(overrides: Partial<CancellationEffectivenessInput> = {}): CancellationEffectivenessInput {
  return {
    cancelAtPeriodEnd: true,
    observedPhase: "ACTIVE",
    observationAt: new Date(REQUESTED_AT.getTime() + HOUR),
    requestedPeriodEnd: PERIOD_END,
    marginSeconds: MARGIN_SECONDS,
    cancelRequestedAt: REQUESTED_AT,
    latestChargeAt: new Date(REQUESTED_AT.getTime() - 24 * HOUR),
    ...overrides,
  };
}

describe("detectCancellationNotEffective — invariant I-4", () => {
  it("finds nothing while the period runs as requested", () => {
    expect(detectCancellationNotEffective(input())).toBeNull();
  });

  it("never fires without the flag, or on an observed cancellation", () => {
    expect(detectCancellationNotEffective(input({ cancelAtPeriodEnd: false, observedPhase: "HALTED" }))).toBeNull();
    expect(
      detectCancellationNotEffective(
        input({ observedPhase: "CANCELLED", observationAt: new Date(PERIOD_END.getTime() + 10 * HOUR), latestChargeAt: new Date() }),
      ),
    ).toBeNull();
  });

  it.each<SubscriptionPhase>(["ACTIVE", "PAST_DUE"])("(i) still %s after the requested period end + margin", (phase) => {
    const after = new Date(PERIOD_END.getTime() + MARGIN_SECONDS * 1000 + 1);

    expect(detectCancellationNotEffective(input({ observedPhase: phase, observationAt: after }))).toBe("PERIOD_PASSED");
  });

  it("(i) waits for the margin: the provider's own cancellation at current_end may lag", () => {
    const within = new Date(PERIOD_END.getTime() + MARGIN_SECONDS * 1000);

    expect(detectCancellationNotEffective(input({ observationAt: within }))).toBeNull();
  });

  it("(i) cannot fire without the requested period end, and ignores a later period the row now shows", () => {
    expect(detectCancellationNotEffective(input({ requestedPeriodEnd: null, observationAt: new Date(PERIOD_END.getTime() + 99 * HOUR) }))).toBeNull();
  });

  it("(ii) a CHARGE dated after the cancel request was sent", () => {
    expect(detectCancellationNotEffective(input({ latestChargeAt: new Date(REQUESTED_AT.getTime() + 1) }))).toBe("CHARGED_AFTER_REQUEST");
  });

  it("(ii) ignores the charge that paid the current period, before the request", () => {
    expect(detectCancellationNotEffective(input({ latestChargeAt: REQUESTED_AT }))).toBeNull();
  });

  it("(iii) HALTED while the flag is set, whatever the dates", () => {
    expect(detectCancellationNotEffective(input({ observedPhase: "HALTED" }))).toBe("HALTED");
  });

  it.each<SubscriptionPhase>(["PAUSED", "COMPLETED", "EXPIRED"])("does not invent a fourth rule for %s", (phase) => {
    expect(detectCancellationNotEffective(input({ observedPhase: phase, observationAt: new Date(PERIOD_END.getTime() + 99 * HOUR) }))).toBeNull();
  });
});
