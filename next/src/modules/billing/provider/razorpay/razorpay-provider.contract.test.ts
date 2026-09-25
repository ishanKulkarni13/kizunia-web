/**
 * Razorpay provider contract suite (opt-in, TEST mode only).
 *
 * Every other test of the Razorpay implementation runs against a stubbed
 * `fetch`, so it proves Kizunia handles the responses it *expects*. This suite
 * is the only thing that checks the expectations themselves: it calls the real
 * Razorpay TEST API and asserts that the provider classifies and maps what
 * really comes back. "All tests pass on admin grants" is never read as
 * "Razorpay integration verified" (docs/architecture/subscription/cross-cutting/
 * testing-without-razorpay.md).
 *
 * Run it with `pnpm test:contract`. It is never part of `pnpm test`, the
 * integration suite or CI, because it:
 *  - needs network access and Razorpay TEST keys (RAZORPAY_KEY_ID and
 *    RAZORPAY_KEY_SECRET, an `rzp_test_` pair; it refuses anything else);
 *  - creates real TEST-mode subscriptions, and cancels every one it creates;
 *  - creates at most one TEST plan, and reuses it on every later run, because
 *    Razorpay has no API to delete plans (RAZORPAY_CONTRACT_PLAN_ID pins one).
 *
 * What it covers (docs/architecture/subscription/implementation/test-strategy.md):
 * create, fetch, immediate cancel, cycle-end cancel, update refusals classified
 * REJECTED, list-window inclusivity and `expire_by` lag. States that need a
 * customer to authenticate (authenticated, active, pending, halted, paused)
 * cannot be reached by an API-only suite, so they run only against
 * subscriptions an engineer supplies by id:
 *
 *   RAZORPAY_CONTRACT_AUTHENTICATED_SUBSCRIPTION_ID   (and _ACTIVE_, _PENDING_,
 *   _HALTED_, _PAUSED_)
 *
 * Supplied subscriptions are only READ, unless RAZORPAY_CONTRACT_MUTATE_SUPPLIED=1
 * also lets the suite cancel them to check the cancellation behavior.
 * RAZORPAY_CONTRACT_SLOW=1 adds the `expire_by` lag check, which waits minutes.
 * RAZORPAY_CONTRACT_BASE_URL points the suite at a local stand-in, to test the
 * suite's own mechanics; the report then says `isRealRazorpay: false`, and such a
 * run is never recorded as a provider observation.
 *
 * Everything observed is written to a JSON report (RAZORPAY_CONTRACT_REPORT, or a
 * file in the OS temp directory) so it can be recorded in
 * docs/architecture/subscription/provider-boundary/razorpay-facts.md. A failing
 * assertion here means the design's expectation and Razorpay disagree, which is
 * exactly what this suite exists to find.
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPlanCatalog } from "../../config/plan-catalog";
import type { RazorpayCredentials } from "../provider-mode";
import type { Outcome, ProviderSubscriptionState } from "../types";
import { RazorpayClient } from "./razorpay-client";
import { RazorpayBillingProvider } from "./razorpay-provider";

const ENABLED = process.env.RAZORPAY_CONTRACT === "1";
const SLOW = process.env.RAZORPAY_CONTRACT_SLOW === "1";
const MUTATE_SUPPLIED = process.env.RAZORPAY_CONTRACT_MUTATE_SUPPLIED === "1";

const KEY_ID = process.env.RAZORPAY_KEY_ID ?? "";
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET ?? "";

// Only for testing the suite itself against a local stand-in for the API. A run
// that sets this proves nothing about Razorpay, and its report says so.
const BASE_URL = process.env.RAZORPAY_CONTRACT_BASE_URL?.trim() || undefined;
const TARGET = BASE_URL ?? "https://api.razorpay.com/v1";

// Razorpay ids are a fixed prefix plus 14 characters. An id of any other length
// is a routing miss at the gateway, not a lookup, so an id meant to be "well
// formed but unknown" must have exactly this shape.
const UNKNOWN_SUBSCRIPTION_ID = "sub_AAAAAAAAAAAAAA";
const UNKNOWN_PAYMENT_ID = "pay_AAAAAAAAAAAAAA";

const PLAN_NAME = "KZ-CONTRACT monthly INR 1";
const REPORT_PATH =
  process.env.RAZORPAY_CONTRACT_REPORT ?? join(tmpdir(), "kizunia-razorpay-contract-report.json");

const SUPPLIED_STATES = ["AUTHENTICATED", "ACTIVE", "PENDING", "HALTED", "PAUSED"] as const;

const credentials: RazorpayCredentials = {
  keyId: KEY_ID,
  keySecret: KEY_SECRET,
  // Neither is used by an API call.
  webhookSecret: "contract-suite-unused",
  accountId: "contract-suite-unused",
  previousWebhookSecret: null,
  previousWebhookSecretUntil: null,
};

function clientWith(keySecret: string = KEY_SECRET, timeoutMs?: number): RazorpayClient {
  return new RazorpayClient({ keyId: KEY_ID, keySecret, baseUrl: BASE_URL, timeoutMs });
}

let client: RazorpayClient;
let provider: RazorpayBillingProvider;
let planId: string;

const created: string[] = [];
const observations: Array<{ readonly name: string; readonly observed: unknown }> = [];

function observe(name: string, observed: unknown): void {
  observations.push({ name, observed });
}

function succeeded<T>(outcome: Outcome<T>): T {
  if (outcome.kind !== "SUCCESS") {
    throw new Error(`expected SUCCESS, got ${JSON.stringify(outcome)}`);
  }

  return outcome.value;
}

function classOf<T>(outcome: Outcome<T>): string {
  return outcome.kind === "FAILURE" ? outcome.failureClass : outcome.kind;
}

/** The raw status and error body Razorpay returned, for the record. */
async function rawGet(path: string) {
  const raw = await client.request("GET", path);

  return raw.kind === "RESPONSE" ? { status: raw.status, body: raw.body } : { status: null, body: null };
}

