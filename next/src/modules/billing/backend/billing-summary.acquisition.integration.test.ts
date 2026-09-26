/**
 * `GET /api/v1/me/billing`, Phase VII additions: the server-computed trial
 * flag, the trial end and the applied Offer code. The UI renders these and
 * decides nothing (eligibility, terms and one-time rules are all server-side),
 * and no provider identifier is ever in the answer (SB-PB-04).
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";

import prisma from "@/lib/prisma";
import { cleanupBillingUsers, createBillingUser, insertBoundSubscription } from "@/testing/billing-sync-fixtures";
import { lifecycleCatalog } from "@/testing/billing-lifecycle-fixtures";

import { createOfferCatalog } from "../config/offer-catalog";
import { BillingSummaryService } from "./billing-summary.service";
import { createStaticOfferCodeSource } from "./offers/offer-code-source";

const PREFIX = "__vitest_billing_summary_acq__";
const DAY = 24 * 60 * 60 * 1000;

const offers = createStaticOfferCodeSource(() =>
  createOfferCatalog([
    { marketingCode: "WELCOME", providerOfferId: "offer_opaque_summary", appliesTo: [{ plan: "PRO", cycle: "MONTHLY" }], eligibility: "ANY_USER", description: "Half off your first month" },
  ]),
);
const service = (overrides: ConstructorParameters<typeof BillingSummaryService>[0] = {}) =>
  new BillingSummaryService({ resolvedMode: () => "TEST", catalog: lifecycleCatalog, offers, ...overrides });
const actorOf = (id: string) => ({ id, role: "user", banned: false });

afterEach(() => cleanupBillingUsers(PREFIX));
afterAll(async () => {
  await cleanupBillingUsers(PREFIX);
  await prisma.$disconnect();
});

describe("the trial flag", () => {
  it("offers a trial, with its length, on every purchasable plan to an eligible user", async () => {
    const userId = await createBillingUser(PREFIX);

    const summary = await service().getForUser(actorOf(userId));

    expect(summary.allowedActions.trial).toMatchObject({ lengthDays: 14 });
    expect(summary.allowedActions.trial?.plans).toHaveLength(4);
  });

  it("reads the trial length from configuration, so the UI never hard-codes it", async () => {
    const userId = await createBillingUser(PREFIX);

    expect((await service({ trialLengthDays: 7 }).getForUser(actorOf(userId))).allowedActions.trial?.lengthDays).toBe(7);
  });

  it("offers none once a trial was used (cancelled, converted or failed), and none to a user with a subscription", async () => {
    const used = await createBillingUser(PREFIX);
    await insertBoundSubscription(used, { kind: "TRIAL", phase: "CANCELLED", firstContributedAt: new Date(), providerSubscriptionId: `sub_${PREFIX}a` });
    const live = await createBillingUser(PREFIX);
    await insertBoundSubscription(live, { phase: "ACTIVE", firstContributedAt: new Date(), providerSubscriptionId: `sub_${PREFIX}b` });

    expect((await service().getForUser(actorOf(used))).allowedActions.trial).toBeNull();
    expect((await service().getForUser(actorOf(live))).allowedActions.trial).toBeNull();
  });

  it("still offers one after an abandoned trial checkout: it consumed nothing", async () => {
    const userId = await createBillingUser(PREFIX);
    await insertBoundSubscription(userId, { kind: "TRIAL", phase: "EXPIRED", firstContributedAt: null, providerSubscriptionId: `sub_${PREFIX}c` });

    expect((await service().getForUser(actorOf(userId))).allowedActions.trial).not.toBeNull();
  });

  it("offers none in disabled mode, and none in the other provider mode's history", async () => {
    const userId = await createBillingUser(PREFIX);
    await insertBoundSubscription(userId, { kind: "TRIAL", providerMode: "LIVE", phase: "CANCELLED", firstContributedAt: new Date(), providerSubscriptionId: `sub_${PREFIX}d` });

    expect((await service({ resolvedMode: () => "DISABLED" }).getForUser(actorOf(userId))).allowedActions.trial).toBeNull();
    expect((await service().getForUser(actorOf(userId))).allowedActions.trial).not.toBeNull();
  });
});

describe("what the summary says about a trial and a code", () => {
  it("shows a running trial's kind and end, from the record, and no trial CTA", async () => {
    const userId = await createBillingUser(PREFIX);
    const startAt = new Date(Date.now() + 10 * DAY);
    await insertBoundSubscription(userId, { kind: "TRIAL", phase: "TRIALING", startAt, firstContributedAt: new Date(), providerSubscriptionId: `sub_${PREFIX}e` });

    const summary = await service().getForUser(actorOf(userId));

    expect(summary.plan).toBe("PRO");
    expect(summary.subscription).toMatchObject({ kind: "TRIAL", phase: "TRIALING", trialEndsAt: startAt.toISOString() });
    expect(summary.allowedActions.trial).toBeNull();
    expect(summary.allowedActions.cancel).toEqual({ timing: "IMMEDIATE", abandon: false });
  });

  it("shows no trial end for a trial that has not authenticated yet", async () => {
    const userId = await createBillingUser(PREFIX);
    await insertBoundSubscription(userId, {
      kind: "TRIAL",
      phase: "PENDING_AUTHENTICATION",
      startAt: new Date(Date.now() + 14 * DAY),
      expireBy: new Date(Date.now() + 20 * 60_000),
      providerSubscriptionId: `sub_${PREFIX}f`,
    });

    const summary = await service().getForUser(actorOf(userId));

    expect(summary.subscription).toMatchObject({ kind: "TRIAL", trialEndsAt: null });
    expect(summary.allowedActions.resumeCheckout).toEqual({ plan: "PRO", cycle: "MONTHLY", kind: "TRIAL", code: null });
  });

  it("shows an applied code and the catalog's description, never an amount or a provider identifier", async () => {
    const userId = await createBillingUser(PREFIX);
    await insertBoundSubscription(userId, {
      phase: "PENDING_AUTHENTICATION",
      marketingCode: "WELCOME",
      offerId: "offer_opaque_summary",
      providerPlanId: "plan_fake_PRO_MONTHLY",
      expireBy: new Date(Date.now() + 20 * 60_000),
      providerSubscriptionId: `sub_${PREFIX}g`,
    });

    const summary = await service().getForUser(actorOf(userId));

    expect(summary.subscription?.offer).toEqual({ code: "WELCOME", description: "Half off your first month" });
    expect(summary.allowedActions.resumeCheckout).toEqual({ plan: "PRO", cycle: "MONTHLY", kind: "STANDARD", code: "WELCOME" });

    const raw = JSON.stringify(summary);
    expect(raw).not.toContain("offer_opaque_summary");
    expect(raw).not.toContain(`sub_${PREFIX}g`);
    expect(raw).not.toContain("plan_fake_PRO_MONTHLY");
  });

  it("keeps showing the code when the catalog no longer carries it, without a description", async () => {
    const userId = await createBillingUser(PREFIX);
    await insertBoundSubscription(userId, { phase: "ACTIVE", marketingCode: "RETIRED", firstContributedAt: new Date(), providerSubscriptionId: `sub_${PREFIX}h` });

    expect((await service().getForUser(actorOf(userId))).subscription?.offer).toEqual({ code: "RETIRED", description: null });
  });
});
