import { describe, expect, it } from "vitest";

import type { ProviderConfiguration } from "./provider-mode";
import type { RazorpayRawResult, RazorpayRequestMethod, RazorpayRequestOptions } from "./razorpay/razorpay-client";
import { catalogSnippet, ensureTestPlans, resolvePlanSpecs, type PlanApiClient } from "./test-plan-setup";

const SENT = new Date("2026-09-25T00:00:00.000Z");

/** The owner's temporary TEST prices, as the spec file holds them. */
const OWNER_SPECS = resolvePlanSpecs(
  [
    { plan: "PRO", cycle: "MONTHLY", amountRupees: 10 },
    { plan: "PRO", cycle: "YEARLY", amountRupees: 12 },
    { plan: "PRO_PLUS", cycle: "MONTHLY", amountRupees: 20 },
    { plan: "PRO_PLUS", cycle: "YEARLY", amountRupees: 22 },
  ],
  1,
);

const testConfiguration: ProviderConfiguration = {
  mode: "TEST",
  razorpay: {
    keyId: "rzp_test_Unit00000000",
    keySecret: "secret-must-not-appear",
    webhookSecret: "webhook-secret",
    accountId: "acc_1",
    previousWebhookSecret: null,
    previousWebhookSecretUntil: null,
  },
};

interface Call {
  readonly method: RazorpayRequestMethod;
  readonly path: string;
  readonly options?: RazorpayRequestOptions;
}

/** An in-memory plans API: lists with count/skip, creates with an ID. */
class FakePlansApi implements PlanApiClient {
  readonly calls: Call[] = [];
  plans: Record<string, unknown>[] = [];
  private sequence = 0;

  async request(method: RazorpayRequestMethod, path: string, options?: RazorpayRequestOptions): Promise<RazorpayRawResult> {
    this.calls.push({ method, path, options });

    if (method === "GET") {
      const skip = Number(options?.query?.skip ?? 0);
      const count = Number(options?.query?.count ?? 10);

      return { kind: "RESPONSE", status: 200, body: { items: this.plans.slice(skip, skip + count) }, sentAt: SENT };
    }

    const body = options?.body as Record<string, unknown>;
    const plan = { id: `plan_new_${(this.sequence += 1)}`, ...body };
    this.plans.push(plan);

    return { kind: "RESPONSE", status: 200, body: plan, sentAt: SENT };
  }

  existing(key: string, overrides: Record<string, unknown> = {}, notes = true) {
    const spec = OWNER_SPECS.find((candidate) => candidate.key === key)!;

    this.plans.push({
      id: `plan_old_${key}`,
      period: spec.period,
      interval: 1,
      item: { name: spec.name, amount: spec.amountMinor, currency: "INR" },
      notes: notes ? { kz_catalog_key: key } : [],
      ...overrides,
    });
  }
}

function never(): never {
  throw new Error("unreachable");
}

const posts = (api: FakePlansApi) => api.calls.filter((c) => c.method === "POST");

describe("resolvePlanSpecs", () => {
  it("derives stable keys, names and paise from the spec", () => {
    expect(resolvePlanSpecs([{ plan: "PRO_PLUS", cycle: "YEARLY", amountRupees: 22 }], 1)).toEqual([
      {
        key: "TEST:v1:PRO_PLUS:YEARLY",
        name: "KZ-TEST v1 PRO_PLUS yearly",
        plan: "PRO_PLUS",
        cycle: "YEARLY",
        period: "yearly",
        interval: 1,
        amountMinor: 2200,
        currency: "INR",
      },
    ]);
  });
});