async function createSubscription(overrides: { expireBy?: Date; totalCount?: number } = {}) {
  const state = succeeded(
    await provider.createSubscription({
      plan: "PRO",
      cycle: "MONTHLY",
      totalCount: overrides.totalCount ?? 12,
      expireBy: overrides.expireBy ?? new Date(Date.now() + 60 * 60 * 1000),
      notes: { kz_sub: "ksub_contract", kz_op: "kop_contract", kz_env: "TEST" },
    }),
  );

  created.push(state.providerSubscriptionId);

  return state;
}

/** Finds the reusable contract plan, or creates it once. */
async function ensureContractPlan(): Promise<string> {
  const pinned = process.env.RAZORPAY_CONTRACT_PLAN_ID?.trim();

  if (pinned) return pinned;

  const list = await client.request("GET", "/plans", { query: { count: 100 } });
  const items =
    list.kind === "RESPONSE" && typeof list.body === "object" && list.body !== null
      ? ((list.body as { items?: Array<{ id: string; item?: { name?: string } }> }).items ?? [])
      : [];

  const existing = items.find((plan) => plan.item?.name === PLAN_NAME);

  if (existing) return existing.id;

  const made = await client.request("POST", "/plans", {
    body: {
      period: "monthly",
      interval: 1,
      item: { name: PLAN_NAME, amount: 100, currency: "INR", description: "Kizunia provider contract suite" },
    },
  });

  if (made.kind !== "RESPONSE" || made.status !== 200) {
    throw new Error(`could not create the contract plan: ${JSON.stringify(made)}`);
  }

  return (made.body as { id: string }).id;
}

