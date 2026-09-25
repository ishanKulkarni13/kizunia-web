import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createPlanCatalog } from "../../config/plan-catalog";
import type { RazorpayCredentials } from "../provider-mode";
import { RazorpayClient } from "./razorpay-client";
import { RazorpayBillingProvider } from "./razorpay-provider";

const KEY_ID = "rzp_test_AbCdEf123456";
const KEY_SECRET = "the-key-secret";
const WEBHOOK_SECRET = "the-webhook-secret";

const credentials: RazorpayCredentials = {
  keyId: KEY_ID,
  keySecret: KEY_SECRET,
  webhookSecret: WEBHOOK_SECRET,
  accountId: "acc_Test",
  previousWebhookSecret: null,
  previousWebhookSecretUntil: null,
};

const catalog = createPlanCatalog([
  { providerPlanId: "plan_PRO_M", plan: "PRO", cycle: "MONTHLY" },
  { providerPlanId: "plan_PLUS_Y", plan: "PRO_PLUS", cycle: "YEARLY" },
]);

const SUBSCRIPTION = {
  id: "sub_ABC",
  plan_id: "plan_PRO_M",
  status: "created",
  notes: [],
  short_url: "https://rzp.io/i/abc",
  expire_by: 1_790_100_000,
};

interface Recorded {
  readonly url: URL;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
  readonly signal: AbortSignal | null | undefined;
}

/** A `fetch` stub that records requests and answers from a queue. */
function stubFetch(answers: Array<{ status: number; body?: unknown; text?: string } | Error>) {
  const requests: Recorded[] = [];

  const impl = (async (input: URL | string, init?: RequestInit) => {
    requests.push({
      url: new URL(input.toString()),
      method: init?.method ?? "GET",
      headers: init?.headers as Record<string, string>,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
      signal: init?.signal,
    });

    const answer = answers.shift();

    if (answer === undefined) throw new Error("no answer queued");
    if (answer instanceof Error) throw answer;

    const text = answer.text ?? (answer.body === undefined ? "" : JSON.stringify(answer.body));

    return new Response(text, { status: answer.status });
  }) as typeof fetch;

  return { impl, requests };
}

function providerWith(
  answers: Array<{ status: number; body?: unknown; text?: string } | Error>,
  options: { now?: () => Date; timeoutMs?: number; creds?: RazorpayCredentials } = {},
) {
  const { impl, requests } = stubFetch(answers);
  const now = options.now ?? (() => new Date("2026-09-25T10:00:00.000Z"));
  const creds = options.creds ?? credentials;

  const client = new RazorpayClient({
    keyId: creds.keyId,
    keySecret: creds.keySecret,
    fetch: impl,
    now,
    timeoutMs: options.timeoutMs,
  });

  return { provider: new RazorpayBillingProvider(creds, "TEST", { client, catalog, now }), requests };
}

const SENT_AT = new Date("2026-09-25T10:00:00.000Z");

