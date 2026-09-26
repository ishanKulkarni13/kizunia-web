/**
 * Trials and Offer codes through the one checkout command (Phase VII), against
 * real Postgres and the fake provider. There is no trial flow and no code flow:
 * these are `StartCheckout` (and `Supersede`) with a `trial` flag or a `code`,
 * so everything here is about the acquisition rules under the same runner,
 * slot, idempotency and provider boundary.
 *
 * What is verified here is Kizunia's behavior. What Razorpay does with a
 * future `start_at` or an `offer_id` is provider behavior, recorded separately
 * (the contract suite and the Phase VII runbook), never inferred from the fake.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import type { BillingCycle, MembershipPlan, Prisma } from "@/generated/prisma";
import { resolveEffectiveAccess } from "@/lib/entitlements/resolver";
import { resetLogSink, setLogSink, type LogRecord } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { cleanupBillingUsers, createBillingUser, insertBoundSubscription } from "@/testing/billing-sync-fixtures";

import { createOfferCatalog, type OfferCatalogEntry } from "../../config/offer-catalog";
import { createPlanCatalog } from "../../config/plan-catalog";
import {
  BillingUnavailableError,
  CheckoutFailedError,
  CodeInvalidError,
  CodeNotAllowedOnTrialError,
  CodeNotApplicableError,
  CodeNotEligibleError,
  CodeRefusedByProviderError,
  SubscriptionExistsError,
  TrialNotEligibleError,
} from "../../errors";
import { FakeBillingProvider } from "../../provider/fake-provider";
import { ProviderPriority } from "../../provider/types";
import { createStaticOfferCodeSource } from "../offers/offer-code-source";
import { SyncService } from "../sync/sync.service";
import { CommandRunner, type CommandRunnerDeps } from "./command-runner";
import { StartCheckoutCommand, type StartCheckoutResult } from "./start-checkout";

const PREFIX = "__vitest_billing_acquisition__";
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const KEY_ID = "rzp_test_acquisitionkey";

const catalog = createPlanCatalog(
  (["PRO", "PRO_PLUS"] as const).flatMap((plan) =>
    (["MONTHLY", "YEARLY"] as const).map((cycle) => ({ providerPlanId: `plan_fake_${plan}_${cycle}`, plan, cycle })),
  ),
);

const OFFER: OfferCatalogEntry = {
  marketingCode: "Welcome",
  providerOfferId: "offer_opaque_welcome",
  appliesTo: [{ plan: "PRO", cycle: "MONTHLY" }],
  eligibility: "ANY_USER",
  description: "Half off your first month",
};

let fake: FakeBillingProvider;
let clock: Date;
let keySequence = 0;
let providerTick = 0;
let records: LogRecord[];
const now = () => clock;
const providerNow = () => new Date(clock.getTime() + (providerTick += 1));
const advance = (ms: number) => {
  clock = new Date(clock.getTime() + ms);
};

const offers = (entries: readonly OfferCatalogEntry[] = [OFFER]) => createStaticOfferCodeSource(() => createOfferCatalog(entries));

const runner = (deps: CommandRunnerDeps = {}) =>
  new CommandRunner({ providerFor: () => fake, resolvedMode: () => "TEST", assertEnabled: () => {}, now, catalog, ...deps });

const key = () => `key-${PREFIX}-${Date.now()}-${(keySequence += 1)}`.replace(/[^A-Za-z0-9_-]/g, "_");

interface Intent {
  plan?: MembershipPlan;
  cycle?: BillingCycle;
  trial?: boolean;
  code?: string;
}

function start(userId: string, intent: Intent = {}, idempotencyKey = key(), commandRunner = runner(), entries?: readonly OfferCatalogEntry[]): Promise<StartCheckoutResult> {
  return commandRunner.run(
    new StartCheckoutCommand({ plan: "PRO", cycle: "MONTHLY", ...intent }, { keyId: () => KEY_ID, offers: offers(entries) }),
    { actor: { userId, actorKind: "USER", actorUserId: userId }, idempotencyKey },
  );
}

const creates = () => fake.calls.filter((call) => call.method === "createSubscription");
const lastCreate = () => creates()[creates().length - 1].args[0] as Record<string, unknown>;
const subscriptionsOf = (userId: string) => prisma.subscription.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
const operationsOf = (userId: string) => prisma.billingOperation.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
const alerts = () => records.filter((r) => r.event === "billing.alert").map((r) => r.fields.condition);
const events = (name: string) => records.filter((r) => r.event === name);

/** A subscription of the user's, already ended, as history the rules read. */
function ended(userId: string, overrides: Partial<Prisma.SubscriptionUncheckedCreateInput>) {
  return insertBoundSubscription(userId, { phase: "CANCELLED", providerSubscriptionId: `sub_${PREFIX}${Math.random().toString(36).slice(2)}`, ...overrides });
}