describe.skipIf(!ENABLED)("Razorpay provider contract (TEST mode)", () => {
  beforeAll(async () => {
    if (!KEY_ID.startsWith("rzp_test_")) {
      throw new Error(
        "The contract suite runs only against Razorpay TEST mode. Set RAZORPAY_KEY_ID to an rzp_test_ key (and RAZORPAY_KEY_SECRET).",
      );
    }

    if (!KEY_SECRET) throw new Error("RAZORPAY_KEY_SECRET is not set.");

    client = clientWith();

    // Fail on the real cause, once, before any test runs, instead of as a
    // confusing assertion in the middle of the suite.
    const preflight = await client.request("GET", "/plans", { query: { count: 1 } });

    if (preflight.kind === "NO_RESPONSE") {
      throw new Error("Could not reach the Razorpay API (network failure or timeout). Check connectivity.");
    }

    if (preflight.status === 401 || preflight.status === 403) {
      throw new Error(
        "Razorpay rejected the credentials (HTTP " +
          preflight.status +
          "). RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be a current, matching TEST key pair: " +
          "regenerate them in the Razorpay Dashboard (TEST mode > Account & Settings > API Keys) and update .env.",
      );
    }

    planId = await ensureContractPlan();
    observe("plan", { planId, name: PLAN_NAME });

    provider = new RazorpayBillingProvider(credentials, "TEST", {
      client,
      catalog: createPlanCatalog([{ providerPlanId: planId, plan: "PRO", cycle: "MONTHLY" }]),
    });
  });

  afterAll(async () => {
    // Leave nothing running in the TEST account.
    const cleanup: Array<{ id: string; outcome: string }> = [];

    for (const id of created) {
      const outcome = await provider.cancelSubscription(id, { atCycleEnd: false });
      cleanup.push({ id, outcome: classOf(outcome) });
    }

    observe("cleanup", cleanup);

    writeFileSync(
      REPORT_PATH,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          target: TARGET,
          // A stand-in target is never a provider observation.
          isRealRazorpay: BASE_URL === undefined,
          mode: "TEST",
          planId,
          created,
          observations,
        },
        null,
        2,
      ),
    );
  });

  describe("create and fetch", () => {
    let subscription: ProviderSubscriptionState;

    it("creates a subscription in `created`, with a hosted page and Kizunia's notes echoed back", async () => {
      const expireBy = new Date(Date.now() + 60 * 60 * 1000);
      const outcome = await provider.createSubscription({
        plan: "PRO",
        cycle: "MONTHLY",
        totalCount: 12,
        expireBy,
        notes: { kz_sub: "ksub_contract", kz_op: "kop_contract", kz_env: "TEST" },
      });

      subscription = succeeded(outcome);
      created.push(subscription.providerSubscriptionId);

      expect(subscription.providerSubscriptionId).toMatch(/^sub_/);
      expect(subscription.rawStatus).toBe("created");
      expect(subscription.providerPlanId).toBe(planId);
      expect(subscription.shortUrl).toMatch(/^https:\/\//);
      expect(subscription.notes).toEqual({ kz_sub: "ksub_contract", kz_op: "kop_contract", kz_env: "TEST" });
      expect(subscription.expireBy?.getTime()).toBe(Math.floor(expireBy.getTime() / 1000) * 1000);
      expect(subscription.hasScheduledChanges).toBe(false);
      expect(subscription.paidCount).toBe(0);
      expect(outcome.kind === "SUCCESS" && outcome.observationAt.getTime()).toBeLessThanOrEqual(Date.now());

      observe("create", { rawStatus: subscription.rawStatus, hasShortUrl: true, notes: subscription.notes });
    });

    it("fetches what it created, unchanged", async () => {
      const fetched = succeeded(await provider.fetchSubscription(subscription.providerSubscriptionId));

      expect(fetched).toMatchObject({
        providerSubscriptionId: subscription.providerSubscriptionId,
        rawStatus: "created",
        providerPlanId: planId,
        notes: subscription.notes,
      });
      // Not authenticated yet: nothing to read for these.
      expect(fetched.currentStart).toBeNull();
      expect(fetched.chargeAt).toBeNull();
    });

    it("records the raw entity's field shapes, including the undocumented ones (D3)", async () => {
      const { status, body } = await rawGet(`/subscriptions/${subscription.providerSubscriptionId}`);
      const entity = body as Record<string, unknown>;

      expect(status).toBe(200);

      observe("entity", {
        fields: Object.keys(entity).sort(),
        notesType: Array.isArray(entity.notes) ? "array" : typeof entity.notes,
        paymentMethod: entity.payment_method,
        haltedAt: entity.halted_at,
        hasScheduledChanges: entity.has_scheduled_changes,
        changeScheduledAtType: entity.change_scheduled_at === null ? "null" : typeof entity.change_scheduled_at,
        changeScheduledAt: entity.change_scheduled_at,
        createdAtType: typeof entity.created_at,
      });
    });

    // The design expected a 404 (NOT_FOUND) for an ID that does not exist. TEST
    // showed otherwise (2026-09-25): a WELL-FORMED unknown ID is a 400
    // BAD_REQUEST_ERROR, which classifies as REJECTED, indistinguishable by status
    // and code from any other business refusal. The tests below pin what Razorpay
    // actually does; see razorpay-facts.md and the Phase III open items.
    it("reports a well-formed unknown subscription as REJECTED (a 400), not NOT_FOUND", async () => {
      const outcome = await provider.fetchSubscription(UNKNOWN_SUBSCRIPTION_ID);
      const raw = await rawGet(`/subscriptions/${UNKNOWN_SUBSCRIPTION_ID}`);

      observe("unknown-subscription", { class: classOf(outcome), httpStatus: raw.status, body: raw.body });

      expect(raw.status).toBe(400);
      expect(classOf(outcome)).toBe("REJECTED");
      expect(outcome).toMatchObject({ providerErrorCode: "BAD_REQUEST_ERROR" });
    });

    it("reports a well-formed unknown payment as REJECTED (a 400), not NOT_FOUND", async () => {
      const outcome = await provider.fetchAuthorizationPaymentMethod(UNKNOWN_PAYMENT_ID);
      const raw = await rawGet(`/payments/${UNKNOWN_PAYMENT_ID}`);

      observe("unknown-payment", { class: classOf(outcome), httpStatus: raw.status, body: raw.body });

      expect(raw.status).toBe(400);
      expect(classOf(outcome)).toBe("REJECTED");
    });

    it("reports a MALFORMED id as NOT_FOUND: a gateway routing 404 with no error envelope", async () => {
      // A wrong-length id never reaches a handler, or authentication, so this is
      // the only case in which a 404 (NOT_FOUND) is seen.
      const outcome = await provider.fetchSubscription("sub_ContractMalformedId");
      const raw = await rawGet("/subscriptions/sub_ContractMalformedId");

      observe("malformed-subscription-id", { class: classOf(outcome), httpStatus: raw.status, body: raw.body });

      expect(raw.status).toBe(404);
      expect(classOf(outcome)).toBe("NOT_FOUND");
    });
  });

  describe("cancellation", () => {
    it("cancels a `created` subscription immediately, and a second cancel is refused as terminal", async () => {
      const made = await createSubscription();

      const cancelled = succeeded(await provider.cancelSubscription(made.providerSubscriptionId, { atCycleEnd: false }));
      expect(cancelled.rawStatus).toBe("cancelled");

      // The command response is never authoritative: read it back.
      expect(succeeded(await provider.fetchSubscription(made.providerSubscriptionId)).rawStatus).toBe("cancelled");

      const again = await provider.cancelSubscription(made.providerSubscriptionId, { atCycleEnd: false });
      observe("cancel-terminal", { class: classOf(again), ...(again.kind === "FAILURE" && { code: again.providerErrorCode, description: again.providerErrorDescription }) });
      expect(classOf(again)).toBe("REJECTED");
    });

    it("refuses a cycle-end cancel where no cycle is running, as REJECTED", async () => {
      const made = await createSubscription();

      const outcome = await provider.cancelSubscription(made.providerSubscriptionId, { atCycleEnd: true });

      observe("cycle-end-cancel-on-created", {
        class: classOf(outcome),
        ...(outcome.kind === "FAILURE" && { code: outcome.providerErrorCode, description: outcome.providerErrorDescription }),
      });
      expect(classOf(outcome)).toBe("REJECTED");
    });
  });

  describe("refusals are classified REJECTED, by code and never by description", () => {
    it("refuses a plan update on a subscription that is not authenticated or active", async () => {
      const made = await createSubscription();

      for (const scheduleChangeAt of ["NOW", "CYCLE_END"] as const) {
        const outcome = await provider.updateSubscriptionPlan(made.providerSubscriptionId, {
          plan: "PRO",
          cycle: "MONTHLY",
          scheduleChangeAt,
        });

        observe(`update-refusal-${scheduleChangeAt}`, {
          class: classOf(outcome),
          ...(outcome.kind === "FAILURE" && { code: outcome.providerErrorCode, description: outcome.providerErrorDescription }),
        });
        expect(classOf(outcome)).toBe("REJECTED");
      }
    });

    it("refuses to cancel a scheduled change when none is pending", async () => {
      const made = await createSubscription();

      const outcome = await provider.cancelScheduledChange(made.providerSubscriptionId);

      observe("cancel-scheduled-change-none-pending", {
        class: classOf(outcome),
        ...(outcome.kind === "FAILURE" && { code: outcome.providerErrorCode, description: outcome.providerErrorDescription }),
      });
      expect(classOf(outcome)).toBe("REJECTED");
    });

    it("refuses a create whose expire_by is already past", async () => {
      const outcome = await provider.createSubscription({
        plan: "PRO",
        cycle: "MONTHLY",
        totalCount: 12,
        expireBy: new Date(Date.now() - 60_000),
        notes: { kz_sub: "ksub_contract", kz_op: "kop_contract", kz_env: "TEST" },
      });

      observe("create-past-expire-by", {
        class: classOf(outcome),
        ...(outcome.kind === "FAILURE" && { code: outcome.providerErrorCode, description: outcome.providerErrorDescription }),
      });
      expect(classOf(outcome)).toBe("REJECTED");
    });

    it("refuses a create whose total_count exceeds the plan's maximum", async () => {
      const outcome = await provider.createSubscription({
        plan: "PRO",
        cycle: "MONTHLY",
        totalCount: 5000,
        expireBy: new Date(Date.now() + 60 * 60 * 1000),
        notes: { kz_sub: "ksub_contract", kz_op: "kop_contract", kz_env: "TEST" },
      });

      // Should it slip through, it must not be left running.
      if (outcome.kind === "SUCCESS") created.push(outcome.value.providerSubscriptionId);

      observe("create-total-count-too-large", {
        class: classOf(outcome),
        ...(outcome.kind === "FAILURE" && { code: outcome.providerErrorCode, description: outcome.providerErrorDescription }),
      });
      expect(classOf(outcome)).toBe("REJECTED");
    });
  });

  describe("listing", () => {
    it("filters on creation time with both bounds inclusive", async () => {
      const made = await createSubscription();
      const { body } = await rawGet(`/subscriptions/${made.providerSubscriptionId}`);
      const createdAt = (body as { created_at: number }).created_at;

      const at = (seconds: number) => new Date(seconds * 1000);
      const ids = async (from: number, to: number) => {
        const page = succeeded(await provider.listSubscriptions({ from: at(from), to: at(to) }, { count: 100, skip: 0 }));

        return page.items.map((item) => item.providerSubscriptionId);
      };

      const inclusiveBoth = await ids(createdAt, createdAt);
      const lowerExcluded = await ids(createdAt + 1, createdAt + 100);
      const upperExcluded = await ids(createdAt - 100, createdAt - 1);

      observe("list-window", {
        createdAt,
        fromEqualsCreated_toEqualsCreated: inclusiveBoth.includes(made.providerSubscriptionId),
        fromAfterCreated: lowerExcluded.includes(made.providerSubscriptionId),
        toBeforeCreated: upperExcluded.includes(made.providerSubscriptionId),
      });

      expect(inclusiveBoth).toContain(made.providerSubscriptionId);
      expect(lowerExcluded).not.toContain(made.providerSubscriptionId);
      expect(upperExcluded).not.toContain(made.providerSubscriptionId);
    });

    it("returns Kizunia's notes on listed subscriptions, which is how a lost create is found again", async () => {
      const made = await createSubscription();
      const { body } = await rawGet(`/subscriptions/${made.providerSubscriptionId}`);
      const createdAt = (body as { created_at: number }).created_at;

      const page = succeeded(
        await provider.listSubscriptions(
          { from: new Date(createdAt * 1000), to: new Date(createdAt * 1000) },
          { count: 100, skip: 0 },
        ),
      );

      const found = page.items.find((item) => item.providerSubscriptionId === made.providerSubscriptionId);

      expect(found?.notes).toEqual({ kz_sub: "ksub_contract", kz_op: "kop_contract", kz_env: "TEST" });
    });
  });

  describe("transport failures", () => {
    it("classifies a bad secret as AUTH_FAILURE", async () => {
      const badClient = clientWith("not-the-secret");
      const bad = new RazorpayBillingProvider({ ...credentials, keySecret: "not-the-secret" }, "TEST", {
        client: badClient,
        catalog: createPlanCatalog([]),
      });

      // A well-formed id, so the request reaches authentication. (A malformed one
      // is answered by the gateway with a routing 404 BEFORE authentication.)
      const outcome = await bad.fetchSubscription(UNKNOWN_SUBSCRIPTION_ID);
      const raw = await badClient.request("GET", `/subscriptions/${UNKNOWN_SUBSCRIPTION_ID}`);

      observe("bad-secret", {
        class: classOf(outcome),
        httpStatus: raw.kind === "RESPONSE" ? raw.status : null,
        body: raw.kind === "RESPONSE" ? raw.body : null,
      });
      expect(classOf(outcome)).toBe("AUTH_FAILURE");
    });

    // A local stand-in answers faster than any timeout, so this only means
    // something against the real API, where a round trip takes far longer than
    // 1 ms. The classification itself is covered deterministically by the unit
    // tests, with a fetch that only ever ends by being aborted.
    it.skipIf(BASE_URL !== undefined)("classifies a request that outlives its timeout as TIMEOUT, with the send time", async () => {
      const impatient = new RazorpayBillingProvider(credentials, "TEST", {
        client: clientWith(KEY_SECRET, 1),
        catalog: createPlanCatalog([]),
      });

      const outcome = await impatient.fetchSubscription(UNKNOWN_SUBSCRIPTION_ID);

      expect(outcome).toMatchObject({ kind: "FAILURE", failureClass: "TIMEOUT" });
      expect(outcome.kind === "FAILURE" && outcome.requestSentAt).toBeInstanceOf(Date);
    });
  });

  describe("expire_by lag", () => {
    it.skipIf(!SLOW)(
      "leaves a `created` subscription reading `created` for a while past expire_by, then `expired`",
      async () => {
        const expireBy = new Date(Date.now() + 30_000);
        const made = await createSubscription({ expireBy });

        let status = made.rawStatus;
        let expiredAfterSeconds: number | null = null;

        // The lag is documented as up to a few minutes (D6).
        for (let attempt = 0; attempt < 32 && status === "created"; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 15_000));
          status = succeeded(await provider.fetchSubscription(made.providerSubscriptionId)).rawStatus;
          if (status !== "created") expiredAfterSeconds = Math.round((Date.now() - expireBy.getTime()) / 1000);
        }

        observe("expire-by-lag", { finalStatus: status, secondsAfterExpireBy: expiredAfterSeconds });

        expect(status).toBe("expired");
      },
      600_000,
    );
  });

  describe("supplied subscriptions (states a customer must authenticate to reach)", () => {
    for (const state of SUPPLIED_STATES) {
      const id = process.env[`RAZORPAY_CONTRACT_${state}_SUBSCRIPTION_ID`]?.trim();
      const status = state.toLowerCase();

      it.skipIf(!id)(`reads a ${status} subscription as ${status}`, async () => {
        const fetched = succeeded(await provider.fetchSubscription(id!));

        observe(`supplied-${status}`, {
          rawStatus: fetched.rawStatus,
          paymentMethod: fetched.paymentMethod,
          hasScheduledChanges: fetched.hasScheduledChanges,
          haltedAt: fetched.haltedAt,
        });
        expect(fetched.rawStatus).toBe(status);
      });

      it.skipIf(!id || !MUTATE_SUPPLIED)(`cancels a ${status} subscription: cycle-end, then immediately`, async () => {
        const cycleEnd = await provider.cancelSubscription(id!, { atCycleEnd: true });
        const afterCycleEnd = succeeded(await provider.fetchSubscription(id!));

        observe(`supplied-${status}-cycle-end`, { class: classOf(cycleEnd), statusAfter: afterCycleEnd.rawStatus });

        if (state === "AUTHENTICATED") {
          // No cycle is running yet, so the provider refuses (D2).
          expect(classOf(cycleEnd)).toBe("REJECTED");
        } else {
          // Accepted, and nothing observable changes (A2, D2): only Kizunia's own
          // record can say a cycle-end cancellation was requested.
          expect(classOf(cycleEnd)).toBe("SUCCESS");
          expect(afterCycleEnd.rawStatus).toBe(status);
        }

        const immediate = succeeded(await provider.cancelSubscription(id!, { atCycleEnd: false }));
        expect(immediate.rawStatus).toBe("cancelled");
        expect(succeeded(await provider.fetchSubscription(id!)).rawStatus).toBe("cancelled");
      });
    }
  });
});