describe("RazorpayBillingProvider — requests", () => {
  it("authenticates with HTTP Basic, and never puts a key in the URL or body", async () => {
    const { provider, requests } = providerWith([{ status: 200, body: SUBSCRIPTION }]);

    await provider.fetchSubscription("sub_ABC");

    const [request] = requests;
    const expected = `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")}`;

    expect(request.headers.Authorization).toBe(expected);
    expect(request.url.toString()).not.toContain(KEY_SECRET);
    expect(JSON.stringify(request.body ?? "")).not.toContain(KEY_SECRET);
  });

  it("fetches a subscription with GET /subscriptions/:id, encoding the id", async () => {
    const { provider, requests } = providerWith([{ status: 200, body: SUBSCRIPTION }]);

    await provider.fetchSubscription("sub_A/../B");

    expect(requests[0].method).toBe("GET");
    expect(requests[0].url.pathname).toBe("/v1/subscriptions/sub_A%2F..%2FB");
    expect(requests[0].url.origin).toBe("https://api.razorpay.com");
    expect(requests[0].body).toBeUndefined();
  });

  it("creates a subscription with the catalog's plan id, the notes and epoch-second times", async () => {
    const { provider, requests } = providerWith([{ status: 200, body: SUBSCRIPTION }]);

    await provider.createSubscription({
      plan: "PRO",
      cycle: "MONTHLY",
      totalCount: 600,
      expireBy: new Date("2026-09-26T10:00:00.500Z"),
      notes: { kz_sub: "ksub_1", kz_op: "kop_1", kz_env: "TEST" },
    });

    expect(requests[0].method).toBe("POST");
    expect(requests[0].url.pathname).toBe("/v1/subscriptions");
    expect(requests[0].headers["Content-Type"]).toBe("application/json");
    expect(requests[0].body).toEqual({
      plan_id: "plan_PRO_M",
      total_count: 600,
      expire_by: Math.floor(new Date("2026-09-26T10:00:00.500Z").getTime() / 1000),
      notes: { kz_sub: "ksub_1", kz_op: "kop_1", kz_env: "TEST" },
    });
  });

  it("sends start_at and offer_id only when given", async () => {
    const { provider, requests } = providerWith([{ status: 200, body: SUBSCRIPTION }]);

    await provider.createSubscription({
      plan: "PRO_PLUS",
      cycle: "YEARLY",
      totalCount: 50,
      expireBy: new Date("2026-09-26T10:00:00Z"),
      startAt: new Date("2026-10-25T10:00:00Z"),
      offerId: "offer_ABC",
      notes: { kz_sub: "s", kz_op: "o", kz_env: "TEST" },
    });

    expect(requests[0].body).toMatchObject({
      plan_id: "plan_PLUS_Y",
      start_at: Math.floor(new Date("2026-10-25T10:00:00Z").getTime() / 1000),
      offer_id: "offer_ABC",
    });
  });

  it("cancels immediately or at cycle end with cancel_at_cycle_end 0 / 1", async () => {
    const { provider, requests } = providerWith([
      { status: 200, body: { ...SUBSCRIPTION, status: "cancelled" } },
      { status: 200, body: SUBSCRIPTION },
    ]);

    await provider.cancelSubscription("sub_ABC", { atCycleEnd: false });
    await provider.cancelSubscription("sub_ABC", { atCycleEnd: true });

    expect(requests.map((request) => [request.method, request.url.pathname, request.body])).toEqual([
      ["POST", "/v1/subscriptions/sub_ABC/cancel", { cancel_at_cycle_end: 0 }],
      ["POST", "/v1/subscriptions/sub_ABC/cancel", { cancel_at_cycle_end: 1 }],
    ]);
  });

  it("updates a plan with PATCH and the schedule, and cancels a scheduled change", async () => {
    const { provider, requests } = providerWith([
      { status: 200, body: SUBSCRIPTION },
      { status: 200, body: SUBSCRIPTION },
      { status: 200, body: SUBSCRIPTION },
    ]);

    await provider.updateSubscriptionPlan("sub_ABC", { plan: "PRO_PLUS", cycle: "YEARLY", scheduleChangeAt: "NOW" });
    await provider.updateSubscriptionPlan("sub_ABC", { plan: "PRO_PLUS", cycle: "YEARLY", scheduleChangeAt: "CYCLE_END" });
    await provider.cancelScheduledChange("sub_ABC");

    expect(requests.map((request) => [request.method, request.url.pathname, request.body])).toEqual([
      ["PATCH", "/v1/subscriptions/sub_ABC", { plan_id: "plan_PLUS_Y", schedule_change_at: "now" }],
      ["PATCH", "/v1/subscriptions/sub_ABC", { plan_id: "plan_PLUS_Y", schedule_change_at: "cycle_end" }],
      ["POST", "/v1/subscriptions/sub_ABC/cancel_scheduled_changes", {}],
    ]);
  });

  it("lists by creation window and page, bounding the page size to 100", async () => {
    const { provider, requests } = providerWith([
      { status: 200, body: { entity: "collection", count: 0, items: [] } },
      { status: 200, body: { entity: "collection", count: 0, items: [] } },
    ]);
    const window = { from: new Date("2026-09-25T09:00:00Z"), to: new Date("2026-09-25T10:00:00Z") };

    await provider.listSubscriptions(window, { count: 100, skip: 200 });
    await provider.listSubscriptions(window, { count: 5_000, skip: -3 });

    expect(Object.fromEntries(requests[0].url.searchParams)).toEqual({
      from: String(Math.floor(window.from.getTime() / 1000)),
      to: String(Math.floor(window.to.getTime() / 1000)),
      count: "100",
      skip: "200",
    });
    expect(requests[1].url.searchParams.get("count")).toBe("100");
    expect(requests[1].url.searchParams.get("skip")).toBe("0");
  });

  it("reads an authorization payment method from GET /payments/:id", async () => {
    const { provider, requests } = providerWith([
      { status: 200, body: { id: "pay_1", method: "card", international: false } },
    ]);

    const outcome = await provider.fetchAuthorizationPaymentMethod("pay_1");

    expect(requests[0].url.pathname).toBe("/v1/payments/pay_1");
    expect(outcome).toMatchObject({ kind: "SUCCESS", value: { method: "card", international: false } });
  });
});

