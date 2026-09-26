/**
 * Billing health (Phase VIII): the table-derived summary read from real rows,
 * and its access rule (ADMIN and SUPER_ADMIN read; MODERATOR and USER do not).
 *
 * The test database is shared, so counts are asserted as deltas against a
 * baseline, and "oldest"/"last" values use timestamps no other row can beat.
 * The singleton marker rows the summary reads (`internal_job_run`,
 * `billing_provider_state`) are saved and restored.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { PlatformRole } from "@/authorization";
import { ForbiddenError } from "@/lib/errors";
import prisma from "@/lib/prisma";
import { actorWithRole, insertAnomaly, insertBillingEvent } from "@/testing/billing-admin-fixtures";
import {
  cleanupBillingUsers,
  createBillingUser,
  insertBoundSubscription,
  insertOperation,
} from "@/testing/billing-sync-fixtures";

import { BillingHealthService } from "./health.service";

const PREFIX = "__vitest_billing_admin_health__";
const NOW = new Date("2100-01-01T00:00:00.000Z");
const OLD = new Date("2000-01-01T00:00:00.000Z");
const JOB_ID = "billing:payload-prune";

const service = new BillingHealthService({ now: () => NOW, resolvedMode: () => "TEST", expectedMode: () => "TEST" });

let savedJob: Awaited<ReturnType<typeof prisma.internalJobRun.findUnique>>;
let savedState: Awaited<ReturnType<typeof prisma.billingProviderState.findUnique>>;

beforeEach(async () => {
  savedJob = await prisma.internalJobRun.findUnique({ where: { taskId: JOB_ID } });
  savedState = await prisma.billingProviderState.findUnique({ where: { providerMode: "TEST" } });
});
afterEach(async () => {
  await cleanupBillingUsers(PREFIX);

  if (savedJob) await prisma.internalJobRun.update({ where: { taskId: JOB_ID }, data: savedJob });
  else await prisma.internalJobRun.deleteMany({ where: { taskId: JOB_ID } });

  if (savedState) await prisma.billingProviderState.update({ where: { providerMode: "TEST" }, data: savedState });
  else await prisma.billingProviderState.deleteMany({ where: { providerMode: "TEST" } });
});
afterAll(async () => {
  await cleanupBillingUsers(PREFIX);
  await prisma.$disconnect();
});

function count<T extends { count: number }>(rows: readonly T[], match: (row: T) => boolean): number {
  return rows.find(match)?.count ?? 0;
}

describe("BillingHealthService.summary", () => {
  it("aggregates phases, backlog, anomalies, unknown operations, tasks, cooldown and webhooks", async () => {
    const admin = await actorWithRole(PREFIX, PlatformRole.ADMIN);
    const before = await service.summary(admin);
    const userId = await createBillingUser(PREFIX, "owner");

    const dueOld = await insertBoundSubscription(userId, { phase: "ACTIVE", syncDueAt: OLD, syncReason: "RETRY", syncAttempts: 2 });
    await insertBoundSubscription(userId, { phase: "ACTIVE" });
    await insertBoundSubscription(userId, { phase: "HALTED" });
    await insertBoundSubscription(userId, { phase: "ACTIVE", providerMode: "LIVE" });
    // Due in the future: not part of the backlog.
    await insertBoundSubscription(userId, { phase: "ACTIVE", syncDueAt: new Date(NOW.getTime() + 3_600_000) });

    await insertAnomaly(PREFIX, { type: "NOTES_CONFLICT" });
    await insertAnomaly(PREFIX, { type: "NOTES_CONFLICT" });
    await insertAnomaly(PREFIX, { type: "NOTES_CONFLICT", resolvedAt: NOW, resolutionReason: "done" });

    const unknown = await insertOperation(userId, { status: "OUTCOME_UNKNOWN", createdAt: OLD, kind: "CREATE_SUBSCRIPTION" });
    await insertOperation(userId, { status: "SUCCEEDED", createdAt: OLD, kind: "CANCEL_IMMEDIATELY" });

    await insertBillingEvent(PREFIX, { receivedAt: new Date("2099-12-30T00:00:00.000Z") });
    await insertBillingEvent(PREFIX, { receivedAt: new Date("2099-12-31T00:00:00.000Z"), matchedSecret: "PREVIOUS" });
    await insertBillingEvent(PREFIX, { receivedAt: new Date("2099-12-31T12:00:00.000Z") });

    await prisma.internalJobRun.upsert({
      where: { taskId: JOB_ID },
      create: { taskId: JOB_ID, lastRunAt: NOW, lastStatus: "ok", runCount: 7 },
      update: { lastRunAt: NOW, lastStatus: "ok", lastError: null, runCount: 7 },
    });
    await prisma.billingProviderState.upsert({
      where: { providerMode: "TEST" },
      create: { providerMode: "TEST", cooldownUntil: new Date(NOW.getTime() + 60_000), cooldownLevel: 3, consecutiveFailures: 5 },
      update: {
        cooldownUntil: new Date(NOW.getTime() + 60_000),
        cooldownLevel: 3,
        consecutiveFailures: 5,
        authFailurePinnedKeyFingerprint: null,
        orphanWatermark: new Date("2099-12-31T23:00:00.000Z"),
      },
    });

    const after = await service.summary(admin);

    const phase = (s: typeof after, providerMode: string, p: string) =>
      count(s.subscriptionsByPhase, (r) => r.providerMode === providerMode && r.phase === p);
    expect(phase(after, "TEST", "ACTIVE") - phase(before, "TEST", "ACTIVE")).toBe(3);
    expect(phase(after, "TEST", "HALTED") - phase(before, "TEST", "HALTED")).toBe(1);
    expect(phase(after, "LIVE", "ACTIVE") - phase(before, "LIVE", "ACTIVE")).toBe(1);

    const backlog = (s: typeof after) => s.dueBacklog.find((b) => b.providerMode === "TEST");
    expect(backlog(after)?.count).toBe((backlog(before)?.count ?? 0) + 1);
    expect(backlog(after)?.oldestDueAt).toBe(OLD.toISOString());
    expect(backlog(after)?.oldestDueAgeSeconds).toBe(Math.floor((NOW.getTime() - OLD.getTime()) / 1000));
    expect(after.oldestDue[0]).toMatchObject({ subscriptionId: dueOld.id, syncReason: "RETRY", syncAttempts: 2 });

    const notes = (s: typeof after) => count(s.openAnomaliesByType, (r) => r.type === "NOTES_CONFLICT");
    expect(notes(after) - notes(before)).toBe(2);

    expect(after.outcomeUnknown.count - before.outcomeUnknown.count).toBe(1);
    expect(after.outcomeUnknown.oldest[0]).toMatchObject({ operationId: unknown.id, kind: "CREATE_SUBSCRIPTION" });
    expect(after.outcomeUnknown.oldestCreatedAt).toBe(OLD.toISOString());

    expect(after.jobs.find((j) => j.taskId === JOB_ID)).toMatchObject({
      lastRunAt: NOW.toISOString(),
      lastStatus: "ok",
      runCount: 7,
    });

    expect(after.providerState.find((s) => s.providerMode === "TEST")).toMatchObject({
      cooldownActive: true,
      cooldownLevel: 3,
      consecutiveFailures: 5,
      authFailurePinned: false,
    });

    expect(after.webhooks.find((w) => w.providerMode === "TEST")).toMatchObject({
      lastReceivedAt: "2099-12-31T12:00:00.000Z",
      lastPreviousSecretMatchAt: "2099-12-31T00:00:00.000Z",
    });

    expect(after.providerMode).toBe("TEST");
    expect(after.expectedMode).toBe("TEST");
    expect(after.generatedAt).toBe(NOW.toISOString());
  });

  it("works with billing disabled, reporting the mode", async () => {
    const superAdmin = await actorWithRole(PREFIX, PlatformRole.SUPER_ADMIN);
    const disabled = new BillingHealthService({ now: () => NOW, resolvedMode: () => "DISABLED", expectedMode: () => "TEST" });

    await expect(disabled.summary(superAdmin)).resolves.toMatchObject({ providerMode: "DISABLED" });
  });

  it("lets ADMIN and SUPER_ADMIN read, and refuses MODERATOR and USER", async () => {
    await expect(service.summary(await actorWithRole(PREFIX, PlatformRole.ADMIN))).resolves.toBeDefined();
    await expect(service.summary(await actorWithRole(PREFIX, PlatformRole.SUPER_ADMIN))).resolves.toBeDefined();

    for (const role of [PlatformRole.MODERATOR, PlatformRole.USER]) {
      await expect(service.summary(await actorWithRole(PREFIX, role))).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("carries no raw payload or secret", async () => {
    const admin = await actorWithRole(PREFIX, PlatformRole.SUPER_ADMIN);
    await insertBillingEvent(PREFIX, { rawPayload: { payload: { customer_email: "SENTINEL-health@example.test" } } });

    const text = JSON.stringify(await service.summary(admin));

    expect(text).not.toContain("SENTINEL-health");
    expect(text).not.toContain("rawPayload");
  });
});
