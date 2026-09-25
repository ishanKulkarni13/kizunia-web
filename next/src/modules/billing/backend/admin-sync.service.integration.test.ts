/**
 * Admin "sync now": the IB-15 role matrix, the outcomes an administrator sees,
 * the 409s, fail-closed when billing is disabled, and a DTO free of provider
 * identifiers.
 */
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { session } = vi.hoisted(() => ({ session: { actorId: "", role: "user" } }));

vi.mock("@/lib/auth/session", () => ({
  SessionService: {
    getStrictActor: vi.fn(async () => {
      if (!session.actorId) {
        const { AuthenticationError } = await import("@/lib/errors");
        throw new AuthenticationError({ status: 401, code: "UNAUTHORIZED", message: "User is not authenticated." });
      }
      return { id: session.actorId, role: session.role, banned: false };
    }),
  },
}));

import { PlatformRole } from "@/authorization";
import prisma from "@/lib/prisma";
import { cleanupBillingUsers, createBillingUser, insertBoundSubscription } from "@/testing/billing-sync-fixtures";

import { createPlanCatalog } from "../config/plan-catalog";
import { FakeBillingProvider } from "../provider/fake-provider";
import { BillingAdminController } from "./admin.controller";
import { AdminSyncService } from "./admin-sync.service";
import { SyncService } from "./sync/sync.service";

const PREFIX = "__vitest_billing_admin_sync__";
const T0 = new Date("2026-10-01T12:00:00.000Z");

let fake: FakeBillingProvider;

async function user(role: string) {
  const id = await createBillingUser(PREFIX, role.toLowerCase());
  await prisma.user.update({ where: { id }, data: { role } });

  return { id, role, banned: false };
}

function service() {
  return new AdminSyncService({
    assertEnabled: () => {},
    sync: new SyncService({
      providerFor: () => fake,
      resolvedMode: () => "TEST",
      now: () => T0,
      catalog: createPlanCatalog([{ providerPlanId: "plan_pro_m", plan: "PRO", cycle: "MONTHLY" }]),
    }),
  });
}

async function bound(overrides: Parameters<typeof insertBoundSubscription>[1] = {}) {
  const owner = await createBillingUser(PREFIX, "owner");
  const sub = await insertBoundSubscription(owner, { phase: "ACTIVE", ...overrides });

  if (sub.providerSubscriptionId) {
    fake.seed({ providerSubscriptionId: sub.providerSubscriptionId, rawStatus: "halted", providerPlanId: "plan_pro_m" });
  }

  return sub;
}

beforeEach(() => {
  fake = new FakeBillingProvider({ now: () => T0 });
});
afterEach(async () => {
  session.actorId = "";
  await cleanupBillingUsers(PREFIX);
});
afterAll(async () => {
  await cleanupBillingUsers(PREFIX);
  await prisma.$disconnect();
});

describe("AdminSyncService.syncNow", () => {
  it.each([PlatformRole.ADMIN, PlatformRole.SUPER_ADMIN])("lets %s sync, at priority 1, recorded as ADMIN_SYNC", async (role) => {
    const admin = await user(role);
    const sub = await bound();

    const dto = await service().syncNow(admin, sub.id);

    expect(dto).toMatchObject({ subscriptionId: sub.id, outcome: "APPLIED", phase: "HALTED", plan: "PRO", failureClass: null });
    expect(JSON.stringify(dto)).not.toContain(sub.providerSubscriptionId!);
    expect(await prisma.subscriptionHistoryEntry.findFirst({ where: { subscriptionId: sub.id } })).toMatchObject({
      trigger: "ADMIN_SYNC",
      actorUserId: admin.id,
    });
  });

  it.each([PlatformRole.MODERATOR, PlatformRole.USER])("refuses %s", async (role) => {
    const actor = await user(role);
    const sub = await bound();

    await expect(service().syncNow(actor, sub.id)).rejects.toMatchObject({ status: 403 });
    expect(fake.calls).toEqual([]);
  });

  it("reports a failed fetch as an outcome, not an error", async () => {
    const admin = await user(PlatformRole.ADMIN);
    const sub = await bound();
    fake.failNext("fetchSubscription", "UNAVAILABLE");

    expect(await service().syncNow(admin, sub.id)).toMatchObject({
      outcome: "FAILED",
      failureClass: "UNAVAILABLE",
      phase: "ACTIVE",
      syncAttempts: 1,
    });
  });

  it("answers 409 for a row another worker holds, or one not yet bound, and 404 for an unknown one", async () => {
    const admin = await user(PlatformRole.ADMIN);
    const leased = await bound({ syncLeaseUntil: new Date(T0.getTime() + 60_000) });
    const unbound = await bound({ phase: "PROVISIONING", providerSubscriptionId: null });

    await expect(service().syncNow(admin, leased.id)).rejects.toMatchObject({ status: 409, code: "BILLING_SYNC_IN_PROGRESS" });
    await expect(service().syncNow(admin, unbound.id)).rejects.toMatchObject({
      status: 409,
      code: "BILLING_SUBSCRIPTION_NOT_SYNCABLE",
    });
    await expect(service().syncNow(admin, "no-such-subscription")).rejects.toMatchObject({ status: 404 });
  });
});

describe("POST /api/v1/admin/billing/subscriptions/{id}/sync", () => {
  function post(id: string) {
    return new NextRequest(`http://localhost/api/v1/admin/billing/subscriptions/${id}/sync`, { method: "POST" });
  }

  it("requires a session", async () => {
    expect((await BillingAdminController.syncSubscription(post("x"), "x")).status).toBe(401);
  });

  it("refuses a moderator with 403", async () => {
    const moderator = await user(PlatformRole.MODERATOR);
    const sub = await bound();
    session.actorId = moderator.id;
    session.role = moderator.role;

    expect((await BillingAdminController.syncSubscription(post(sub.id), sub.id)).status).toBe(403);
  });

  it("fails closed with 503 BILLING_UNAVAILABLE when billing is disabled", async () => {
    const admin = await user(PlatformRole.ADMIN);
    const sub = await bound();
    session.actorId = admin.id;
    session.role = admin.role;

    // Integration tests run with no Razorpay credentials, so the mode is DISABLED.
    const response = await BillingAdminController.syncSubscription(post(sub.id), sub.id);

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("BILLING_UNAVAILABLE");
  });

  it("returns the DTO in the standard envelope for an admin", async () => {
    const admin = await user(PlatformRole.ADMIN);
    const sub = await bound();
    session.actorId = admin.id;
    session.role = admin.role;

    const response = await BillingAdminController.syncSubscription(post(sub.id), sub.id, service());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: { subscriptionId: sub.id, phase: "HALTED" } });
  });
});
