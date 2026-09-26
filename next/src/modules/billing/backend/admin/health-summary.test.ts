import { describe, expect, it } from "vitest";

import { buildHealthSummary, HEALTH_TASK_IDS, type HealthInputs } from "./health-summary";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

function inputs(overrides: Partial<HealthInputs> = {}): HealthInputs {
  return {
    now: NOW,
    providerMode: "TEST",
    expectedMode: "TEST",
    phaseCounts: [],
    due: [],
    oldestDue: [],
    openAnomalies: [],
    outcomeUnknown: { count: 0, oldest: [] },
    jobRuns: [],
    providerStates: [],
    webhooks: [],
    ...overrides,
  };
}

describe("buildHealthSummary", () => {
  it("summarizes an empty system: both modes listed with zeros, every task listed as never run", () => {
    const summary = buildHealthSummary(inputs({ providerMode: "DISABLED" }));

    expect(summary.generatedAt).toBe(NOW.toISOString());
    expect(summary.providerMode).toBe("DISABLED");
    expect(summary.subscriptionsByPhase).toEqual([]);
    expect(summary.openAnomaliesByType).toEqual([]);
    expect(summary.oldestDue).toEqual([]);
    expect(summary.dueBacklog).toEqual([
      { providerMode: "TEST", count: 0, oldestDueAt: null, oldestDueAgeSeconds: null },
      { providerMode: "LIVE", count: 0, oldestDueAt: null, oldestDueAgeSeconds: null },
    ]);
    expect(summary.outcomeUnknown).toEqual({ count: 0, oldestCreatedAt: null, oldestAgeSeconds: null, oldest: [] });
    expect(summary.jobs.map((job) => job.taskId)).toEqual([...HEALTH_TASK_IDS]);
    expect(summary.jobs.every((job) => job.lastRunAt === null && job.runCount === 0)).toBe(true);
    expect(summary.providerState.map((s) => [s.providerMode, s.cooldownActive, s.cooldownLevel])).toEqual([
      ["TEST", false, 0],
      ["LIVE", false, 0],
    ]);
    expect(summary.webhooks).toEqual([
      { providerMode: "TEST", lastReceivedAt: null, lastReceivedAgeSeconds: null, lastPreviousSecretMatchAt: null },
      { providerMode: "LIVE", lastReceivedAt: null, lastReceivedAgeSeconds: null, lastPreviousSecretMatchAt: null },
    ]);
  });

  it("orders phase counts by mode then lifecycle, and drops zero counts", () => {
    const summary = buildHealthSummary(
      inputs({
        phaseCounts: [
          { providerMode: "LIVE", phase: "ACTIVE", count: 1 },
          { providerMode: "TEST", phase: "HALTED", count: 2 },
          { providerMode: "TEST", phase: "PROVISIONING", count: 3 },
          { providerMode: "TEST", phase: "CANCELLED", count: 0 },
          { providerMode: "TEST", phase: "ACTIVE", count: 5 },
        ],
      }),
    );

    expect(summary.subscriptionsByPhase).toEqual([
      { providerMode: "TEST", phase: "PROVISIONING", count: 3 },
      { providerMode: "TEST", phase: "ACTIVE", count: 5 },
      { providerMode: "TEST", phase: "HALTED", count: 2 },
      { providerMode: "LIVE", phase: "ACTIVE", count: 1 },
    ]);
  });

  it("reports the due backlog count and the age of the oldest due row per mode", () => {
    const summary = buildHealthSummary(
      inputs({ due: [{ providerMode: "TEST", count: 7, oldestDueAt: ago(3_600) }] }),
    );

    expect(summary.dueBacklog[0]).toEqual({
      providerMode: "TEST",
      count: 7,
      oldestDueAt: ago(3_600).toISOString(),
      oldestDueAgeSeconds: 3_600,
    });
    expect(summary.dueBacklog[1].count).toBe(0);
  });

  it("never reports a negative age for a row due in the future relative to the clock", () => {
    const summary = buildHealthSummary(
      inputs({ due: [{ providerMode: "TEST", count: 1, oldestDueAt: new Date(NOW.getTime() + 5_000) }] }),
    );

    expect(summary.dueBacklog[0].oldestDueAgeSeconds).toBe(0);
  });

  it("counts open anomalies by type, largest first", () => {
    const summary = buildHealthSummary(
      inputs({
        openAnomalies: [
          { type: "NOTES_CONFLICT", count: 1 },
          { type: "MULTIPLE_OPEN_SUBSCRIPTIONS", count: 3 },
          { type: "UNMAPPED_PROVIDER_PLAN", count: 0 },
          { type: "CANCELLATION_NOT_EFFECTIVE", count: 1 },
        ],
      }),
    );

    expect(summary.openAnomaliesByType).toEqual([
      { type: "MULTIPLE_OPEN_SUBSCRIPTIONS", count: 3 },
      { type: "CANCELLATION_NOT_EFFECTIVE", count: 1 },
      { type: "NOTES_CONFLICT", count: 1 },
    ]);
  });

  it("reports OUTCOME_UNKNOWN count, the age of the oldest, and the oldest few with their ages", () => {
    const summary = buildHealthSummary(
      inputs({
        outcomeUnknown: {
          count: 12,
          oldest: [
            { id: "op1", kind: "CREATE_SUBSCRIPTION", providerMode: "TEST", userId: "u1", subscriptionId: "s1", createdAt: ago(90_000) },
            { id: "op2", kind: "CANCEL_IMMEDIATELY", providerMode: "TEST", userId: "u2", subscriptionId: null, createdAt: ago(600) },
          ],
        },
      }),
    );

    expect(summary.outcomeUnknown.count).toBe(12);
    expect(summary.outcomeUnknown.oldestAgeSeconds).toBe(90_000);
    expect(summary.outcomeUnknown.oldestCreatedAt).toBe(ago(90_000).toISOString());
    expect(summary.outcomeUnknown.oldest.map((o) => [o.operationId, o.ageSeconds])).toEqual([
      ["op1", 90_000],
      ["op2", 600],
    ]);
  });

  it("reports the last run of each billing task and leaves the others as never run", () => {
    const summary = buildHealthSummary(
      inputs({
        jobRuns: [
          { taskId: "billing:sync", lastRunAt: ago(30), lastStatus: "ok", lastError: null, runCount: 42 },
          { taskId: "billing:orphan-discovery", lastRunAt: ago(900), lastStatus: "failed", lastError: "boom", runCount: 3 },
          { taskId: "notifications:tick", lastRunAt: ago(5), lastStatus: "ok", lastError: null, runCount: 9 },
        ],
      }),
    );

    expect(summary.jobs).toEqual([
      { taskId: "billing:sync", lastRunAt: ago(30).toISOString(), lastStatus: "ok", lastError: null, runCount: 42 },
      { taskId: "billing:orphan-discovery", lastRunAt: ago(900).toISOString(), lastStatus: "failed", lastError: "boom", runCount: 3 },
      { taskId: "billing:payload-prune", lastRunAt: null, lastStatus: null, lastError: null, runCount: 0 },
    ]);
  });

  it("reports the cooldown as active only while it lies in the future, and never exposes the key fingerprint", () => {
    const summary = buildHealthSummary(
      inputs({
        providerStates: [
          {
            providerMode: "TEST",
            cooldownUntil: new Date(NOW.getTime() + 60_000),
            cooldownLevel: 2,
            consecutiveFailures: 5,
            authFailurePinnedKeyFingerprint: "fp_secret_fingerprint",
            orphanWatermark: ago(3_600),
            orphanWindowTo: ago(60),
          },
          {
            providerMode: "LIVE",
            cooldownUntil: ago(60),
            cooldownLevel: 1,
            consecutiveFailures: 0,
            authFailurePinnedKeyFingerprint: null,
            orphanWatermark: null,
            orphanWindowTo: null,
          },
        ],
      }),
    );

    expect(summary.providerState[0]).toMatchObject({
      providerMode: "TEST",
      cooldownActive: true,
      cooldownUntil: new Date(NOW.getTime() + 60_000).toISOString(),
      cooldownLevel: 2,
      authFailurePinned: true,
      orphanWatermark: ago(3_600).toISOString(),
    });
    // An expired cooldown is not active, though its level (which decays) is still shown.
    expect(summary.providerState[1]).toMatchObject({ cooldownActive: false, cooldownLevel: 1, authFailurePinned: false });
    expect(JSON.stringify(summary)).not.toContain("fp_secret_fingerprint");
  });

  it("reports the last webhook per mode with its age, and the last previous-secret match", () => {
    const summary = buildHealthSummary(
      inputs({
        webhooks: [
          { providerMode: "TEST", lastReceivedAt: ago(120), lastPreviousSecretAt: ago(86_400) },
          { providerMode: "LIVE", lastReceivedAt: null, lastPreviousSecretAt: null },
        ],
      }),
    );

    expect(summary.webhooks).toEqual([
      {
        providerMode: "TEST",
        lastReceivedAt: ago(120).toISOString(),
        lastReceivedAgeSeconds: 120,
        lastPreviousSecretMatchAt: ago(86_400).toISOString(),
      },
      { providerMode: "LIVE", lastReceivedAt: null, lastReceivedAgeSeconds: null, lastPreviousSecretMatchAt: null },
    ]);
  });

  it("lists the oldest due rows as given", () => {
    const summary = buildHealthSummary(
      inputs({
        oldestDue: [
          { id: "s1", userId: "u1", providerMode: "TEST", syncDueAt: ago(500), syncReason: "RETRY", syncAttempts: 3, lastSyncFailureClass: "TIMEOUT" },
        ],
      }),
    );

    expect(summary.oldestDue).toEqual([
      {
        subscriptionId: "s1",
        userId: "u1",
        providerMode: "TEST",
        syncDueAt: ago(500).toISOString(),
        syncReason: "RETRY",
        syncAttempts: 3,
        lastSyncFailureClass: "TIMEOUT",
      },
    ]);
  });
});