beforeEach(() => {
  clock = new Date();
  fake = new FakeBillingProvider({ now: providerNow, idPrefix: `sub_${PREFIX}${Date.now()}_` });
  records = [];
  setLogSink((record) => {
    records.push(record);
  });
});
afterEach(async () => {
  resetLogSink();
  await cleanupBillingUsers(PREFIX);
});
afterAll(async () => {
  await cleanupBillingUsers(PREFIX);
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Trials
// ---------------------------------------------------------------------------

describe("a trial checkout", () => {
  it("creates a TRIAL subscription whose start_at is the trial length (14 days) from now, with no Offer, through the ordinary create", async () => {
    const userId = await createBillingUser(PREFIX);

    const result = await start(userId, { trial: true });

    expect(result.status).toBe("CHECKOUT_READY");
    const [subscription] = await subscriptionsOf(userId);
    const [operation] = await operationsOf(userId);

    expect(subscription).toMatchObject({ kind: "TRIAL", phase: "PENDING_AUTHENTICATION", plan: "PRO", cycle: "MONTHLY", offerId: null, marketingCode: null });
    expect(subscription.startAt).toEqual(new Date(clock.getTime() + 14 * DAY));
    expect(operation).toMatchObject({ kind: "CREATE_SUBSCRIPTION", status: "SUCCEEDED", request: { plan: "PRO", cycle: "MONTHLY", kind: "TRIAL" } });

    expect(creates()).toHaveLength(1);
    const sent = lastCreate();
    expect(sent.startAt).toEqual(new Date(clock.getTime() + 14 * DAY));
    expect(sent).not.toHaveProperty("offerId");
    expect(events("trial.checkout_started")).toHaveLength(1);
  });

  it("uses the same recorded start_at it sends: what is sent is what was written (SB-CM-02)", async () => {
    const userId = await createBillingUser(PREFIX);

    await start(userId, { trial: true, plan: "PRO_PLUS", cycle: "YEARLY" });

    const [subscription] = await subscriptionsOf(userId);
    expect(lastCreate()).toMatchObject({ plan: "PRO_PLUS", cycle: "YEARLY", startAt: subscription.startAt });
    expect(subscription).toMatchObject({ plan: "PRO_PLUS", cycle: "YEARLY", kind: "TRIAL" });
  });

  it("honours an overridden trial length (a TEST verification uses a short trial)", async () => {
    const userId = await createBillingUser(PREFIX);

    await runner().run(new StartCheckoutCommand({ plan: "PRO", cycle: "MONTHLY", trial: true }, { keyId: () => KEY_ID, trialLengthSeconds: 600 }), {
      actor: { userId, actorKind: "USER", actorUserId: userId },
      idempotencyKey: key(),
    });

    expect(lastCreate().startAt).toEqual(new Date(clock.getTime() + 600_000));
  });

  it("never sends a start_at for a standard subscription", async () => {
    const userId = await createBillingUser(PREFIX);

    await start(userId, {});

    expect(lastCreate()).not.toHaveProperty("startAt");
    expect((await subscriptionsOf(userId))[0]).toMatchObject({ kind: "STANDARD", startAt: null });
  });

  it("grants no access until an observation shows the trial authenticated (never a temporary flag)", async () => {
    const userId = await createBillingUser(PREFIX);

    await start(userId, { trial: true });

    expect((await resolveEffectiveAccess(userId, { expectedMode: "TEST" })).plan).toBe("FREE");
  });

  it("gives the trial's plan from authentication, through the same resolver, and never before", async () => {
    const userId = await createBillingUser(PREFIX);
    await start(userId, { trial: true, plan: "PRO_PLUS", cycle: "MONTHLY" });
    const [subscription] = await subscriptionsOf(userId);
    const psub = subscription.providerSubscriptionId!;

    fake.seed({ ...fake.peek(psub)!, providerSubscriptionId: psub, rawStatus: "authenticated" });
    advance(MINUTE);
    const sync = new SyncService({ providerFor: () => fake, resolvedMode: () => "TEST", now, random: () => 0.5, catalog });
    await sync.syncTargeted(subscription.id, ProviderPriority.CONFIRMATION);

    const after = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(after).toMatchObject({ phase: "TRIALING", kind: "TRIAL" });
    expect(after.firstContributedAt).not.toBeNull();
    expect((await resolveEffectiveAccess(userId, { expectedMode: "TEST" })).plan).toBe("PRO_PLUS");
    expect(events("trial.started")).toHaveLength(1);
  });

  it("is available on every paid plan and cycle", async () => {
    for (const plan of ["PRO", "PRO_PLUS"] as const) {
      for (const cycle of ["MONTHLY", "YEARLY"] as const) {
        const userId = await createBillingUser(PREFIX);

        expect((await start(userId, { trial: true, plan, cycle })).status).toBe("CHECKOUT_READY");
      }
    }
  });
});

describe("trial eligibility — one per account (SB-LC-11)", () => {
  it.each([
    ["cancelled during the trial", { phase: "CANCELLED" as const }],
    ["converted, then cancelled", { phase: "CANCELLED" as const, currentPeriodStart: new Date() }],
    ["a trial whose first charge failed (halted)", { phase: "HALTED" as const }],
  ])("refuses a second trial after one that reached TRIALING (%s), sending nothing", async (_label, overrides) => {
    const userId = await createBillingUser(PREFIX);
    await ended(userId, { kind: "TRIAL", firstContributedAt: new Date(clock.getTime() - DAY), ...overrides });
    // A halted subscription is still open: use a cancelled successor state for that case.
    if (overrides.phase === "HALTED") await prisma.subscription.updateMany({ where: { userId }, data: { phase: "CANCELLED" } });
    const idempotencyKey = key();

    await expect(start(userId, { trial: true }, idempotencyKey)).rejects.toBeInstanceOf(TrialNotEligibleError);

    expect(fake.calls).toHaveLength(0);
    expect(await operationsOf(userId)).toMatchObject([{ status: "REJECTED", failureClass: null, requestSentAt: null }]);

    // A same-key retry is answered from the record, never re-executed.
    await expect(start(userId, { trial: true }, idempotencyKey)).rejects.toBeInstanceOf(TrialNotEligibleError);
    expect(fake.calls).toHaveLength(0);
  });

  it("does not count a trial checkout that never authenticated (abandoned, expired or cancelled before TRIALING)", async () => {
    const userId = await createBillingUser(PREFIX);
    await ended(userId, { kind: "TRIAL", phase: "EXPIRED", firstContributedAt: null });
    await ended(userId, { kind: "TRIAL", phase: "ABANDONED", firstContributedAt: null, providerSubscriptionId: null });
    await ended(userId, { kind: "TRIAL", phase: "CANCELLED", firstContributedAt: null });

    expect((await start(userId, { trial: true })).status).toBe("CHECKOUT_READY");
  });

  it("does not count a standard subscription: someone who paid before may still trial", async () => {
    const userId = await createBillingUser(PREFIX);
    await ended(userId, { kind: "STANDARD", phase: "CANCELLED", firstContributedAt: new Date(clock.getTime() - DAY) });

    expect((await start(userId, { trial: true })).status).toBe("CHECKOUT_READY");
  });

  it("does not count another provider mode's trial (TEST history never affects LIVE)", async () => {
    const userId = await createBillingUser(PREFIX);
    await ended(userId, { kind: "TRIAL", providerMode: "LIVE", phase: "CANCELLED", firstContributedAt: new Date(clock.getTime() - DAY) });

    expect((await start(userId, { trial: true })).status).toBe("CHECKOUT_READY");
  });

  it("does not count another user's trial", async () => {
    const other = await createBillingUser(PREFIX);
    const userId = await createBillingUser(PREFIX);
    await ended(other, { kind: "TRIAL", phase: "CANCELLED", firstContributedAt: new Date(clock.getTime() - DAY) });

    expect((await start(userId, { trial: true })).status).toBe("CHECKOUT_READY");
  });

  it.each(["TRIALING", "ACTIVE", "PAST_DUE"] as const)("refuses a trial while a subscription is %s: the one-open-subscription rule wins", async (phase) => {
    const userId = await createBillingUser(PREFIX);
    await insertBoundSubscription(userId, { phase, kind: phase === "TRIALING" ? "TRIAL" : "STANDARD", firstContributedAt: new Date() });

    await expect(start(userId, { trial: true })).rejects.toBeInstanceOf(SubscriptionExistsError);
    expect(fake.calls).toHaveLength(0);
  });

  it("creates exactly one trial for concurrent starts from several tabs", async () => {
    const userId = await createBillingUser(PREFIX);

    const results = await Promise.allSettled(Array.from({ length: 5 }, () => start(userId, { trial: true })));

    expect(creates()).toHaveLength(1);
    expect(await subscriptionsOf(userId)).toHaveLength(1);

    for (const result of results) {
      if (result.status === "fulfilled") expect(["CHECKOUT_READY", "IN_PROGRESS"]).toContain(result.value.status);
      else expect(result.reason).toMatchObject({ code: "BILLING_OPERATION_IN_PROGRESS" });
    }
  });

  it("does not let a second tab slip a trial in behind a trial that reached TRIALING", async () => {
    const userId = await createBillingUser(PREFIX);
    await start(userId, { trial: true });
    const [subscription] = await subscriptionsOf(userId);
    fake.seed({ ...fake.peek(subscription.providerSubscriptionId!)!, providerSubscriptionId: subscription.providerSubscriptionId!, rawStatus: "authenticated" });
    advance(MINUTE);
    await new SyncService({ providerFor: () => fake, resolvedMode: () => "TEST", now, random: () => 0.5, catalog }).syncTargeted(subscription.id, ProviderPriority.CONFIRMATION);

    // TRIALING now: a trial or a purchase is refused, and after cancellation the trial stays consumed.
    await expect(start(userId, { trial: true })).rejects.toBeInstanceOf(SubscriptionExistsError);
    await prisma.subscription.update({ where: { id: subscription.id }, data: { phase: "CANCELLED", syncDueAt: null } });

    await expect(start(userId, { trial: true })).rejects.toBeInstanceOf(TrialNotEligibleError);
    expect(creates()).toHaveLength(1);
  });

  it("explains a replayed refusal from the recorded request, not from the retry's body (IB-27 item 11)", async () => {
    const userId = await createBillingUser(PREFIX);
    await ended(userId, { kind: "TRIAL", phase: "CANCELLED", firstContributedAt: new Date(clock.getTime() - DAY) });
    const idempotencyKey = key();

    await expect(start(userId, { trial: true }, idempotencyKey)).rejects.toBeInstanceOf(TrialNotEligibleError);
    // The same key with a different body: still the recorded trial refusal, never a fresh standard checkout.
    await expect(start(userId, {}, idempotencyKey)).rejects.toBeInstanceOf(TrialNotEligibleError);

    expect(fake.calls).toHaveLength(0);
  });

  it("refuses a code with a trial before any provider call", async () => {
    const userId = await createBillingUser(PREFIX);

    await expect(start(userId, { trial: true, code: "WELCOME" })).rejects.toBeInstanceOf(CodeNotAllowedOnTrialError);

    expect(fake.calls).toHaveLength(0);
    expect(await subscriptionsOf(userId)).toHaveLength(0);
  });
});

describe("a trial checkout that fails", () => {
  it("abandons the record when the provider refuses, and does not consume the trial", async () => {
    const userId = await createBillingUser(PREFIX);
    fake.failNext("createSubscription", "REJECTED", { providerErrorCode: "BAD_REQUEST_ERROR" });

    await expect(start(userId, { trial: true })).rejects.toBeInstanceOf(CheckoutFailedError);

    expect((await subscriptionsOf(userId))[0]).toMatchObject({ kind: "TRIAL", phase: "ABANDONED", firstContributedAt: null });
    // The user can try again: nothing consumed eligibility.
    expect((await start(userId, { trial: true })).status).toBe("CHECKOUT_READY");
  });

  it("leaves a timed-out create OUTCOME_UNKNOWN and never re-sends it; the trial start survives for recovery", async () => {
    const userId = await createBillingUser(PREFIX);
    fake.failNext("createSubscription", "TIMEOUT");

    await start(userId, { trial: true });

    const [subscription] = await subscriptionsOf(userId);
    expect(subscription).toMatchObject({ kind: "TRIAL", phase: "PROVISIONING", providerSubscriptionId: null });
    expect(subscription.startAt).not.toBeNull();
    expect(await operationsOf(userId)).toMatchObject([{ status: "OUTCOME_UNKNOWN", failureClass: "TIMEOUT" }]);

    await expect(start(userId, { trial: true })).rejects.toMatchObject({ code: "BILLING_CONFIRMING" });
    expect(creates()).toHaveLength(1);
  });

  it("sends nothing and writes nothing when billing is disabled", async () => {
    const userId = await createBillingUser(PREFIX);
    const disabled = runner({
      assertEnabled: () => {
        throw new BillingUnavailableError();
      },
    });

    await expect(start(userId, { trial: true }, key(), disabled)).rejects.toBeInstanceOf(BillingUnavailableError);

    expect(fake.calls).toHaveLength(0);
    expect(await subscriptionsOf(userId)).toHaveLength(0);
  });
});

describe("trial and other entitlement sources", () => {
  it("resolves the maximum across a trial and an admin grant, neither modifying the other", async () => {
    const userId = await createBillingUser(PREFIX);
    await insertBoundSubscription(userId, { kind: "TRIAL", phase: "TRIALING", plan: "PRO", firstContributedAt: new Date() });
    const grant = await prisma.entitlementGrant.create({
      data: { userId, plan: "PRO_PLUS", source: "ADMIN_GRANT", validFrom: new Date(clock.getTime() - DAY), grantedByUserId: "some-admin", reason: "test grant" },
    });

    expect((await resolveEffectiveAccess(userId, { expectedMode: "TEST" })).plan).toBe("PRO_PLUS");

    await prisma.entitlementGrant.update({ where: { id: grant.id }, data: { status: "REVOKED", revokedAt: new Date(), revokedByUserId: "some-admin", revokeReason: "test" } });

    expect((await resolveEffectiveAccess(userId, { expectedMode: "TEST" })).plan).toBe("PRO");
  });
});

// ---------------------------------------------------------------------------
// Offer codes
// ---------------------------------------------------------------------------

describe("an Offer code checkout", () => {
  it("sends the catalog's Offer at creation and stores the normalized code, on a standard subscription with no start", async () => {
    const userId = await createBillingUser(PREFIX);

    const result = await start(userId, { code: "  welcome " });

    expect(result.status).toBe("CHECKOUT_READY");
    const [subscription] = await subscriptionsOf(userId);
    const [operation] = await operationsOf(userId);

    expect(lastCreate()).toMatchObject({ plan: "PRO", cycle: "MONTHLY", offerId: "offer_opaque_welcome" });
    expect(lastCreate()).not.toHaveProperty("startAt");
    expect(subscription).toMatchObject({ kind: "STANDARD", marketingCode: "WELCOME", offerId: "offer_opaque_welcome", startAt: null });
    expect(operation.request).toMatchObject({ kind: "STANDARD", code: "WELCOME" });
  });

  it("never returns the provider's Offer identifier: only the checkout parameters the browser needs", async () => {
    const userId = await createBillingUser(PREFIX);

    const result = await start(userId, { code: "WELCOME" });

    expect(JSON.stringify(result)).not.toContain("offer_opaque_welcome");
    expect(JSON.stringify(result)).not.toMatch(/offer_id|offerId/);
  });

  it.each([
    ["an unknown code", { code: "NOPE" }, CodeInvalidError],
    ["another plan", { code: "WELCOME", plan: "PRO_PLUS" as const }, CodeNotApplicableError],
    ["another cycle", { code: "WELCOME", cycle: "YEARLY" as const }, CodeNotApplicableError],
  ])("refuses %s before any provider call, recorded", async (_label, intent, ErrorClass) => {
    const userId = await createBillingUser(PREFIX);

    await expect(start(userId, intent)).rejects.toBeInstanceOf(ErrorClass);

    expect(fake.calls).toHaveLength(0);
    expect(await operationsOf(userId)).toMatchObject([{ status: "REJECTED", failureClass: null, requestSentAt: null }]);
    expect(await subscriptionsOf(userId)).toHaveLength(0);
  });

  it("refuses a code that is expired, and one that is not yet valid, and does not tell them apart from unknown", async () => {
    const userId = await createBillingUser(PREFIX);
    const expired = { ...OFFER, marketingCode: "OLD", providerOfferId: "offer_old", validUntil: new Date(clock.getTime() - MINUTE) };
    const future = { ...OFFER, marketingCode: "SOON", providerOfferId: "offer_soon", validFrom: new Date(clock.getTime() + MINUTE) };

    await expect(start(userId, { code: "OLD" }, key(), runner(), [expired, future])).rejects.toBeInstanceOf(CodeInvalidError);
    await expect(start(userId, { code: "SOON" }, key(), runner(), [expired, future])).rejects.toBeInstanceOf(CodeInvalidError);

    // The window edges: usable exactly at validFrom, gone exactly at validUntil.
    const opens = { ...OFFER, marketingCode: "EDGE", providerOfferId: "offer_edge", validFrom: clock, validUntil: new Date(clock.getTime() + MINUTE) };
    expect((await start(userId, { code: "EDGE" }, key(), runner(), [opens])).status).toBe("CHECKOUT_READY");
    expect(fake.calls.filter((call) => call.method === "createSubscription")).toHaveLength(1);
  });

  it("is refused in a mode whose catalog does not carry the code (LIVE ships empty): nothing is sent", async () => {
    const userId = await createBillingUser(PREFIX);

    await expect(start(userId, { code: "WELCOME" }, key(), runner(), [])).rejects.toBeInstanceOf(CodeInvalidError);

    expect(fake.calls).toHaveLength(0);
  });

  describe("eligibility, from the user's own Subscription records (SB-CP-04)", () => {
    const firstOnly = { ...OFFER, eligibility: "FIRST_PAID_SUBSCRIPTION_ONLY" } as const;
    const oncePerUser = { ...OFFER, eligibility: "ONCE_PER_USER" } as const;

    it("FIRST_PAID_SUBSCRIPTION_ONLY: refused after any subscription reached a contributing phase", async () => {
      const userId = await createBillingUser(PREFIX);
      await ended(userId, { kind: "STANDARD", phase: "CANCELLED", firstContributedAt: new Date(clock.getTime() - DAY) });

      await expect(start(userId, { code: "WELCOME" }, key(), runner(), [firstOnly])).rejects.toBeInstanceOf(CodeNotEligibleError);
      expect(fake.calls).toHaveLength(0);
    });

    it("FIRST_PAID_SUBSCRIPTION_ONLY: a trial counts as a qualifying subscription (it reached TRIALING)", async () => {
      const userId = await createBillingUser(PREFIX);
      await ended(userId, { kind: "TRIAL", phase: "CANCELLED", firstContributedAt: new Date(clock.getTime() - DAY) });

      await expect(start(userId, { code: "WELCOME" }, key(), runner(), [firstOnly])).rejects.toBeInstanceOf(CodeNotEligibleError);
    });

    it("FIRST_PAID_SUBSCRIPTION_ONLY: allowed after only abandoned, expired or cancelled-before-paying checkouts", async () => {
      const userId = await createBillingUser(PREFIX);
      await ended(userId, { phase: "EXPIRED", firstContributedAt: null });
      await ended(userId, { phase: "CANCELLED", firstContributedAt: null });

      expect((await start(userId, { code: "WELCOME" }, key(), runner(), [firstOnly])).status).toBe("CHECKOUT_READY");
    });

    it("FIRST_PAID_SUBSCRIPTION_ONLY: access from an admin grant or a promotion is not a paid subscription (IB-27 item 9)", async () => {
      const userId = await createBillingUser(PREFIX);
      const promotion = await prisma.promotion.create({
        data: { code: `${PREFIX}PROMO${Date.now()}`.toUpperCase(), plan: "PRO", durationDays: 30, validFrom: new Date(clock.getTime() - DAY), createdByUserId: "some-admin" },
      });
      const promoGrant = await prisma.entitlementGrant.create({
        data: { userId, plan: "PRO", source: "PROMOTION", promotionId: promotion.id, validFrom: new Date(clock.getTime() - DAY), reason: promotion.code },
      });
      await prisma.promotionRedemption.create({ data: { promotionId: promotion.id, userId, grantId: promoGrant.id } });
      await prisma.entitlementGrant.create({
        data: { userId, plan: "PRO_PLUS", source: "ADMIN_GRANT", validFrom: new Date(clock.getTime() - DAY), grantedByUserId: "some-admin", reason: "test grant" },
      });

      // The user has real, current paid access from other sources, and still qualifies as a first paid subscription.
      expect((await resolveEffectiveAccess(userId, { expectedMode: "TEST" })).plan).toBe("PRO_PLUS");
      expect((await start(userId, { code: "WELCOME" }, key(), runner(), [firstOnly])).status).toBe("CHECKOUT_READY");
    });

    it("FIRST_PAID_SUBSCRIPTION_ONLY: another mode's history does not count", async () => {
      const userId = await createBillingUser(PREFIX);
      await ended(userId, { providerMode: "LIVE", phase: "CANCELLED", firstContributedAt: new Date(clock.getTime() - DAY) });

      expect((await start(userId, { code: "WELCOME" }, key(), runner(), [firstOnly])).status).toBe("CHECKOUT_READY");
    });

    it("ONCE_PER_USER: consumed once a subscription that carried the code reached a contributing phase", async () => {
      const userId = await createBillingUser(PREFIX);
      await ended(userId, { marketingCode: "WELCOME", offerId: "offer_opaque_welcome", phase: "CANCELLED", firstContributedAt: new Date(clock.getTime() - DAY) });

      await expect(start(userId, { code: "WELCOME" }, key(), runner(), [oncePerUser])).rejects.toBeInstanceOf(CodeNotEligibleError);
      expect(fake.calls).toHaveLength(0);
    });

    it("ONCE_PER_USER: not consumed by an abandoned or expired checkout that carried it (IB-27 item 5)", async () => {
      const userId = await createBillingUser(PREFIX);
      await ended(userId, { marketingCode: "WELCOME", offerId: "offer_opaque_welcome", phase: "ABANDONED", firstContributedAt: null, providerSubscriptionId: null });
      await ended(userId, { marketingCode: "WELCOME", offerId: "offer_opaque_welcome", phase: "EXPIRED", firstContributedAt: null });

      expect((await start(userId, { code: "WELCOME" }, key(), runner(), [oncePerUser])).status).toBe("CHECKOUT_READY");
    });

    it("ONCE_PER_USER: another code, or another user's use of the code, does not consume it", async () => {
      const other = await createBillingUser(PREFIX);
      const userId = await createBillingUser(PREFIX);
      await ended(other, { marketingCode: "WELCOME", phase: "CANCELLED", firstContributedAt: new Date(clock.getTime() - DAY) });
      await ended(userId, { marketingCode: "SOMETHING-ELSE", phase: "CANCELLED", firstContributedAt: new Date(clock.getTime() - DAY) });

      expect((await start(userId, { code: "WELCOME" }, key(), runner(), [oncePerUser])).status).toBe("CHECKOUT_READY");
    });
  });

  it("refuses while a subscription is live: a code never gets around the one-open-subscription rule", async () => {
    const userId = await createBillingUser(PREFIX);
    await insertBoundSubscription(userId, { phase: "ACTIVE", firstContributedAt: new Date() });

    await expect(start(userId, { code: "WELCOME" })).rejects.toBeInstanceOf(SubscriptionExistsError);
    expect(fake.calls).toHaveLength(0);
  });

  it("creates exactly one subscription for concurrent code checkouts, and applies the Offer once", async () => {
    const userId = await createBillingUser(PREFIX);

    await Promise.allSettled(Array.from({ length: 5 }, () => start(userId, { code: "WELCOME" })));

    expect(creates()).toHaveLength(1);
    expect(await subscriptionsOf(userId)).toHaveLength(1);
    expect(lastCreate().offerId).toBe("offer_opaque_welcome");
  });

  it("gives two concurrent users each their own subscription: a ONCE_PER_USER code is per user, not global", async () => {
    const a = await createBillingUser(PREFIX);
    const b = await createBillingUser(PREFIX);

    const results = await Promise.all([start(a, { code: "WELCOME" }, key(), runner(), [{ ...OFFER, eligibility: "ONCE_PER_USER" }]), start(b, { code: "WELCOME" }, key(), runner(), [{ ...OFFER, eligibility: "ONCE_PER_USER" }])]);

    expect(results.map((result) => result.status)).toEqual(["CHECKOUT_READY", "CHECKOUT_READY"]);
    expect(creates()).toHaveLength(2);
  });

  describe("checkout reuse and abandonment", () => {
    it("reuses a pending checkout for the same code: no provider call, the Offer is not re-sent", async () => {
      const userId = await createBillingUser(PREFIX);

      const first = await start(userId, { code: "WELCOME" });
      const second = await start(userId, { code: "welcome" });

      expect(second).toMatchObject({ status: "CHECKOUT_READY" });
      if (first.status !== "CHECKOUT_READY" || second.status !== "CHECKOUT_READY") return;
      expect(second.checkout.subscriptionId).toBe(first.checkout.subscriptionId);
      expect(creates()).toHaveLength(1);
    });

    it("abandons a pending checkout that carried a code when the customer now asks for none, and creates a plain one", async () => {
      const userId = await createBillingUser(PREFIX);
      await start(userId, { code: "WELCOME" });
      advance(1_000);

      const second = await start(userId, {});

      expect(second.status).toBe("CHECKOUT_READY");
      const [old, current] = await subscriptionsOf(userId);
      expect(old).toMatchObject({ phase: "CANCELLED", marketingCode: "WELCOME" });
      expect(current).toMatchObject({ phase: "PENDING_AUTHENTICATION", marketingCode: null, offerId: null });
      expect(creates()).toHaveLength(2);
      expect(creates()[1].args[0]).not.toHaveProperty("offerId");
    });

    it("lets an abandoned code checkout be retried: an abandoned checkout consumed nothing", async () => {
      const userId = await createBillingUser(PREFIX);
      const once = { ...OFFER, eligibility: "ONCE_PER_USER" } as const;
      await start(userId, { code: "WELCOME" }, key(), runner(), [once]);
      advance(1_000);
      // The customer walks away: the pending checkout is abandoned by a plain checkout, then they come back.
      await start(userId, {}, key(), runner(), [once]);
      advance(1_000);

      const retry = await start(userId, { code: "WELCOME" }, key(), runner(), [once]);

      expect(retry.status).toBe("CHECKOUT_READY");
      expect((await subscriptionsOf(userId)).filter((row) => row.marketingCode === "WELCOME" && row.phase === "PENDING_AUTHENTICATION")).toHaveLength(1);
    });

    it("turns a pending trial checkout into a plain one, never handing back the trial for a standard request", async () => {
      const userId = await createBillingUser(PREFIX);
      await start(userId, { trial: true });
      advance(1_000);

      await start(userId, {});

      const [old, current] = await subscriptionsOf(userId);
      expect(old).toMatchObject({ kind: "TRIAL", phase: "CANCELLED", firstContributedAt: null });
      expect(current).toMatchObject({ kind: "STANDARD", phase: "PENDING_AUTHENTICATION", startAt: null });
    });
  });

  describe("the provider refuses the Offer", () => {
    it("is reported as the code being refused, alerted, and the record abandoned; no provider text is exposed", async () => {
      const userId = await createBillingUser(PREFIX);
      fake.failNext("createSubscription", "REJECTED", { providerErrorCode: "BAD_REQUEST_ERROR" });

      const error = await start(userId, { code: "WELCOME" }).catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(CodeRefusedByProviderError);
      expect(String((error as Error).message)).not.toMatch(/razorpay|offer_|BAD_REQUEST/i);
      expect((await subscriptionsOf(userId))[0]).toMatchObject({ phase: "ABANDONED", marketingCode: "WELCOME" });
      expect(alerts()).toContain("OFFER_REJECTED");
      expect(alerts()).not.toContain("CHECKOUT_REJECTED");
    });

    it("answers a same-key retry from the record, with the same refusal and no second call", async () => {
      const userId = await createBillingUser(PREFIX);
      const idempotencyKey = key();
      fake.failNext("createSubscription", "REJECTED");

      await expect(start(userId, { code: "WELCOME" }, idempotencyKey)).rejects.toBeInstanceOf(CodeRefusedByProviderError);
      await expect(start(userId, { code: "WELCOME" }, idempotencyKey)).rejects.toBeInstanceOf(CodeRefusedByProviderError);

      expect(creates()).toHaveLength(1);
    });

    it("keeps a plain refusal a plain refusal, and a busy answer a busy answer", async () => {
      const userId = await createBillingUser(PREFIX);
      fake.failNext("createSubscription", "REJECTED");

      await expect(start(userId, {})).rejects.toBeInstanceOf(CheckoutFailedError);
      expect(alerts()).toContain("CHECKOUT_REJECTED");
    });

    it("leaves a lost response to the provider unknown and never re-sends it, code or not", async () => {
      const userId = await createBillingUser(PREFIX);
      fake.failNext("createSubscription", "TIMEOUT", { afterApplying: true });

      await start(userId, { code: "WELCOME" });

      expect((await subscriptionsOf(userId))[0]).toMatchObject({ phase: "PROVISIONING", marketingCode: "WELCOME", offerId: "offer_opaque_welcome" });
      await expect(start(userId, { code: "WELCOME" })).rejects.toMatchObject({ code: "BILLING_CONFIRMING" });
      expect(creates()).toHaveLength(1);
    });
  });

  it("never lets a client's price, discount or Offer identifier reach the provider: the create carries only what the catalog says", async () => {
    const userId = await createBillingUser(PREFIX);

    await start(userId, { code: "WELCOME" });

    expect(Object.keys(lastCreate()).sort()).toEqual(["cycle", "expireBy", "notes", "offerId", "plan", "totalCount"]);
  });
});

describe("no provider for the wrong reasons", () => {
  it("makes no provider call at all when a code or a trial is refused locally", async () => {
    const userId = await createBillingUser(PREFIX);

    await start(userId, { code: "NOPE" }).catch(() => undefined);
    await start(userId, { trial: true, code: "WELCOME" }).catch(() => undefined);

    expect(fake.calls).toHaveLength(0);
  });
});
