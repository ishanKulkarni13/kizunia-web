import { describe, expect, it } from "vitest";

import type { SubscriptionKind } from "@/generated/prisma";

import {
  isContributingPhase,
  isOpenPhase,
  isTerminalPhase,
  KNOWN_PROVIDER_STATUSES,
  mapPhase,
  type PhaseMappingInput,
} from "./state-mapping";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const GRACE_SECONDS = 4 * 24 * 60 * 60;

function map(overrides: Partial<PhaseMappingInput>) {
  return mapPhase({
    rawStatus: "active",
    kind: "STANDARD",
    startAt: null,
    now: NOW,
    trialConversionGraceSeconds: GRACE_SECONDS,
    ...overrides,
  });
}

describe("mapPhase — the direct statuses", () => {
  it.each([
    ["created", "PENDING_AUTHENTICATION"],
    ["active", "ACTIVE"],
    ["pending", "PAST_DUE"],
    ["halted", "HALTED"],
    ["paused", "PAUSED"],
    ["cancelled", "CANCELLED"],
    ["expired", "EXPIRED"],
    ["completed", "COMPLETED"],
  ] as const)("%s -> %s, whatever the kind and start_at", (rawStatus, phase) => {
    for (const kind of ["STANDARD", "TRIAL"] as const) {
      for (const startAt of [null, new Date(NOW.getTime() + HOUR), new Date(NOW.getTime() - HOUR)]) {
        expect(map({ rawStatus, kind, startAt })).toEqual({
          applied: true,
          phase,
          trialConversionOverdue: false,
        });
      }
    }
  });

  it("maps every known status, and nothing unknown", () => {
    for (const rawStatus of KNOWN_PROVIDER_STATUSES) {
      expect(map({ rawStatus }).applied).toBe(true);
    }
  });

  it.each(["", "ACTIVE", "on_hold", "unknown", "constructor", "__proto__", "toString"])(
    "does not apply an unknown status (%j): a malformed observation, never a guess",
    (rawStatus) => {
      expect(map({ rawStatus })).toEqual({ applied: false, reason: "UNKNOWN_STATUS" });
    },
  );
});

describe("mapPhase — authenticated, and the trial-conversion rule (IB-9)", () => {
  const ahead = new Date(NOW.getTime() + 3 * HOUR);
  const justPassed = new Date(NOW.getTime() - HOUR);
  const graceBoundary = new Date(NOW.getTime() - GRACE_SECONDS * 1000);

  it("a STANDARD subscription is PENDING_AUTHENTICATION on its way to active, whatever start_at says", () => {
    for (const startAt of [null, ahead, justPassed]) {
      expect(map({ rawStatus: "authenticated", kind: "STANDARD", startAt })).toEqual({
        applied: true,
        phase: "PENDING_AUTHENTICATION",
        trialConversionOverdue: false,
      });
    }
  });

  it("a TRIAL before start_at is TRIALING", () => {
    expect(map({ rawStatus: "authenticated", kind: "TRIAL", startAt: ahead })).toMatchObject({
      phase: "TRIALING",
      trialConversionOverdue: false,
    });
  });

  it("a TRIAL past start_at but inside the grace stays TRIALING: conversion pending", () => {
    expect(map({ rawStatus: "authenticated", kind: "TRIAL", startAt: justPassed })).toMatchObject({
      phase: "TRIALING",
      trialConversionOverdue: false,
    });
    const oneMsInside = new Date(graceBoundary.getTime() + 1);
    expect(map({ rawStatus: "authenticated", kind: "TRIAL", startAt: oneMsInside })).toMatchObject({
      phase: "TRIALING",
    });
  });

  it("a TRIAL at or past start_at + grace stops contributing and is flagged overdue", () => {
    for (const startAt of [graceBoundary, new Date(graceBoundary.getTime() - HOUR)]) {
      expect(map({ rawStatus: "authenticated", kind: "TRIAL", startAt })).toEqual({
        applied: true,
        phase: "PENDING_AUTHENTICATION",
        trialConversionOverdue: true,
      });
    }
  });

  it("a TRIAL with no start_at has nothing that makes it a trial", () => {
    expect(map({ rawStatus: "authenticated", kind: "TRIAL", startAt: null })).toMatchObject({
      phase: "PENDING_AUTHENTICATION",
      trialConversionOverdue: false,
    });
  });

  it("never infers a trial from a future start_at alone (SB-LC-10)", () => {
    const kinds: SubscriptionKind[] = ["STANDARD"];
    for (const kind of kinds) {
      expect(map({ rawStatus: "authenticated", kind, startAt: ahead })).toMatchObject({
        phase: "PENDING_AUTHENTICATION",
      });
    }
  });
});

describe("phase classification", () => {
  it("terminal, open and contributing phases", () => {
    expect(["CANCELLED", "EXPIRED", "COMPLETED", "ABANDONED"].every((p) => isTerminalPhase(p as never))).toBe(true);
    expect(isTerminalPhase("HALTED")).toBe(false);
    expect(isOpenPhase("PROVISIONING")).toBe(true);
    expect(isOpenPhase("CANCELLED")).toBe(false);
    expect(["TRIALING", "ACTIVE", "PAST_DUE"].every((p) => isContributingPhase(p as never))).toBe(true);
    expect(isContributingPhase("HALTED")).toBe(false);
    expect(isContributingPhase("PENDING_AUTHENTICATION")).toBe(false);
  });
});
