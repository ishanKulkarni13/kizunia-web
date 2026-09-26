/**
 * Admin anomalies (Phase VIII): ADMIN reads, SUPER_ADMIN resolves with a
 * mandatory reason; resolution is an acknowledgement that changes no billing
 * state, is safe under concurrency, and lets a re-detection open a new anomaly.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { PlatformRole } from "@/authorization";
import { ForbiddenError } from "@/lib/errors";
import prisma from "@/lib/prisma";
import { actorWithRole, captureLogs, insertAnomaly } from "@/testing/billing-admin-fixtures";
import {
  cleanupBillingUsers,
  createBillingUser,
  insertBoundSubscription,
  insertOperation,
} from "@/testing/billing-sync-fixtures";

import { BillingAnomalyAlreadyResolvedError, BillingAnomalyNotFoundError } from "../../errors";
import { BillingAnomalyRepository } from "../anomalies/anomaly.repository";
import { AnomalyAdminService } from "./anomaly-admin.service";

const PREFIX = "__vitest_billing_admin_anomaly__";
const NOW = new Date("2026-10-01T12:00:00.000Z");

const service = new AnomalyAdminService({ now: () => NOW });

afterEach(async () => {
  await cleanupBillingUsers(PREFIX);
});
afterAll(async () => {
  await cleanupBillingUsers(PREFIX);
  await prisma.$disconnect();
});

describe("AnomalyAdminService.resolve", () => {
  it("records the actor, the reason and the time, and changes no other billing row", async () => {
    const superAdmin = await actorWithRole(PREFIX, PlatformRole.SUPER_ADMIN);
    const userId = await createBillingUser(PREFIX, "owner");
    const subscription = await insertBoundSubscription(userId);
    const operation = await insertOperation(userId, { subscriptionId: subscription.id });
    const anomaly = await insertAnomaly(PREFIX, { userId, subscriptionIds: [subscription.id] });

    const logs = await captureLogs();
    let result;
    try {
      result = await service.resolve(superAdmin, anomaly.id, { reason: "  Cancelled the duplicate  " });
    } finally {
      logs.stop();
    }

    expect(result).toMatchObject({
      id: anomaly.id,
      resolvedAt: NOW.toISOString(),
      resolutionReason: "Cancelled the duplicate",
      resolvedBy: { id: superAdmin.id },
    });

    const row = await prisma.billingAnomaly.findUniqueOrThrow({ where: { id: anomaly.id } });
    expect(row).toMatchObject({ resolvedByUserId: superAdmin.id, resolutionReason: "Cancelled the duplicate" });

    // Nothing else moved: an acknowledgement, not a fix.
    const [subscriptionAfter, operationAfter] = await Promise.all([
      prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } }),
      prisma.billingOperation.findUniqueOrThrow({ where: { id: operation.id } }),
    ]);
    expect(subscriptionAfter).toEqual(subscription);
    expect(operationAfter).toEqual(operation);
    expect(await prisma.subscriptionHistoryEntry.count({ where: { subscriptionId: subscription.id } })).toBe(0);

    const event = logs.records.find((r) => r.event === "anomaly.resolved");
    expect(event?.fields).toMatchObject({
      anomalyId: anomaly.id,
      by: "admin",
      actorUserId: superAdmin.id,
      reason: "Cancelled the duplicate",
      type: "MULTIPLE_OPEN_SUBSCRIPTIONS",
    });
  });

  it.each([[undefined], [""], ["  "], ["ab"], ["x".repeat(501)]])("refuses the reason %j", async (reason) => {
    const superAdmin = await actorWithRole(PREFIX, PlatformRole.SUPER_ADMIN);
    const anomaly = await insertAnomaly(PREFIX);

    await expect(
      service.resolve(superAdmin, anomaly.id, { reason } as unknown as { reason: string }),
    ).rejects.toBeInstanceOf(ZodError);

    expect((await prisma.billingAnomaly.findUniqueOrThrow({ where: { id: anomaly.id } })).resolvedAt).toBeNull();
  });

  it("lets exactly one of several concurrent resolutions win, and 409s the rest", async () => {
    const admins = await Promise.all(
      [1, 2, 3, 4, 5].map(() => actorWithRole(PREFIX, PlatformRole.SUPER_ADMIN)),
    );
    const anomaly = await insertAnomaly(PREFIX);

    const settled = await Promise.allSettled(
      admins.map((admin, index) => service.resolve(admin, anomaly.id, { reason: `resolved by admin ${index}` })),
    );

    const fulfilled = settled.filter((s) => s.status === "fulfilled");
    const rejected = settled.filter((s): s is PromiseRejectedResult => s.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    for (const r of rejected) expect(r.reason).toBeInstanceOf(BillingAnomalyAlreadyResolvedError);

    // The recorded resolver is the winner's, with the winner's own reason (never a mix).
    const row = await prisma.billingAnomaly.findUniqueOrThrow({ where: { id: anomaly.id } });
    const winner = admins.findIndex((admin) => admin.id === row.resolvedByUserId);
    expect(winner).toBeGreaterThanOrEqual(0);
    expect(row.resolutionReason).toBe(`resolved by admin ${winner}`);
  });

  it("refuses an already-resolved anomaly with 409 and an unknown one with 404", async () => {
    const superAdmin = await actorWithRole(PREFIX, PlatformRole.SUPER_ADMIN);
    const anomaly = await insertAnomaly(PREFIX);

    await service.resolve(superAdmin, anomaly.id, { reason: "first decision" });

    await expect(service.resolve(superAdmin, anomaly.id, { reason: "second decision" })).rejects.toBeInstanceOf(
      BillingAnomalyAlreadyResolvedError,
    );
    expect((await prisma.billingAnomaly.findUniqueOrThrow({ where: { id: anomaly.id } })).resolutionReason).toBe(
      "first decision",
    );

    await expect(service.resolve(superAdmin, `${PREFIX}missing`, { reason: "no such anomaly" })).rejects.toBeInstanceOf(
      BillingAnomalyNotFoundError,
    );
  });

  it("lets a re-detection open a new anomaly and leaves the resolved one resolved", async () => {
    const superAdmin = await actorWithRole(PREFIX, PlatformRole.SUPER_ADMIN);
    const subjectKey = `user:${PREFIX}redetect-${Date.now()}`;
    const input = {
      type: "MULTIPLE_OPEN_SUBSCRIPTIONS",
      providerMode: "TEST",
      subjectKey,
      details: { note: "detected" },
    } as const;

    const first = await BillingAnomalyRepository.raise(prisma, input, NOW);
    expect(first).toMatchObject({ opened: true, occurrences: 1 });

    // While open, a repeat only bumps the same row.
    const repeat = await BillingAnomalyRepository.raise(prisma, input, NOW);
    expect(repeat).toMatchObject({ id: first.id, opened: false, occurrences: 2 });

    await service.resolve(superAdmin, first.id, { reason: "handled by support" });

    const again = await BillingAnomalyRepository.raise(prisma, input, NOW);
    expect(again.opened).toBe(true);
    expect(again.id).not.toBe(first.id);
    expect(again.occurrences).toBe(1);

    const rows = await prisma.billingAnomaly.findMany({ where: { subjectKey }, orderBy: { firstSeenAt: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === first.id)?.resolvedAt).not.toBeNull();
    expect(rows.find((r) => r.id === again.id)?.resolvedAt).toBeNull();
  });

  it("refuses ADMIN, MODERATOR and USER, and resolves nothing", async () => {
    const anomaly = await insertAnomaly(PREFIX);

    for (const role of [PlatformRole.ADMIN, PlatformRole.MODERATOR, PlatformRole.USER]) {
      await expect(
        service.resolve(await actorWithRole(PREFIX, role), anomaly.id, { reason: "not allowed to" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }

    expect((await prisma.billingAnomaly.findUniqueOrThrow({ where: { id: anomaly.id } })).resolvedAt).toBeNull();
  });
});

describe("AnomalyAdminService.list and detail", () => {
  it("lets ADMIN list and inspect, without the manage flag", async () => {
    const admin = await actorWithRole(PREFIX, PlatformRole.ADMIN);
    const anomaly = await insertAnomaly(PREFIX);

    const list = await service.list(admin, { userId: undefined });
    expect(list.permissions).toEqual({ canManageBilling: false, canViewRawPayloads: false });
    expect(list.items.some((a) => a.id === anomaly.id)).toBe(true);

    const detail = await service.detail(admin, anomaly.id);
    expect(detail).toMatchObject({ id: anomaly.id, details: { note: "fixture" }, resolvedBy: null });
    expect(detail.permissions.canManageBilling).toBe(false);

    await expect(service.detail(admin, `${PREFIX}missing`)).rejects.toBeInstanceOf(BillingAnomalyNotFoundError);
  });

  it("filters by status, type and user, open first", async () => {
    const admin = await actorWithRole(PREFIX, PlatformRole.ADMIN);
    const userId = await createBillingUser(PREFIX, "listed");
    const older = await insertAnomaly(PREFIX, { userId, lastSeenAt: new Date("2026-09-01T00:00:00.000Z") });
    const newerResolved = await insertAnomaly(PREFIX, {
      userId,
      lastSeenAt: new Date("2026-09-30T00:00:00.000Z"),
      resolvedAt: NOW,
      resolutionReason: "done",
    });
    const otherType = await insertAnomaly(PREFIX, { userId, type: "NOTES_CONFLICT" });

    const all = await service.list(admin, { userId, status: "ALL" });
    // Open rows before the resolved one, though the resolved one was seen more recently than `older`.
    expect(all.items.map((a) => a.id)).toEqual([otherType.id, older.id, newerResolved.id]);

    expect((await service.list(admin, { userId })).items.map((a) => a.id)).toEqual([otherType.id, older.id]);
    expect((await service.list(admin, { userId, status: "RESOLVED" })).items.map((a) => a.id)).toEqual([
      newerResolved.id,
    ]);
    expect((await service.list(admin, { userId, type: "NOTES_CONFLICT" })).items.map((a) => a.id)).toEqual([
      otherType.id,
    ]);

    const page = await service.list(admin, { userId, status: "ALL", limit: "2", page: "2" });
    expect(page.items).toHaveLength(1);
    expect(page.pagination).toMatchObject({ page: 2, limit: 2, total: 3, hasPreviousPage: true });
  });

  it("refuses MODERATOR and USER", async () => {
    for (const role of [PlatformRole.MODERATOR, PlatformRole.USER]) {
      const actor = await actorWithRole(PREFIX, role);
      await expect(service.list(actor, {})).rejects.toBeInstanceOf(ForbiddenError);
      await expect(service.detail(actor, "anything")).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});
