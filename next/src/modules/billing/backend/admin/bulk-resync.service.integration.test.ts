/**
 * Admin bulk re-sync (Phase VIII): SUPER_ADMIN marks matching subscriptions
 * due, and nothing else. It never calls the provider; the rows drain through
 * the existing `billing:sync` path afterwards.
 *
 * The test database is shared, so exact counts are asserted against a dry-run
 * baseline taken before each scene is seeded.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { PlatformRole } from "@/authorization";
import { ForbiddenError } from "@/lib/errors";
import prisma from "@/lib/prisma";
import { actorWithRole, captureLogs } from "@/testing/billing-admin-fixtures";
import { cleanupBillingUsers, createBillingUser, insertBoundSubscription } from "@/testing/billing-sync-fixtures";

import { createPlanCatalog } from "../../config/plan-catalog";
import { BillingUnavailableError } from "../../errors";
import { FakeBillingProvider } from "../../provider/fake-provider";
import { BillingSyncTask } from "../reconciliation/billing-sync.task";
import { SyncService, drainPriorityFor } from "../sync/sync.service";
import { ProviderPriority } from "../../provider/types";
import { BulkResyncService } from "./bulk-resync.service";

const PREFIX = "__vitest_billing_admin_resync__";
const NOW = new Date("2026-10-01T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

const service = new BulkResyncService({ now: () => NOW, resolvedMode: () => "TEST" });

let fake: FakeBillingProvider;

beforeEach(() => {
  fake = new FakeBillingProvider({ now: () => NOW });
});
afterEach(async () => {
  await cleanupBillingUsers(PREFIX);
});
afterAll(async () => {
  await cleanupBillingUsers(PREFIX);
  await prisma.$disconnect();
});

async function baseline(): Promise<number> {
  const superAdmin = await actorWithRole(PREFIX, PlatformRole.SUPER_ADMIN);

  return (await service.resync(superAdmin, { reason: "baseline count", dryRun: true })).matched;
}

async function reload(id: string) {
  return prisma.subscription.findUniqueOrThrow({ where: { id } });
}

async function owner() {
  return createBillingUser(PREFIX, "owner");
}

describe("BulkResyncService.resync", () => {
  it("marks bound, non-terminal rows of the current mode due as ADMIN, and nothing else", async () => {
    const before = await baseline();
    const superAdmin = await actorWithRole(PREFIX, PlatformRole.SUPER_ADMIN);
    const userId = await owner();

    const active = await insertBoundSubscription(userId, { phase: "ACTIVE" });
    const halted = await insertBoundSubscription(userId, { phase: "HALTED", lastSyncedAt: new Date(NOW.getTime() - HOUR) });
    const pending = await insertBoundSubscription(userId, { phase: "PENDING_AUTHENTICATION" });
    // Never marked: terminal (a CHECK forbids a due terminal row), unbound, and another mode.
    const cancelled = await insertBoundSubscription(userId, { phase: "CANCELLED" });
    const unbound = await insertBoundSubscription(userId, { phase: "PROVISIONING", providerSubscriptionId: null });
    const live = await insertBoundSubscription(userId, { phase: "ACTIVE", providerMode: "LIVE" });

    const result = await service.resync(superAdmin, { reason: "webhook outage catch-up" });

    expect(result).toMatchObject({ mode: "TEST", dryRun: false, matched: before + 3, marked: before + 3 });

    for (const row of [active, halted, pending]) {
      const after = await reload(row.id);
      expect(after.syncDueAt).toEqual(NOW);
      expect(after.syncReason).toBe("ADMIN");
      // Not event-driven, and no other sync field is touched.
      expect(after.syncRequestedAt).toBeNull();
      expect(after.syncAttempts).toBe(row.syncAttempts);
      expect(after.phase).toBe(row.phase);
      expect(after.lastSyncedAt).toEqual(row.lastSyncedAt);
    }

    for (const row of [cancelled, unbound, live]) {
      const after = await reload(row.id);
      expect(after.syncDueAt).toBeNull();
      expect(after.syncReason).toBeNull();
      expect(after.updatedAt).toEqual(row.updatedAt);
    }
  });

  it("filters by lastSyncedAt, counting a never-synced row as older", async () => {
    const superAdmin = await actorWithRole(PREFIX, PlatformRole.SUPER_ADMIN);
    const userId = await owner();
    const cutoff = new Date(NOW.getTime() - 2 * HOUR);

    const stale = await insertBoundSubscription(userId, { lastSyncedAt: new Date(cutoff.getTime() - HOUR) });
    const neverSynced = await insertBoundSubscription(userId, { lastSyncedAt: null });
    const fresh = await insertBoundSubscription(userId, { lastSyncedAt: new Date(cutoff.getTime() + HOUR) });
    const exactlyAtCutoff = await insertBoundSubscription(userId, { lastSyncedAt: cutoff });

    await service.resync(superAdmin, { reason: "since the incident", lastSyncedBefore: cutoff.toISOString() });

    expect((await reload(stale.id)).syncDueAt).toEqual(NOW);
    expect((await reload(neverSynced.id)).syncDueAt).toEqual(NOW);
    // Strictly before: at the cutoff, and after it, stay untouched.
    expect((await reload(fresh.id)).syncDueAt).toBeNull();
    expect((await reload(exactlyAtCutoff.id)).syncDueAt).toBeNull();
  });

  it("keeps an earlier due time and never demotes a pending webhook sync", async () => {
    const superAdmin = await actorWithRole(PREFIX, PlatformRole.SUPER_ADMIN);
    const userId = await owner();
    const earlier = new Date(NOW.getTime() - 3 * HOUR);
    const requestedAt = new Date(NOW.getTime() - 3 * HOUR);

    const pendingWebhook = await insertBoundSubscription(userId, {
      syncDueAt: earlier,
      syncReason: "WEBHOOK",
      syncRequestedAt: requestedAt,
    });
    // In backoff: due in the future. Bulk re-sync pulls it forward, as ADMIN.
    const backingOff = await insertBoundSubscription(userId, {
      syncDueAt: new Date(NOW.getTime() + 5 * HOUR),
      syncReason: "RETRY",
      syncAttempts: 4,
    });

    await service.resync(superAdmin, { reason: "catch up everything" });

    const webhook = await reload(pendingWebhook.id);
    expect(webhook.syncDueAt).toEqual(earlier);
    expect(webhook.syncReason).toBe("WEBHOOK");
    expect(webhook.syncRequestedAt).toEqual(requestedAt);
    // A WEBHOOK row still drains at priority 2; an ADMIN row drains at priority 3.
    expect(drainPriorityFor(webhook)).toBe(ProviderPriority.CONFIRMATION);

    const retry = await reload(backingOff.id);
    expect(retry.syncDueAt).toEqual(NOW);
    expect(retry.syncReason).toBe("ADMIN");
    expect(retry.syncAttempts).toBe(4);
    expect(drainPriorityFor(retry)).toBe(ProviderPriority.RECONCILIATION);
  });

  it("writes nothing on a dry run", async () => {
    const before = await baseline();
    const superAdmin = await actorWithRole(PREFIX, PlatformRole.SUPER_ADMIN);
    const userId = await owner();
    const row = await insertBoundSubscription(userId);

    const result = await service.resync(superAdmin, { reason: "preview only", dryRun: true });

    expect(result).toMatchObject({ dryRun: true, matched: before + 1, marked: 0 });
    expect(await reload(row.id)).toEqual(row);
  });

  it("marks across several bounded batches", async () => {
    const before = await baseline();
    const superAdmin = await actorWithRole(PREFIX, PlatformRole.SUPER_ADMIN);
    const userId = await owner();
    const rows = await Promise.all([1, 2, 3, 4, 5].map(() => insertBoundSubscription(userId)));
    const batched = new BulkResyncService({ now: () => NOW, resolvedMode: () => "TEST", batchSize: 2 });

    const result = await batched.resync(superAdmin, { reason: "small batches" });

    expect(result).toMatchObject({ matched: before + 5, marked: before + 5 });
    for (const row of rows) expect((await reload(row.id)).syncDueAt).toEqual(NOW);
  });

  it("makes no provider call itself; the rows drain later through billing:sync", async () => {
    const superAdmin = await actorWithRole(PREFIX, PlatformRole.SUPER_ADMIN);
    const userId = await owner();
    const row = await insertBoundSubscription(userId, { phase: "ACTIVE", lastSyncedAt: null });
    fake.seed({ providerSubscriptionId: row.providerSubscriptionId as string, rawStatus: "halted", providerPlanId: "plan_pro_m" });

    await service.resync(superAdmin, { reason: "then drain them" });

    // Marked, but not synced: nothing has reached the provider.
    expect(fake.calls).toHaveLength(0);
    expect((await reload(row.id)).phase).toBe("ACTIVE");
    expect((await reload(row.id)).lastSyncedAt).toBeNull();

    // The existing sync path picks it up, through the provider seam.
    const task = new BillingSyncTask({
      resolvedMode: () => "TEST",
      now: () => NOW,
      health: () => null,
      unmatched: { resolvePending: async () => ({}) },
      sync: new SyncService({
        providerFor: () => fake,
        resolvedMode: () => "TEST",
        now: () => NOW,
        catalog: createPlanCatalog([{ providerPlanId: "plan_pro_m", plan: "PRO", cycle: "MONTHLY" }]),
      }),
    });
    await task.run({ budgetMs: 5_000 });

    expect(fake.calls.length).toBeGreaterThan(0);
    const synced = await reload(row.id);
    expect(synced.lastSyncedAt).not.toBeNull();
    expect(synced.phase).toBe("HALTED");
  });

  it("logs the action with the actor and reason", async () => {
    const superAdmin = await actorWithRole(PREFIX, PlatformRole.SUPER_ADMIN);
    const logs = await captureLogs();

    try {
      await service.resync(superAdmin, { reason: "audit me", lastSyncedBefore: "2026-09-30T00:00:00.000Z" });
    } finally {
      logs.stop();
    }

    expect(logs.records.find((r) => r.event === "resync.bulk_marked")?.fields).toMatchObject({
      actorUserId: superAdmin.id,
      mode: "TEST",
      reason: "audit me",
      lastSyncedBefore: "2026-09-30T00:00:00.000Z",
    });
  });

  it("refuses ADMIN, MODERATOR and USER, and marks nothing", async () => {
    const userId = await owner();
    const row = await insertBoundSubscription(userId);

    for (const role of [PlatformRole.ADMIN, PlatformRole.MODERATOR, PlatformRole.USER]) {
      await expect(
        service.resync(await actorWithRole(PREFIX, role), { reason: "not allowed to" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }

    expect((await reload(row.id)).syncDueAt).toBeNull();
  });

  it.each([[undefined], [""], ["ab"], ["   "]])("requires a reason (%j)", async (reason) => {
    const superAdmin = await actorWithRole(PREFIX, PlatformRole.SUPER_ADMIN);
    const userId = await owner();
    const row = await insertBoundSubscription(userId);

    await expect(
      service.resync(superAdmin, { reason } as unknown as { reason: string }),
    ).rejects.toBeInstanceOf(ZodError);
    expect((await reload(row.id)).syncDueAt).toBeNull();
  });

  it("rejects an unparseable date and unknown fields", async () => {
    const superAdmin = await actorWithRole(PREFIX, PlatformRole.SUPER_ADMIN);

    await expect(
      service.resync(superAdmin, { reason: "bad date", lastSyncedBefore: "yesterday" }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      service.resync(superAdmin, { reason: "extra field", mode: "LIVE" } as never),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("refuses with 503 when billing is disabled, marking nothing", async () => {
    const superAdmin = await actorWithRole(PREFIX, PlatformRole.SUPER_ADMIN);
    const userId = await owner();
    const row = await insertBoundSubscription(userId);
    const disabled = new BulkResyncService({ now: () => NOW, resolvedMode: () => "DISABLED" });

    await expect(disabled.resync(superAdmin, { reason: "billing is off" })).rejects.toBeInstanceOf(
      BillingUnavailableError,
    );
    expect((await reload(row.id)).syncDueAt).toBeNull();
  });
});
