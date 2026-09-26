/**
 * Checkout endpoints — HTTP contract, end to end.
 *
 * Only the session is faked (and, where a provider is needed, the runner is
 * given the fake). `Route.execute`, the rate limiter, validation, the runner
 * and the database are real. The integration setup blanks `RAZORPAY_*`, so the
 * default wiring runs in disabled mode, which is itself a contract to check.
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

import prisma from "@/lib/prisma";
import { cleanupBillingUsers, createBillingUser } from "@/testing/billing-sync-fixtures";

import { createOfferCatalog } from "../config/offer-catalog";
import { createPlanCatalog } from "../config/plan-catalog";
import { FakeBillingProvider } from "../provider/fake-provider";
import { CommandRunner } from "./commands/command-runner";
import { BillingController } from "./controller";
import { createStaticOfferCodeSource } from "./offers/offer-code-source";

const PREFIX = "__vitest_billing_checkout_http__";
const catalog = createPlanCatalog([{ providerPlanId: "plan_fake_PRO_MONTHLY", plan: "PRO", cycle: "MONTHLY" }]);

let fake: FakeBillingProvider;
let keys = 0;

function checkoutRequest(body: unknown, idempotencyKey: string | null = `key_${PREFIX}${Date.now()}_${(keys += 1)}`) {
  const headers: Record<string, string> = { "content-type": "application/json" };

  if (idempotencyKey !== null) headers["idempotency-key"] = idempotencyKey;

  return new NextRequest("http://localhost/api/v1/me/billing/checkout", { method: "POST", body: JSON.stringify(body), headers });
}

const fakeRunner = () =>
  new CommandRunner({ providerFor: () => fake, resolvedMode: () => "TEST", assertEnabled: () => {}, catalog });

async function json(response: Response) {
  return { status: response.status, body: (await response.json()) as { success: boolean; data?: Record<string, unknown>; error?: { code: string } } };
}

beforeEach(async () => {
  fake = new FakeBillingProvider({ idPrefix: `sub_${PREFIX}${Date.now()}_` });
  session.actorId = await createBillingUser(PREFIX);
});
afterEach(async () => {
  await prisma.rateLimit.deleteMany({ where: { key: { contains: PREFIX } } });
  await cleanupBillingUsers(PREFIX);
});
afterAll(async () => {
  await cleanupBillingUsers(PREFIX);
  await prisma.$disconnect();
});

describe("POST /api/v1/me/billing/checkout", () => {
  it("requires a session", async () => {
    session.actorId = "";

    const { status } = await json(await BillingController.startCheckout(checkoutRequest({ plan: "PRO", cycle: "MONTHLY" })));

    expect(status).toBe(401);
  });

  it("returns 503 BILLING_UNAVAILABLE in disabled mode and writes nothing", async () => {
    const { status, body } = await json(await BillingController.startCheckout(checkoutRequest({ plan: "PRO", cycle: "MONTHLY" })));

    expect(status).toBe(503);
    expect(body.error?.code).toBe("BILLING_UNAVAILABLE");
    expect(await prisma.billingOperation.count({ where: { userId: session.actorId } })).toBe(0);
    expect(await prisma.subscription.count({ where: { userId: session.actorId } })).toBe(0);
  });

  it("requires an Idempotency-Key header", async () => {
    const response = await BillingController.startCheckout(checkoutRequest({ plan: "PRO", cycle: "MONTHLY" }, null), fakeRunner());
    const { status, body } = await json(response);

    expect(status).toBe(400);
    expect(body.error?.code).toBe("BILLING_IDEMPOTENCY_KEY_REQUIRED");
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses every field that would let a client decide a commercial term, and another user", async () => {
    const tampered = [{ kind: "TRIAL" }, { userId: "someone-else" }, { price: 1 }, { discount: 100 }, { offerId: "offer_abc" }, { startAt: "2027-01-01T00:00:00Z" }, { trialEligible: true }];

    for (const extra of tampered) {
      const response = await BillingController.startCheckout(checkoutRequest({ plan: "PRO", cycle: "MONTHLY", ...extra }), fakeRunner());

      expect(response.status, JSON.stringify(extra)).toBe(422);
    }

    expect(fake.calls).toHaveLength(0);
  });

  describe("trials and codes (Phase VII)", () => {
    const offers = createStaticOfferCodeSource(() =>
      createOfferCatalog([
        { marketingCode: "WELCOME", providerOfferId: "offer_opaque_http", appliesTo: [{ plan: "PRO", cycle: "MONTHLY" }], eligibility: "ANY_USER", description: "Half off" },
      ]),
    );
    const deps = { keyId: () => "rzp_test_serverkey", offers };

    it("starts a trial: 200 with checkout parameters, a TRIAL subscription, and the start sent from the server's own record", async () => {
      const { status, body } = await json(await BillingController.startCheckout(checkoutRequest({ plan: "PRO", cycle: "MONTHLY", trial: true }), fakeRunner(), deps));

      expect(status).toBe(200);
      expect(body.data).toMatchObject({ status: "CHECKOUT_READY" });
      expect(await prisma.subscription.findFirstOrThrow({ where: { userId: session.actorId } })).toMatchObject({ kind: "TRIAL" });
      expect((fake.calls.find((call) => call.method === "createSubscription")!.args[0] as { startAt: Date }).startAt).toBeInstanceOf(Date);
    });

    it("applies a code: the provider's Offer is sent to Razorpay and never returned to the browser", async () => {
      const { status, body } = await json(await BillingController.startCheckout(checkoutRequest({ plan: "PRO", cycle: "MONTHLY", code: "welcome" }), fakeRunner(), deps));

      expect(status).toBe(200);
      expect(fake.calls.find((call) => call.method === "createSubscription")!.args[0]).toMatchObject({ offerId: "offer_opaque_http" });
      expect(JSON.stringify(body)).not.toMatch(/offer_opaque_http|offerId|offer_id/);
    });

    it("answers 422 BILLING_CODE_INVALID for an unknown code, before any provider call", async () => {
      const { status, body } = await json(await BillingController.startCheckout(checkoutRequest({ plan: "PRO", cycle: "MONTHLY", code: "NOPE" }), fakeRunner(), deps));

      expect(status).toBe(422);
      expect(body.error?.code).toBe("BILLING_CODE_INVALID");
      expect(fake.calls).toHaveLength(0);
    });

    it("answers 422 BILLING_CODE_NOT_ALLOWED_ON_TRIAL for a code with a trial, before any provider call", async () => {
      const { status, body } = await json(await BillingController.startCheckout(checkoutRequest({ plan: "PRO", cycle: "MONTHLY", trial: true, code: "WELCOME" }), fakeRunner(), deps));

      expect(status).toBe(422);
      expect(body.error?.code).toBe("BILLING_CODE_NOT_ALLOWED_ON_TRIAL");
      expect(fake.calls).toHaveLength(0);
    });

    it("answers 409 BILLING_TRIAL_NOT_ELIGIBLE once a trial was used, before any provider call", async () => {
      await prisma.subscription.create({
        data: { userId: session.actorId, kind: "TRIAL", providerMode: "TEST", plan: "PRO", cycle: "MONTHLY", phase: "CANCELLED", firstContributedAt: new Date() },
      });

      const { status, body } = await json(await BillingController.startCheckout(checkoutRequest({ plan: "PRO", cycle: "MONTHLY", trial: true }), fakeRunner(), deps));

      expect(status).toBe(409);
      expect(body.error?.code).toBe("BILLING_TRIAL_NOT_ELIGIBLE");
      expect(fake.calls).toHaveLength(0);
    });

    it("is rate-limited per user like every checkout", async () => {
      const statuses: number[] = [];

      for (let i = 0; i < 11; i += 1) {
        statuses.push((await BillingController.startCheckout(checkoutRequest({ plan: "PRO", cycle: "MONTHLY", code: `NOPE${i}` }), fakeRunner(), deps)).status);
      }

      expect(statuses.slice(0, 10).every((status) => status === 422)).toBe(true);
      expect(statuses[10]).toBe(429);
    });
  });

  it("returns checkout parameters with the server's key id, and the same answer for the same key", async () => {
    const key = `key_${PREFIX}same_${Date.now()}`;

    const keyId = { keyId: () => "rzp_test_serverkey" };
    const first = await json(await BillingController.startCheckout(checkoutRequest({ plan: "PRO", cycle: "MONTHLY" }, key), fakeRunner(), keyId));
    const second = await json(await BillingController.startCheckout(checkoutRequest({ plan: "PRO", cycle: "MONTHLY" }, key), fakeRunner(), keyId));

    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ status: "CHECKOUT_READY", checkout: { keyId: "rzp_test_serverkey", plan: "PRO", cycle: "MONTHLY" } });
    expect(second.body.data).toEqual(first.body.data);
    expect(fake.calls.filter((call) => call.method === "createSubscription")).toHaveLength(1);
  });

  it("answers 202 while the outcome is being confirmed", async () => {
    fake.failNext("createSubscription", "TIMEOUT");

    const { status, body } = await json(await BillingController.startCheckout(checkoutRequest({ plan: "PRO", cycle: "MONTHLY" }), fakeRunner()));

    expect(status).toBe(202);
    expect(body.data).toMatchObject({ status: "CONFIRMING" });
  });

  it("is rate-limited per user (billing:checkout)", async () => {
    const statuses: number[] = [];

    for (let i = 0; i < 11; i += 1) {
      statuses.push((await BillingController.startCheckout(checkoutRequest({ plan: "PRO", cycle: "MONTHLY" }))).status);
    }

    expect(statuses.slice(0, 10).every((status) => status === 503)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe("POST /api/v1/me/billing/checkout/confirm", () => {
  it("returns 503 in disabled mode", async () => {
    const request = new NextRequest("http://localhost/api/v1/me/billing/checkout/confirm", {
      method: "POST",
      body: JSON.stringify({ razorpayPaymentId: "pay_1", razorpaySignature: "sig" }),
      headers: { "content-type": "application/json" },
    });

    const { status, body } = await json(await BillingController.confirmCheckout(request));

    expect(status).toBe(503);
    expect(body.error?.code).toBe("BILLING_UNAVAILABLE");
  });

  it("validates the body", async () => {
    const request = new NextRequest("http://localhost/api/v1/me/billing/checkout/confirm", {
      method: "POST",
      body: JSON.stringify({ razorpayPaymentId: "pay_1" }),
      headers: { "content-type": "application/json" },
    });

    expect((await BillingController.confirmCheckout(request)).status).toBe(422);
  });
});

describe("GET /api/v1/me/billing", () => {
  it("answers in disabled mode, with billing unavailable and no actions", async () => {
    const { status, body } = await json(await BillingController.getMyBilling(new NextRequest("http://localhost/api/v1/me/billing")));

    expect(status).toBe(200);
    expect(body.data).toMatchObject({ billingAvailable: false, plan: "FREE", allowedActions: { startCheckout: [] } });
  });
});