describe("ensureTestPlans", () => {
  it("creates the four owner-set TEST plans on an empty account, with the key in their notes", async () => {
    const api = new FakePlansApi();

    const result = await ensureTestPlans({ dryRun: false, configuration: testConfiguration, client: api });

    expect(result.ok).toBe(true);
    expect(result.entries.map((e) => [e.key, e.amountMinor, e.action])).toEqual([
      ["TEST:v1:PRO:MONTHLY", 1000, "CREATED"],
      ["TEST:v1:PRO:YEARLY", 1200, "CREATED"],
      ["TEST:v1:PRO_PLUS:MONTHLY", 2000, "CREATED"],
      ["TEST:v1:PRO_PLUS:YEARLY", 2200, "CREATED"],
    ]);
    expect(posts(api)[0].options?.body).toMatchObject({
      period: "monthly",
      interval: 1,
      item: { name: "KZ-TEST v1 PRO monthly", amount: 1000, currency: "INR" },
      notes: { kz_catalog_key: "TEST:v1:PRO:MONTHLY", kz_env: "TEST" },
    });
  });

  it("creates nothing on a rerun", async () => {
    const api = new FakePlansApi();
    await ensureTestPlans({ dryRun: false, configuration: testConfiguration, client: api });
    const before = posts(api).length;

    const again = await ensureTestPlans({ dryRun: false, configuration: testConfiguration, client: api });

    expect(posts(api)).toHaveLength(before);
    expect(again.entries.every((e) => e.action === "REUSED")).toBe(true);
  });

  it("reuses a plan found only by its exact name (an interrupted earlier run)", async () => {
    const api = new FakePlansApi();
    api.existing("TEST:v1:PRO:MONTHLY", {}, false);

    const result = await ensureTestPlans({ dryRun: false, configuration: testConfiguration, client: api });

    expect(result.entries[0]).toMatchObject({ action: "REUSED", providerPlanId: "plan_old_TEST:v1:PRO:MONTHLY" });
    expect(posts(api)).toHaveLength(3);
  });

  it("reports a plan that differs from the spec, overwrites nothing, and creates no second one", async () => {
    const api = new FakePlansApi();
    api.existing("TEST:v1:PRO:MONTHLY", { item: { name: "KZ-TEST v1 PRO monthly", amount: 999, currency: "INR" } });

    const result = await ensureTestPlans({ dryRun: false, configuration: testConfiguration, client: api });

    expect(result.ok).toBe(false);
    expect(result.entries[0]).toMatchObject({ action: "MISMATCH", differences: ["amount: expected 1000, found 999"] });
    expect(posts(api).map((c) => (c.options?.body as { item: { name: string } }).item.name)).not.toContain(
      "KZ-TEST v1 PRO monthly",
    );
    expect(catalogSnippet(result)).not.toContain("plan_old_TEST:v1:PRO:MONTHLY");
  });

  it("follows the listing past the first page", async () => {
    const api = new FakePlansApi();
    for (let i = 0; i < 150; i += 1) api.plans.push({ id: `plan_other_${i}`, item: { name: `other ${i}` } });
    api.existing("TEST:v1:PRO_PLUS:YEARLY");

    const result = await ensureTestPlans({ dryRun: false, configuration: testConfiguration, client: api });

    expect(result.entries[3]).toMatchObject({ action: "REUSED" });
    expect(api.calls.filter((c) => c.method === "GET").map((c) => c.options?.query?.skip)).toEqual([0, 100]);
  });

  it("sends no POST in a dry run", async () => {
    const api = new FakePlansApi();

    const result = await ensureTestPlans({ dryRun: true, configuration: testConfiguration, client: api });

    expect(posts(api)).toEqual([]);
    expect(result.entries.every((e) => e.action === "WOULD_CREATE")).toBe(true);
  });

  it("refuses LIVE and DISABLED before any request", async () => {
    const api = new FakePlansApi();
    const live: ProviderConfiguration = {
      mode: "LIVE",
      razorpay: { ...(testConfiguration.mode === "TEST" ? testConfiguration.razorpay : never()), keyId: "rzp_live_X" },
    };

    await expect(ensureTestPlans({ dryRun: true, configuration: live, client: api })).rejects.toThrow(/TEST mode/);
    await expect(ensureTestPlans({ dryRun: true, configuration: { mode: "DISABLED" }, client: api })).rejects.toThrow(/TEST mode/);
    expect(api.calls).toEqual([]);
  });

  it("never puts the key secret into its output", async () => {
    const api = new FakePlansApi();

    const result = await ensureTestPlans({ dryRun: false, configuration: testConfiguration, client: api });

    expect(JSON.stringify(result) + catalogSnippet(result)).not.toContain("secret-must-not-appear");
  });

  it("prints catalog entries with their temporary price noted", async () => {
    const api = new FakePlansApi();
    const result = await ensureTestPlans({ dryRun: false, configuration: testConfiguration, client: api });

    expect(catalogSnippet(result)).toContain('{ providerPlanId: "plan_new_1", plan: "PRO", cycle: "MONTHLY" },');
    expect(catalogSnippet(result)).toContain("temporary TEST-only price");
  });
});