describe("RazorpayBillingProvider — results", () => {
  it("returns the mapped state, with the provider status untouched", async () => {
    const { provider } = providerWith([{ status: 200, body: { ...SUBSCRIPTION, status: "halted" } }]);

    expect(await provider.fetchSubscription("sub_ABC")).toMatchObject({
      kind: "SUCCESS",
      value: { providerSubscriptionId: "sub_ABC", rawStatus: "halted", providerPlanId: "plan_PRO_M" },
    });
  });

  it("stamps observationAt with the time the request was SENT, not when the answer came back", async () => {
    let clock = SENT_AT.getTime();
    const now = () => new Date(clock);

    // The answer takes 4 seconds. The observation time must still be the send time.
    const slowFetch = (async () => {
      clock += 4_000;

      return new Response(JSON.stringify(SUBSCRIPTION), { status: 200 });
    }) as typeof fetch;

    const client = new RazorpayClient({ keyId: KEY_ID, keySecret: KEY_SECRET, fetch: slowFetch, now });
    const provider = new RazorpayBillingProvider(credentials, "TEST", { client, catalog, now });

    const outcome = await provider.fetchSubscription("sub_ABC");

    expect(outcome.kind).toBe("SUCCESS");
    expect(outcome.kind === "SUCCESS" && outcome.observationAt).toEqual(SENT_AT);
    expect(now().getTime()).toBe(SENT_AT.getTime() + 4_000);
  });
});

