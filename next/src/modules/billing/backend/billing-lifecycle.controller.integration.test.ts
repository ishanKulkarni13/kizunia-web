/**
 * Phase VI endpoints — HTTP contract, end to end: cancel, change-plan,
 * supersession on checkout, recovery, "check now" and the admin cancel.
 *
 * Only the session is faked (and, where a provider is needed, the runner or
 * service is given the fake). `Route.execute`, the rate limiter, validation,
 * authorization, the runner and the database are real. The integration setup
 * blanks `RAZORPAY_*`, so the default wiring runs in disabled mode.
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
import { cleanupBillingUsers, createBillingUser } from "@/testing/billing-sync-fixtures";
import { lifecycleCatalog, seedLive } from "@/testing/billing-lifecycle-fixtures";

import { FakeBillingProvider } from "../provider/fake-provider";
import { BillingAdminController } from "./admin.controller";
import { BillingSummaryService } from "./billing-summary.service";
import { AdminCancelService } from "./commands/admin-cancel";
import { CommandRunner } from "./commands/command-runner";
import { BillingController } from "./controller";
import { RecoveryService } from "./recovery.service";
import { SyncService } from "./sync/sync.service";

const PREFIX = "__vitest_billing_lifecycle_http__";
const KEY_ID = "rzp_test_lifecyclekey";

let fake: FakeBillingProvider;
let keys = 0;

const newKey = () => `key_${PREFIX}${Date.now()}_${(keys += 1)}`;

function post(path: string, body: unknown, idempotencyKey: string | null = newKey()) {
  const headers: Record<string, string> = { "content-type": "application/json" };

  if (idempotencyKey !== null) headers["idempotency-key"] = idempotencyKey;

  return new NextRequest(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body), headers });
}

const fakeRunner = () =>
  new CommandRunner({ providerFor: () => fake, resolvedMode: () => "TEST", assertEnabled: () => {}, catalog: lifecycleCatalog });

const recovery = () =>
  new RecoveryService({
    providerFor: () => fake,
    resolvedMode: () => "TEST",
    assertEnabled: () => {},
    keyId: () => KEY_ID,
    catalog: lifecycleCatalog,
    sync: new SyncService({ providerFor: () => fake, resolvedMode: () => "TEST", catalog: lifecycleCatalog }),
    summary: new BillingSummaryService({ resolvedMode: () => "TEST", catalog: lifecycleCatalog }),
  });

async function json(response: Response) {
  return {
    status: response.status,
    body: (await response.json()) as { success: boolean; data?: Record<string, unknown>; error?: { code: string; details?: Record<string, unknown> } },
  };
}

async function signIn(role: string = PlatformRole.USER) {
  const id = await createBillingUser(PREFIX, role.toLowerCase());
  await prisma.user.update({ where: { id }, data: { role } });
  session.actorId = id;
  session.role = role;

  return id;
}

beforeEach(async () => {
  fake = new FakeBillingProvider({ idPrefix: `sub_${PREFIX}${Date.now()}_` });
  await signIn();
});
afterEach(async () => {
  await prisma.rateLimit.deleteMany({ where: { key: { contains: PREFIX } } });
  await cleanupBillingUsers(PREFIX);
});
afterAll(async () => {
  await cleanupBillingUsers(PREFIX);
  await prisma.$disconnect();
});

describe("POST /api/v1/me/billing/cancel", () => {
  it("requires a session", async () => {
    session.actorId = "";

    expect((await BillingController.cancel(post("/api/v1/me/billing/cancel", { timing: "CYCLE_END" }))).status).toBe(401);
  });

  it("returns 503 BILLING_UNAVAILABLE in disabled mode and writes nothing", async () => {
    const { status, body } = await json(await BillingController.cancel(post("/api/v1/me/billing/cancel", { timing: "CYCLE_END" })));

    expect(status).toBe(503);
    expect(body.error?.code).toBe("BILLING_UNAVAILABLE");
    expect(await prisma.billingOperation.count({ where: { userId: session.actorId } })).toBe(0);
  });

  it("requires an Idempotency-Key and a timing", async () => {
    expect((await BillingController.cancel(post("/api/v1/me/billing/cancel", { timing: "CYCLE_END" }, null), fakeRunner())).status).toBe(400);
    expect((await BillingController.cancel(post("/api/v1/me/billing/cancel", {}), fakeRunner())).status).toBe(422);
    expect((await BillingController.cancel(post("/api/v1/me/billing/cancel", { timing: "NOW", userId: "x" }), fakeRunner())).status).toBe(422);
  });

  it("answers 200 with the requested cancellation, and its end date", async () => {
    const row = await seedLive(fake, session.actorId, { phase: "ACTIVE", now: new Date() });

    const { status, body } = await json(await BillingController.cancel(post("/api/v1/me/billing/cancel", { timing: "CYCLE_END" }), fakeRunner()));

    expect(status).toBe(200);
    expect(body.data).toMatchObject({ status: "CANCELLATION_REQUESTED", endsAt: row.currentPeriodEnd!.toISOString() });
  });

  it("answers 202 while the cancellation is being confirmed", async () => {
    await seedLive(fake, session.actorId, { phase: "PAST_DUE", now: new Date() });
    fake.failNext("cancelSubscription", "TIMEOUT");

    const { status, body } = await json(await BillingController.cancel(post("/api/v1/me/billing/cancel", { timing: "IMMEDIATE" }), fakeRunner()));

    expect(status).toBe(202);
    expect(body.data).toMatchObject({ status: "CONFIRMING" });
  });

  it("answers 409 with the current timing when it changed since the page loaded", async () => {
    await seedLive(fake, session.actorId, { phase: "PAST_DUE", now: new Date() });

    const { status, body } = await json(await BillingController.cancel(post("/api/v1/me/billing/cancel", { timing: "CYCLE_END" }), fakeRunner()));

    expect(status).toBe(409);
    expect(body.error).toMatchObject({ code: "BILLING_CANCELLATION_TIMING_CHANGED", details: { timing: "IMMEDIATE" } });
  });

  it("is rate-limited per user (billing:command)", async () => {
    const statuses: number[] = [];

    for (let i = 0; i < 21; i += 1) {
      statuses.push((await BillingController.cancel(post("/api/v1/me/billing/cancel", { timing: "IMMEDIATE" }))).status);
    }

    expect(statuses.slice(0, 20).every((status) => status === 503)).toBe(true);
    expect(statuses[20]).toBe(429);
  });
});

describe("POST /api/v1/me/billing/change-plan", () => {
  it("answers 409 PLAN_CHANGE_UNAVAILABLE with the reason, sending nothing, for the V1 limitation", async () => {
    await seedLive(fake, session.actorId, { phase: "ACTIVE", now: new Date(), advisoryPaymentMethod: "upi" });

    const { status, body } = await json(
      await BillingController.changePlan(post("/api/v1/me/billing/change-plan", { plan: "PRO_PLUS", cycle: "MONTHLY" }), fakeRunner()),
    );

    expect(status).toBe(409);
    expect(body.error).toMatchObject({ code: "BILLING_PLAN_CHANGE_UNAVAILABLE", details: { reason: "PAYMENT_METHOD" } });
    expect(fake.calls).toHaveLength(0);
  });

  it("answers 200 with the upgraded plan", async () => {
    await seedLive(fake, session.actorId, { phase: "ACTIVE", now: new Date(), advisoryPaymentMethod: "card", advisoryInternationalCard: true });

    const { status, body } = await json(
      await BillingController.changePlan(post("/api/v1/me/billing/change-plan", { plan: "PRO_PLUS", cycle: "MONTHLY" }), fakeRunner()),
    );

    expect(status).toBe(200);
    expect(body.data).toMatchObject({ status: "UPGRADED", plan: "PRO_PLUS" });
  });

  it("validates the body", async () => {
    expect((await BillingController.changePlan(post("/api/v1/me/billing/change-plan", { plan: "FREE" }), fakeRunner())).status).toBe(422);
  });
});

describe("POST /api/v1/me/billing/checkout — supersession", () => {
  it("accepts the supersession fields only together", async () => {
    const old = await seedLive(fake, session.actorId, { phase: "HALTED", now: new Date() });
    const request = post("/api/v1/me/billing/checkout", { plan: "PRO", cycle: "MONTHLY", supersedesSubscriptionId: old.id });

    expect((await BillingController.startCheckout(request, fakeRunner(), { keyId: () => KEY_ID })).status).toBe(422);
    expect(fake.calls).toHaveLength(0);
  });

  it("replaces an on-hold subscription with the explicit confirmation", async () => {
    const old = await seedLive(fake, session.actorId, { phase: "HALTED", now: new Date() });

    const { status, body } = await json(
      await BillingController.startCheckout(
        post("/api/v1/me/billing/checkout", { plan: "PRO", cycle: "MONTHLY", supersedesSubscriptionId: old.id, confirmSupersession: true }),
        fakeRunner(),
        { keyId: () => KEY_ID },
      ),
    );

    expect(status).toBe(200);
    expect(body.data).toMatchObject({ status: "CHECKOUT_READY", checkout: { keyId: KEY_ID } });
  });
});

describe("POST /api/v1/me/billing/recovery and /sync", () => {
  it("returns Razorpay's card-change parameters for the caller's own on-hold subscription", async () => {
    const row = await seedLive(fake, session.actorId, { phase: "HALTED", now: new Date() });

    const { status, body } = await json(await BillingController.recovery(post("/api/v1/me/billing/recovery", {}, null), recovery()));

    expect(status).toBe(200);
    expect(body.data).toEqual({ keyId: KEY_ID, subscriptionId: row.providerSubscriptionId });
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses recovery for a subscription that is not on hold", async () => {
    await seedLive(fake, session.actorId, { phase: "ACTIVE", now: new Date() });

    const { status, body } = await json(await BillingController.recovery(post("/api/v1/me/billing/recovery", {}, null), recovery()));

    expect(status).toBe(409);
    expect(body.error?.code).toBe("BILLING_NOT_RECOVERABLE");
  });

  it("'check now' observes a recovery made in Razorpay's flow, and answers with the summary", async () => {
    const row = await seedLive(fake, session.actorId, { phase: "HALTED", now: new Date(), provider: { rawStatus: "active" } });

    const { status, body } = await json(await BillingController.checkNow(post("/api/v1/me/billing/sync", {}, null), recovery()));

    expect(status).toBe(200);
    expect(body.data).toMatchObject({ syncOutcome: "APPLIED", plan: "PRO", subscription: { id: row.id, phase: "ACTIVE" } });
    expect(JSON.stringify(body.data)).not.toContain(row.providerSubscriptionId!);
  });
});

describe("GET /api/v1/me/billing — Phase VI fields", () => {
  it("shows the cancel timing, recovery and supersession for an on-hold subscription, with no provider identifier", async () => {
    const row = await seedLive(fake, session.actorId, { phase: "HALTED", now: new Date() });
    const service = new BillingSummaryService({ resolvedMode: () => "TEST", catalog: lifecycleCatalog });

    const { body } = await json(await BillingController.getMyBilling(new NextRequest("http://localhost/api/v1/me/billing"), service));

    expect(body.data).toMatchObject({
      subscription: { id: row.id, phase: "HALTED", scheduledChange: null },
      facets: { onHold: true, paused: false, cancellationNotEffective: false },
      allowedActions: { recover: true, supersede: { subscriptionId: row.id }, cancel: { timing: "IMMEDIATE" } },
    });
    expect(JSON.stringify(body.data)).not.toContain(row.providerSubscriptionId!);
  });
});

describe("POST /api/v1/admin/billing/subscriptions/{id}/cancel", () => {
  const adminService = () => new AdminCancelService(fakeRunner());

  it("refuses a normal user and an ADMIN (403), and a missing reason (422)", async () => {
    const customer = await createBillingUser(PREFIX, "customer");
    const row = await seedLive(fake, customer, { phase: "ACTIVE", now: new Date() });
    const path = `/api/v1/admin/billing/subscriptions/${row.id}/cancel`;

    expect((await BillingAdminController.cancelSubscription(post(path, { reason: "support" }), row.id, adminService())).status).toBe(403);

    await signIn(PlatformRole.ADMIN);
    expect((await BillingAdminController.cancelSubscription(post(path, { reason: "support" }), row.id, adminService())).status).toBe(403);

    await signIn(PlatformRole.SUPER_ADMIN);
    expect((await BillingAdminController.cancelSubscription(post(path, {}), row.id, adminService())).status).toBe(422);
    expect(fake.calls).toHaveLength(0);
  });

  it("requires an Idempotency-Key, then cancels with 200", async () => {
    await signIn(PlatformRole.SUPER_ADMIN);
    const customer = await createBillingUser(PREFIX, "customer");
    const row = await seedLive(fake, customer, { phase: "PAST_DUE", now: new Date() });
    const path = `/api/v1/admin/billing/subscriptions/${row.id}/cancel`;

    expect((await BillingAdminController.cancelSubscription(post(path, { reason: "support" }, null), row.id, adminService())).status).toBe(400);

    const { status, body } = await json(await BillingAdminController.cancelSubscription(post(path, { reason: "support" }), row.id, adminService()));

    expect(status).toBe(200);
    expect(body.data).toMatchObject({ status: "CANCELLED", subscriptionId: row.id, phase: "CANCELLED" });
  });
});
