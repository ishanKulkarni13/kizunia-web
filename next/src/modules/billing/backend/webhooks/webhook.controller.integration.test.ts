/**
 * The HTTP edge: raw bytes in, a status out, and the follow-up scheduled after
 * the response. The route's runtime configuration is pinned beside the route.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import prisma from "@/lib/prisma";
import { cleanupBillingUsers, createBillingUser, insertBoundSubscription } from "@/testing/billing-sync-fixtures";

import { createPlanCatalog } from "../../config/plan-catalog";
import { FakeBillingProvider } from "../../provider/fake-provider";
import { SyncService } from "../sync/sync.service";
import { BillingWebhookController } from "./webhook.controller";
import { WebhookService } from "./webhook.service";

const PREFIX = "__vitest_billing_webhook_http__";
const T0 = new Date("2026-10-01T12:00:00.000Z");

let fake: FakeBillingProvider;

function service() {
  return new WebhookService({
    provider: () => fake,
    mode: () => "TEST",
    accountId: () => "acc_fake",
    sync: new SyncService({
      providerFor: () => fake,
      resolvedMode: () => "TEST",
      now: () => T0,
      catalog: createPlanCatalog([{ providerPlanId: "plan_pro_m", plan: "PRO", cycle: "MONTHLY" }]),
    }),
  });
}

function post(body: string, headers: Record<string, string>) {
  return new Request("https://kizunia.test/api/v1/webhooks/razorpay", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "203.0.113.7", ...headers },
    body,
  });
}

beforeEach(() => {
  fake = new FakeBillingProvider({ now: () => T0 });
});
afterEach(() => cleanupBillingUsers(PREFIX));
afterAll(async () => {
  await cleanupBillingUsers(PREFIX);
  await prisma.$disconnect();
});

describe("POST /api/v1/webhooks/razorpay", () => {
  it("verifies the raw bytes it received, answers 200, and syncs after the response", async () => {
    const userId = await createBillingUser(PREFIX);
    const sub = await insertBoundSubscription(userId, { phase: "ACTIVE" });
    const psub = sub.providerSubscriptionId!;
    fake.seed({ providerSubscriptionId: psub, rawStatus: "paused", providerPlanId: "plan_pro_m" });

    // Whitespace and key order a JSON round trip would change: the signature must still hold.
    const body = fake.webhookBody({ eventType: "subscription.paused", providerSubscriptionId: psub }).replace("{", "{ ");
    const scheduled: (() => Promise<void>)[] = [];

    const response = await BillingWebhookController.razorpay(
      post(body, { "x-razorpay-signature": fake.signWebhook(body), "x-razorpay-event-id": `evt_${PREFIX}${Date.now()}` }),
      (work) => scheduled.push(work),
      service(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    // Nothing fetched before the response.
    expect(fake.calls).toEqual([]);
    expect(scheduled).toHaveLength(1);

    await scheduled[0]();

    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).phase).toBe("PAUSED");
  });

  it("answers 400 to an unsigned delivery and schedules nothing", async () => {
    const scheduled: unknown[] = [];

    const response = await BillingWebhookController.razorpay(
      post(fake.webhookBody({ eventType: "subscription.paused" }), {}),
      (work) => scheduled.push(work),
      service(),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ received: false });
    expect(scheduled).toEqual([]);
  });
});