describe("RazorpayBillingProvider — failures are classified, and carry when the request was sent", () => {
  const cases: Array<[number, unknown, string]> = [
    [401, { error: { code: "BAD_REQUEST_ERROR", description: "Authentication failed" } }, "AUTH_FAILURE"],
    [404, { error: { code: "BAD_REQUEST_ERROR", description: "The id provided does not exist" } }, "NOT_FOUND"],
    [429, { error: { code: "BAD_REQUEST_ERROR", description: "Too many requests" } }, "RATE_LIMITED"],
    [400, { error: { code: "BAD_REQUEST_ERROR", description: "Subscription is not cancellable in expired status." } }, "REJECTED"],
    [500, { error: { code: "SERVER_ERROR", description: "Something went wrong" } }, "UNAVAILABLE"],
    [502, undefined, "UNAVAILABLE"],
    [
      400,
      { error: { code: "BAD_REQUEST_ERROR", description: "Another subscription operation is in progress" } },
      "CONCURRENT_OPERATION",
    ],
  ];

  it.each(cases)("HTTP %i is %s", async (status, body, failureClass) => {
    const { provider } = providerWith([{ status, body }]);

    const outcome = await provider.cancelSubscription("sub_ABC", { atCycleEnd: false });

    expect(outcome).toMatchObject({ kind: "FAILURE", failureClass, requestSentAt: SENT_AT });
  });

  it("keeps the provider's code and description for diagnosis", async () => {
    const { provider } = providerWith([
      { status: 400, body: { error: { code: "BAD_REQUEST_ERROR", description: "No Pending update for this subscription" } } },
    ]);

    expect(await provider.cancelScheduledChange("sub_ABC")).toMatchObject({
      failureClass: "REJECTED",
      providerErrorCode: "BAD_REQUEST_ERROR",
      providerErrorDescription: "No Pending update for this subscription",
    });
  });

  it("reports a dropped connection as TIMEOUT, with the send time (outcome unknown for a mutation)", async () => {
    const { provider } = providerWith([new TypeError("fetch failed")]);

    expect(await provider.cancelSubscription("sub_ABC", { atCycleEnd: false })).toEqual({
      kind: "FAILURE",
      failureClass: "TIMEOUT",
      requestSentAt: SENT_AT,
    });
  });

  it("abandons a request that outlives its timeout, as TIMEOUT", async () => {
    // A fetch that only ever ends by being aborted.
    const hanging = ((_: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as typeof fetch;

    const client = new RazorpayClient({ keyId: KEY_ID, keySecret: KEY_SECRET, fetch: hanging, timeoutMs: 25 });
    const provider = new RazorpayBillingProvider(credentials, "TEST", { client, catalog });

    const started = Date.now();
    const outcome = await provider.fetchSubscription("sub_ABC");

    expect(outcome).toMatchObject({ kind: "FAILURE", failureClass: "TIMEOUT" });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("gives every request a bounded signal", async () => {
    const { provider, requests } = providerWith([{ status: 200, body: SUBSCRIPTION }]);

    await provider.fetchSubscription("sub_ABC");

    expect(requests[0].signal).toBeInstanceOf(AbortSignal);
  });

  it("reports a 2xx with an unreadable body as MALFORMED, with the send time", async () => {
    for (const answer of [
      { status: 200, text: "<html>maintenance</html>" },
      { status: 200, text: "" },
      { status: 200, body: { ...SUBSCRIPTION, status: "suspended" } },
      { status: 200, body: { id: "sub_ABC" } },
    ]) {
      const { provider } = providerWith([answer]);

      const outcome = await provider.cancelSubscription("sub_ABC", { atCycleEnd: false });

      expect(outcome).toMatchObject({ kind: "FAILURE", failureClass: "MALFORMED", requestSentAt: SENT_AT });
    }
  });

  it("never puts a secret in a failure", async () => {
    const { provider } = providerWith([{ status: 401, body: { error: { code: "BAD_REQUEST_ERROR", description: "bad key" } } }]);

    const outcome = await provider.fetchSubscription("sub_ABC");

    expect(JSON.stringify(outcome)).not.toContain(KEY_SECRET);
    expect(JSON.stringify(outcome)).not.toContain(KEY_ID);
  });
});

describe("RazorpayBillingProvider — an unmapped plan is refused before anything is sent", () => {
  it("fails a create for a plan and cycle with no current catalog entry", async () => {
    const { provider, requests } = providerWith([]);

    const outcome = await provider.createSubscription({
      plan: "PRO_PLUS",
      cycle: "MONTHLY",
      totalCount: 600,
      expireBy: new Date("2026-09-26T10:00:00Z"),
      notes: { kz_sub: "s", kz_op: "o", kz_env: "TEST" },
    });

    expect(outcome).toEqual({ kind: "FAILURE", failureClass: "UNMAPPED_PLAN" });
    expect(requests).toHaveLength(0);
  });

  it("fails a plan update the same way, and never sends a retired plan", async () => {
    const retiredOnly = createPlanCatalog([
      { providerPlanId: "plan_OLD", plan: "PRO", cycle: "MONTHLY", retired: true },
    ]);
    const { impl, requests } = stubFetch([]);
    const client = new RazorpayClient({ keyId: KEY_ID, keySecret: KEY_SECRET, fetch: impl });
    const provider = new RazorpayBillingProvider(credentials, "TEST", { client, catalog: retiredOnly });

    const outcome = await provider.updateSubscriptionPlan("sub_ABC", {
      plan: "PRO",
      cycle: "MONTHLY",
      scheduleChangeAt: "NOW",
    });

    expect(outcome).toEqual({ kind: "FAILURE", failureClass: "UNMAPPED_PLAN" });
    expect(requests).toHaveLength(0);
  });

  it("uses the shipped per-mode catalog by default (empty until plans are configured)", async () => {
    const { impl, requests } = stubFetch([]);
    const client = new RazorpayClient({ keyId: KEY_ID, keySecret: KEY_SECRET, fetch: impl });
    const provider = new RazorpayBillingProvider(credentials, "TEST", { client });

    const outcome = await provider.createSubscription({
      plan: "PRO",
      cycle: "MONTHLY",
      totalCount: 600,
      expireBy: new Date("2026-09-26T10:00:00Z"),
      notes: { kz_sub: "s", kz_op: "o", kz_env: "TEST" },
    });

    expect(outcome).toMatchObject({ kind: "FAILURE", failureClass: "UNMAPPED_PLAN" });
    expect(requests).toHaveLength(0);
  });
});

describe("RazorpayBillingProvider — verification uses the configured secrets", () => {
  const body = '{"event":"subscription.charged"}';
  const sign = (secret: string, message: string) => createHmac("sha256", secret).update(message).digest("hex");

  it("verifies a webhook against the current secret", () => {
    const { provider } = providerWith([]);

    expect(provider.verifyWebhookSignature(body, sign(WEBHOOK_SECRET, body))).toEqual({
      valid: true,
      matchedSecret: "CURRENT",
    });
    expect(provider.verifyWebhookSignature(body, sign("other", body))).toEqual({ valid: false });
  });

  it("does not verify a webhook with the API key secret: they are different secrets", () => {
    const { provider } = providerWith([]);

    expect(provider.verifyWebhookSignature(body, sign(KEY_SECRET, body))).toEqual({ valid: false });
  });

  it("accepts the previous secret only inside its window", () => {
    const rotating: RazorpayCredentials = {
      ...credentials,
      previousWebhookSecret: "the-old-secret",
      previousWebhookSecretUntil: new Date("2026-10-01T00:00:00Z"),
    };
    const { provider } = providerWith([], { creds: rotating });
    const signature = sign("the-old-secret", body);

    expect(provider.verifyWebhookSignature(body, signature, new Date("2026-09-30T23:59:59Z"))).toEqual({
      valid: true,
      matchedSecret: "PREVIOUS",
    });
    expect(provider.verifyWebhookSignature(body, signature, new Date("2026-10-01T00:00:00Z"))).toEqual({
      valid: false,
    });
  });

  it("verifies a checkout with the API key secret and the server-held subscription id", () => {
    const { provider } = providerWith([]);
    const signature = sign(KEY_SECRET, "pay_1|sub_HELD");

    expect(provider.verifyCheckoutSignature("pay_1", "sub_HELD", signature)).toBe(true);
    expect(provider.verifyCheckoutSignature("pay_1", "sub_ECHOED", signature)).toBe(false);
  });
});
