import { describe, expect, it } from "vitest";

import type { SubscriptionPhase } from "@/generated/prisma";

import { nextDue, type NextDueInput, type NextDueSettings } from "./next-due";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const settings: NextDueSettings = {
  checkpointMarginSeconds: 2 * 60 * 60,
  expireByMarginSeconds: 10 * 60,
  trialConversionGraceSeconds: 4 * 24 * 60 * 60,
  heartbeats: {
    pendingAuthenticationSeconds: 6 * 60 * 60,
    trialingSeconds: 2 * 24 * 60 * 60,
    activeSeconds: 7 * 24 * 60 * 60,
    pastDueSeconds: 24 * 60 * 60,
    pausedSeconds: 7 * 24 * 60 * 60,
    haltedFirstWeekSeconds: 24 * 60 * 60,
    haltedFirstMonthSeconds: 7 * 24 * 60 * 60,
    haltedAfterMonthSeconds: 30 * 24 * 60 * 60,
  },
};

const at = (ms: number) => new Date(NOW.getTime() + ms);

function due(overrides: Partial<NextDueInput> & { phase: SubscriptionPhase }) {
  return nextDue(
    {
      now: NOW,
      phaseEnteredAt: NOW,
      expireBy: null,
      startAt: null,
      chargeAt: null,
      currentPeriodEnd: null,
      scheduledChangeAt: null,
      ...overrides,
    },
    settings,
  );
}

describe("nextDue — phases that are never synced", () => {
  it.each(["PROVISIONING", "CANCELLED", "EXPIRED", "COMPLETED", "ABANDONED"] as const)("%s -> null", (phase) => {
    expect(due({ phase, chargeAt: at(HOUR) })).toBeNull();
  });
});

describe("nextDue — heartbeats when no checkpoint is near", () => {
  it.each([
    ["PENDING_AUTHENTICATION", 6 * HOUR],
    ["TRIALING", 2 * DAY],
    ["ACTIVE", 7 * DAY],
    ["PAST_DUE", DAY],
    ["PAUSED", 7 * DAY],
  ] as const)("%s beats every %d ms", (phase, ms) => {
    expect(due({ phase })).toEqual({ at: at(ms), reason: "HEARTBEAT" });
  });

  it("HALTED decays daily, then weekly after a week, then monthly after a month (SB-PF-05)", () => {
    expect(due({ phase: "HALTED", phaseEnteredAt: at(-DAY) })).toEqual({ at: at(DAY), reason: "HEARTBEAT" });
    expect(due({ phase: "HALTED", phaseEnteredAt: at(-7 * DAY + 1) })?.at).toEqual(at(DAY));
    expect(due({ phase: "HALTED", phaseEnteredAt: at(-7 * DAY) })?.at).toEqual(at(7 * DAY));
    expect(due({ phase: "HALTED", phaseEnteredAt: at(-29 * DAY) })?.at).toEqual(at(7 * DAY));
    expect(due({ phase: "HALTED", phaseEnteredAt: at(-30 * DAY) })?.at).toEqual(at(30 * DAY));
    expect(due({ phase: "HALTED", phaseEnteredAt: at(-400 * DAY) })?.at).toEqual(at(30 * DAY));
  });

  it("HALTED with an unknown entry time starts at the shortest interval", () => {
    expect(due({ phase: "HALTED", phaseEnteredAt: null })?.at).toEqual(at(DAY));
  });

  it("HALTED ignores checkpoints", () => {
    expect(due({ phase: "HALTED", chargeAt: at(HOUR), currentPeriodEnd: at(HOUR) })?.reason).toBe("HEARTBEAT");
  });
});

describe("nextDue — checkpoints", () => {
  it("PENDING_AUTHENTICATION: expire_by plus the expiry-lag margin", () => {
    expect(due({ phase: "PENDING_AUTHENTICATION", expireBy: at(HOUR) })).toEqual({
      at: at(HOUR + 10 * MIN),
      reason: "CHECKPOINT",
    });
  });

  it("an expire_by just behind is still observed while its margin is ahead (the D6 lag)", () => {
    expect(due({ phase: "PENDING_AUTHENTICATION", expireBy: at(-5 * MIN) })).toEqual({
      at: at(5 * MIN),
      reason: "CHECKPOINT",
    });
  });

  it("TRIALING: start_at, and then the end of the conversion grace", () => {
    expect(due({ phase: "TRIALING", startAt: at(DAY) })).toEqual({ at: at(DAY + 2 * HOUR), reason: "CHECKPOINT" });

    // Past start_at + margin, still converting: the grace end is next, bounded by the heartbeat.
    const startedHoursAgo = at(-3 * HOUR);
    expect(due({ phase: "TRIALING", startAt: startedHoursAgo })).toEqual({ at: at(2 * DAY), reason: "HEARTBEAT" });

    const startedThreeDaysAgo = at(-3 * DAY);
    expect(due({ phase: "TRIALING", startAt: startedThreeDaysAgo })).toEqual({
      at: at(DAY + 2 * HOUR),
      reason: "CHECKPOINT",
    });
  });

  it("ACTIVE: the earliest of charge_at, current_end and the scheduled change", () => {
    expect(
      due({ phase: "ACTIVE", chargeAt: at(3 * DAY), currentPeriodEnd: at(3 * DAY), scheduledChangeAt: at(2 * DAY) }),
    ).toEqual({ at: at(2 * DAY + 2 * HOUR), reason: "CHECKPOINT" });

    expect(due({ phase: "ACTIVE", chargeAt: at(5 * DAY) })).toEqual({ at: at(5 * DAY + 2 * HOUR), reason: "CHECKPOINT" });
  });

  it("ACTIVE with a requested cycle-end cancel is observed at current_end even when charge_at is gone", () => {
    expect(due({ phase: "ACTIVE", chargeAt: null, currentPeriodEnd: at(DAY) })).toEqual({
      at: at(DAY + 2 * HOUR),
      reason: "CHECKPOINT",
    });
  });

  it("a checkpoint beyond the heartbeat loses to the heartbeat", () => {
    expect(due({ phase: "ACTIVE", chargeAt: at(25 * DAY) })).toEqual({ at: at(7 * DAY), reason: "HEARTBEAT" });
  });

  it("PAST_DUE: the next retry (charge_at), bounded by the daily heartbeat", () => {
    expect(due({ phase: "PAST_DUE", chargeAt: at(6 * HOUR) })).toEqual({ at: at(8 * HOUR), reason: "CHECKPOINT" });
    expect(due({ phase: "PAST_DUE", chargeAt: at(2 * DAY) })).toEqual({ at: at(DAY), reason: "HEARTBEAT" });
  });

  it("ignores a checkpoint whose margin has already passed", () => {
    expect(due({ phase: "ACTIVE", chargeAt: at(-3 * HOUR) })).toEqual({ at: at(7 * DAY), reason: "HEARTBEAT" });
    expect(due({ phase: "ACTIVE", chargeAt: at(-2 * HOUR) })?.reason).toBe("HEARTBEAT");
  });

  it("PAUSED ignores a retained current_end (D4)", () => {
    expect(due({ phase: "PAUSED", currentPeriodEnd: at(HOUR) })).toEqual({ at: at(7 * DAY), reason: "HEARTBEAT" });
  });
});
