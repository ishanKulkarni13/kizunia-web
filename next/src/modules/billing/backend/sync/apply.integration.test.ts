/**
 * The apply path against real Postgres: the stale guard, validation, the
 * terminal guard, the write, history, settlement, anomalies and the next due
 * time, and that the commit is the access change.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";

import type { Prisma } from "@/generated/prisma";
import { resolveEffectiveAccess } from "@/lib/entitlements";
import prisma from "@/lib/prisma";
import {
  cleanupBillingUsers,
  createBillingUser,
  insertBoundSubscription,
  insertOperation,
} from "@/testing/billing-sync-fixtures";

import { createPlanCatalog } from "../../config/plan-catalog";
import type { NextDueSettings } from "../../policy/next-due";
import type { ProviderSubscriptionState } from "../../provider/types";
import { AnomalySubject, BillingAnomalyRepository } from "../anomalies/anomaly.repository";
import { applyObservation, type ApplyContext } from "./apply";

const PREFIX = "__vitest_billing_apply__";
const NOW = new Date("2026-10-01T12:00:00.000Z");
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(NOW.getTime() + ms);

const catalog = createPlanCatalog([
  { providerPlanId: "plan_pro_m", plan: "PRO", cycle: "MONTHLY" },
  { providerPlanId: "plan_plus_m", plan: "PRO_PLUS", cycle: "MONTHLY" },
]);

const schedule: NextDueSettings = {
  checkpointMarginSeconds: 2 * 60 * 60,
  expireByMarginSeconds: 10 * 60,
  trialConversionGraceSeconds: 4 * 24 * 60 * 60,
  heartbeats: {
    pendingAuthenticationSeconds: 6 * 60 * 60,
    trialingSeconds: 2 * 24 * 60 * 60,
    activeSeconds: 7 * 24 * 60 * 60,
    pastDueSeconds: 24 * 60 * 60,
    pausedSeconds: 7 * 24 * 60 * 60,
    haltedFirstWeekSeconds: 24 * 60 * 60,
    haltedFirstMonthSeconds: 7 * 24 * 60 * 60,
    haltedAfterMonthSeconds: 30 * 24 * 60 * 60,
  },
};

const context: ApplyContext = { resolvedMode: "TEST", now: NOW, catalog, schedule, random: () => 0.5 };

function state(overrides: Partial<ProviderSubscriptionState> = {}): ProviderSubscriptionState {
  return {
    providerSubscriptionId: "sub_x",
    rawStatus: "active",
    providerPlanId: "plan_pro_m",
    currentStart: at(-DAY),
    currentEnd: at(29 * DAY),
    chargeAt: at(29 * DAY),
    startAt: null,
    endAt: null,
    endedAt: null,
    expireBy: null,
    hasScheduledChanges: false,
    changeScheduledAt: null,
    offerId: null,
    notes: {},
    paidCount: 1,
    shortUrl: null,
    paymentMethod: "card",
    haltedAt: null,
    ...overrides,
  };
}

async function subscription(overrides: Partial<Prisma.SubscriptionUncheckedCreateInput> = {}) {
  const userId = await createBillingUser(PREFIX);
  const sub = await insertBoundSubscription(userId, { phase: "PENDING_AUTHENTICATION", ...overrides });

  return { userId, sub, psub: sub.providerSubscriptionId! };
}

const reload = (id: string) => prisma.subscription.findUniqueOrThrow({ where: { id } });
const historyOf = (id: string) =>
  prisma.subscriptionHistoryEntry.findMany({ where: { subscriptionId: id }, orderBy: { recordedAt: "asc" } });
const anomaliesOf = (subjectKey: string) => prisma.billingAnomaly.findMany({ where: { subjectKey } });

afterEach(() => cleanupBillingUsers(PREFIX));
afterAll(async () => {
  await cleanupBillingUsers(PREFIX);
  await prisma.$disconnect();
});

describe("applyObservation — a normal observation", () => {
  it("maps the phase, resolves the plan through the catalog, records history, and schedules the next checkpoint", async () => {
    const { sub, psub, userId } = await subscription({ syncReason: "CHECKPOINT" });

    const result = await applyObservation(sub.id, { state: state({ providerSubscriptionId: psub }), observationAt: at(-MIN) }, context);

    expect(result).toEqual({
      outcome: "APPLIED",
      previousPhase: "PENDING_AUTHENTICATION",
      phase: "ACTIVE",
      changed: true,
      nextDueAt: at(7 * DAY),
    });

    const row = await reload(sub.id);
    expect(row).toMatchObject({
      phase: "ACTIVE",
      plan: "PRO",
      cycle: "MONTHLY",
      providerStatus: "active",
      providerPlanId: "plan_pro_m",
      currentPeriodEnd: at(29 * DAY),
      chargeAt: at(29 * DAY),
      firstContributedAt: NOW,
      advisoryPaymentMethod: "card",
      lastAppliedObservationAt: at(-MIN),
      lastSyncedAt: NOW,
      syncAttempts: 0,
      syncLeaseUntil: null,
      syncDueAt: at(7 * DAY),
      syncReason: "HEARTBEAT",
    });
    expect(row.providerSnapshot).toMatchObject({ rawStatus: "active", hasScheduledChanges: false });

    expect(await historyOf(sub.id)).toMatchObject([
      {
        change: "PHASE",
        fromValue: "PENDING_AUTHENTICATION",
        toValue: "ACTIVE",
        cause: "PROVIDER_OBSERVED",
        trigger: "CHECKPOINT",
        observationAt: at(-MIN),
      },
    ]);

    // The commit is the access change: no cache, the next read sees it.
    expect((await resolveEffectiveAccess(userId, { expectedMode: "TEST", now: NOW })).plan).toBe("PRO");
  });

  it("records a plan change, and nothing when nothing access-relevant changed", async () => {
    const { sub, psub } = await subscription({ phase: "ACTIVE" });

    await applyObservation(sub.id, { state: state({ providerSubscriptionId: psub, providerPlanId: "plan_plus_m" }), observationAt: at(-2 * MIN) }, context);
    const again = await applyObservation(
      sub.id,
      { state: state({ providerSubscriptionId: psub, providerPlanId: "plan_plus_m" }), observationAt: at(-MIN) },
      context,
    );

    expect(again).toMatchObject({ outcome: "APPLIED", changed: false });
    expect(await historyOf(sub.id)).toMatchObject([{ change: "PLAN", fromValue: "PRO/MONTHLY", toValue: "PRO_PLUS/MONTHLY" }]);
  });
});

describe("applyObservation — ordering (SB-RC-08)", () => {
  it("discards an observation sent before the last applied one, whatever order they arrive in", async () => {
    const { sub, psub } = await subscription({ phase: "ACTIVE" });

    await applyObservation(sub.id, { state: state({ providerSubscriptionId: psub, rawStatus: "halted" }), observationAt: at(-MIN) }, context);
    const older = await applyObservation(
      sub.id,
      { state: state({ providerSubscriptionId: psub, rawStatus: "active" }), observationAt: at(-2 * MIN) },
      context,
    );
    const same = await applyObservation(
      sub.id,
      { state: state({ providerSubscriptionId: psub, rawStatus: "active" }), observationAt: at(-MIN) },
      context,
    );

    expect(older).toEqual({ outcome: "STALE_DISCARDED" });
    expect(same).toEqual({ outcome: "STALE_DISCARDED" });
    expect((await reload(sub.id)).phase).toBe("HALTED");
  });

  it("keeps the newer of two concurrent applies", async () => {
    const { sub, psub } = await subscription({ phase: "ACTIVE" });

    await Promise.all([
      applyObservation(sub.id, { state: state({ providerSubscriptionId: psub, rawStatus: "pending" }), observationAt: at(-MIN) }, context),
      applyObservation(sub.id, { state: state({ providerSubscriptionId: psub, rawStatus: "halted" }), observationAt: at(-30_000) }, context),
    ]);

    expect(await reload(sub.id)).toMatchObject({ phase: "HALTED", lastAppliedObservationAt: at(-30_000) });
  });

  it("stays due now when an event arrived after this request was sent", async () => {
    const { sub, psub } = await subscription({ phase: "ACTIVE", syncRequestedAt: at(-30_000), syncReason: "WEBHOOK" });

    const result = await applyObservation(
      sub.id,
      { state: state({ providerSubscriptionId: psub }), observationAt: at(-MIN) },
      context,
    );

    expect(result).toMatchObject({ outcome: "APPLIED", nextDueAt: NOW });
    expect(await reload(sub.id)).toMatchObject({ syncDueAt: NOW, syncReason: "WEBHOOK" });
  });
});

describe("applyObservation — observations that are not applied", () => {
  it("never moves a terminal subscription: TERMINAL_STATE_CONTRADICTED, and it stays not-due", async () => {
    const { sub, psub } = await subscription({ phase: "CANCELLED" });

    const result = await applyObservation(sub.id, { state: state({ providerSubscriptionId: psub }), observationAt: at(-MIN) }, context);

    expect(result).toMatchObject({ outcome: "REJECTED", rejection: "TERMINAL_STATE_CONTRADICTED" });
    expect(await reload(sub.id)).toMatchObject({ phase: "CANCELLED", syncDueAt: null, lastAppliedObservationAt: null });
    expect(await anomaliesOf(AnomalySubject.subscription(sub.id))).toMatchObject([
      { type: "TERMINAL_STATE_CONTRADICTED", details: { localPhase: "CANCELLED", observedPhase: "ACTIVE" } },
    ]);
  });

  it("applies an observation that agrees with the terminal phase", async () => {
    const { sub, psub } = await subscription({ phase: "CANCELLED" });

    const result = await applyObservation(
      sub.id,
      { state: state({ providerSubscriptionId: psub, rawStatus: "cancelled" }), observationAt: at(-MIN) },
      context,
    );

    expect(result).toMatchObject({ outcome: "APPLIED", phase: "CANCELLED", nextDueAt: null });
  });

  it("an unmapped plan changes nothing, raises the anomaly and backs off; a later mapped observation resolves it", async () => {
    const { sub, psub } = await subscription({ phase: "ACTIVE" });

    const rejected = await applyObservation(
      sub.id,
      { state: state({ providerSubscriptionId: psub, providerPlanId: "plan_unknown", rawStatus: "halted" }), observationAt: at(-2 * MIN) },
      context,
    );

    expect(rejected).toMatchObject({ outcome: "REJECTED", rejection: "UNMAPPED_PLAN", failureClass: "UNMAPPED_PLAN" });
    expect(await reload(sub.id)).toMatchObject({
      phase: "ACTIVE",
      plan: "PRO",
      syncAttempts: 1,
      lastSyncFailureClass: "UNMAPPED_PLAN",
      syncReason: "RETRY",
      syncDueAt: at(45_000), // base 60 s × jitter 0.75
    });
    expect(await anomaliesOf(AnomalySubject.subscription(sub.id))).toMatchObject([
      { type: "UNMAPPED_PROVIDER_PLAN", resolvedAt: null, details: { providerPlanId: "plan_unknown" } },
    ]);

    await applyObservation(sub.id, { state: state({ providerSubscriptionId: psub }), observationAt: at(-MIN) }, context);

    expect(await anomaliesOf(AnomalySubject.subscription(sub.id))).toMatchObject([
      { type: "UNMAPPED_PROVIDER_PLAN", resolvedAt: NOW },
    ]);
    expect((await reload(sub.id)).syncAttempts).toBe(0);
  });

  it("refuses notes naming another subscription (NOTES_CONFLICT) or another mode (PROVIDER_MODE_MISMATCH)", async () => {
    const one = await subscription({ phase: "ACTIVE" });
    const two = await subscription({ phase: "ACTIVE" });

    await applyObservation(one.sub.id, { state: state({ providerSubscriptionId: one.psub, notes: { kz_sub: "someone_else" } }), observationAt: at(-MIN) }, context);
    await applyObservation(two.sub.id, { state: state({ providerSubscriptionId: two.psub, notes: { kz_env: "LIVE" } }), observationAt: at(-MIN) }, context);

    expect(await anomaliesOf(AnomalySubject.subscription(one.sub.id))).toMatchObject([{ type: "NOTES_CONFLICT" }]);
    expect(await anomaliesOf(AnomalySubject.subscription(two.sub.id))).toMatchObject([{ type: "PROVIDER_MODE_MISMATCH" }]);
    expect((await reload(one.sub.id)).lastAppliedObservationAt).toBeNull();
  });

  it("refuses a row of another provider mode (TEST/LIVE isolation)", async () => {
    const { sub, psub } = await subscription({ phase: "ACTIVE", providerMode: "LIVE" });

    const result = await applyObservation(sub.id, { state: state({ providerSubscriptionId: psub, rawStatus: "cancelled" }), observationAt: at(-MIN) }, context);

    expect(result).toMatchObject({ outcome: "REJECTED", rejection: "MODE_MISMATCH" });
    expect((await reload(sub.id)).phase).toBe("ACTIVE");
  });

  it("an unknown status is MALFORMED: alert only, no anomaly row", async () => {
    const { sub, psub } = await subscription({ phase: "ACTIVE" });

    const result = await applyObservation(sub.id, { state: state({ providerSubscriptionId: psub, rawStatus: "on_hold" }), observationAt: at(-MIN) }, context);

    expect(result).toMatchObject({ outcome: "REJECTED", rejection: "UNKNOWN_STATUS", failureClass: "MALFORMED" });
    expect(await anomaliesOf(AnomalySubject.subscription(sub.id))).toEqual([]);
    expect((await reload(sub.id)).phase).toBe("ACTIVE");
  });
});

describe("applyObservation — the cancel flag, terminal rows and settlement", () => {
  it("never clears cancelAtPeriodEnd because nothing says so; an observed cancellation clears it", async () => {
    const { sub, psub } = await subscription({ phase: "ACTIVE", cancelAtPeriodEnd: true, cancelRequestedAt: at(-DAY) });

    await applyObservation(sub.id, { state: state({ providerSubscriptionId: psub }), observationAt: at(-2 * MIN) }, context);
    expect((await reload(sub.id)).cancelAtPeriodEnd).toBe(true);

    const result = await applyObservation(
      sub.id,
      { state: state({ providerSubscriptionId: psub, rawStatus: "cancelled", endedAt: at(-MIN) }), observationAt: at(-MIN) },
      context,
    );

    expect(result).toMatchObject({ phase: "CANCELLED", nextDueAt: null });
    expect(await reload(sub.id)).toMatchObject({ cancelAtPeriodEnd: false, syncDueAt: null, endedAt: at(-MIN) });
    expect((await historyOf(sub.id)).map((h) => h.change).sort()).toEqual(["CANCEL_AT_PERIOD_END", "PHASE"]);
  });

  it("settles an operation it proves, and attributes the change to the command", async () => {
    const { sub, psub, userId } = await subscription({ phase: "ACTIVE" });
    const op = await insertOperation(userId, {
      subscriptionId: sub.id,
      kind: "CANCEL_IMMEDIATELY",
      status: "OUTCOME_UNKNOWN",
      requestSentAt: at(-5 * MIN),
    });

    await applyObservation(sub.id, { state: state({ providerSubscriptionId: psub, rawStatus: "cancelled" }), observationAt: at(-MIN) }, context);

    expect(await prisma.billingOperation.findUniqueOrThrow({ where: { id: op.id } })).toMatchObject({
      status: "SUCCEEDED",
      resolvedAt: NOW,
    });
    expect(await historyOf(sub.id)).toMatchObject([{ change: "PHASE", cause: "KIZUNIA_COMMAND", operationId: op.id }]);
  });

  it("records a Dashboard-scheduled change as flag only", async () => {
    const { sub, psub } = await subscription({ phase: "ACTIVE" });

    await applyObservation(
      sub.id,
      { state: state({ providerSubscriptionId: psub, hasScheduledChanges: true, changeScheduledAt: at(3 * DAY) }), observationAt: at(-MIN) },
      context,
    );

    // The scheduled change's time is a checkpoint.
    expect(await reload(sub.id)).toMatchObject({ scheduledPlan: null, scheduledChangeAt: at(3 * DAY), syncDueAt: at(3 * DAY + 2 * HOUR) });
    expect(await historyOf(sub.id)).toMatchObject([{ change: "SCHEDULED_CHANGE", toValue: "UNKNOWN_TARGET" }]);
  });

  it("a recovery from HALTED forgets the old payment method's details", async () => {
    const { sub, psub } = await subscription({
      phase: "HALTED",
      advisoryPaymentMethod: "emandate",
      advisoryInternationalCard: false,
    });

    await applyObservation(sub.id, { state: state({ providerSubscriptionId: psub, paymentMethod: null }), observationAt: at(-MIN) }, context);

    expect(await reload(sub.id)).toMatchObject({ phase: "ACTIVE", advisoryPaymentMethod: null, advisoryInternationalCard: null });
  });

  it("resolves an open PROVIDER_SUBSCRIPTION_MISSING once the subscription is observed again", async () => {
    const { sub, psub } = await subscription({ phase: "ACTIVE" });
    await BillingAnomalyRepository.raise(
      prisma,
      { type: "PROVIDER_SUBSCRIPTION_MISSING", providerMode: "TEST", subjectKey: AnomalySubject.providerSubscription(psub), details: {} },
      at(-HOUR),
    );

    await applyObservation(sub.id, { state: state({ providerSubscriptionId: psub }), observationAt: at(-MIN) }, context);

    expect(await anomaliesOf(AnomalySubject.providerSubscription(psub))).toMatchObject([
      { resolvedAt: NOW, resolutionReason: "AUTO: a later observation applied" },
    ]);
  });
});

describe("applyObservation — multiple open subscriptions", () => {
  it("raises MULTIPLE_OPEN_SUBSCRIPTIONS when a phase change leaves two open in one mode", async () => {
    const { sub, psub, userId } = await subscription({ phase: "PENDING_AUTHENTICATION" });
    const other = await insertBoundSubscription(userId, { phase: "HALTED" });

    await applyObservation(sub.id, { state: state({ providerSubscriptionId: psub }), observationAt: at(-MIN) }, context);

    const [anomaly] = await anomaliesOf(AnomalySubject.user(userId));
    expect(anomaly).toMatchObject({ type: "MULTIPLE_OPEN_SUBSCRIPTIONS", userId });
    expect([...anomaly.subscriptionIds].sort()).toEqual([sub.id, other.id].sort());
  });

  it("does not count a subscription in the other mode", async () => {
    const { sub, psub, userId } = await subscription({ phase: "PENDING_AUTHENTICATION" });
    await insertBoundSubscription(userId, { phase: "ACTIVE", providerMode: "LIVE" });

    await applyObservation(sub.id, { state: state({ providerSubscriptionId: psub }), observationAt: at(-MIN) }, context);

    expect(await anomaliesOf(AnomalySubject.user(userId))).toEqual([]);
  });
});

describe("applyObservation — webhook history", () => {
  it("links the event behind a webhook-triggered sync", async () => {
    const { sub, psub } = await subscription({ phase: "ACTIVE", syncReason: "WEBHOOK" });
    const event = await prisma.billingEvent.create({
      data: {
        provider: "RAZORPAY",
        providerMode: "TEST",
        dedupeKey: `${PREFIX}evt-${sub.id}`,
        dedupeSource: "HEADER",
        eventType: "subscription.halted",
        providerSubscriptionId: psub,
        matchedSecret: "CURRENT",
        status: "RECORDED",
        subscriptionId: sub.id,
        receivedAt: at(-2 * MIN),
      },
    });

    await applyObservation(sub.id, { state: state({ providerSubscriptionId: psub, rawStatus: "halted" }), observationAt: at(-MIN) }, context);

    expect(await historyOf(sub.id)).toMatchObject([{ trigger: "WEBHOOK", billingEventId: event.id }]);
  });

  it("returns SUBSCRIPTION_NOT_FOUND for an unknown row", async () => {
    expect(await applyObservation("no-such-subscription", { state: state(), observationAt: NOW }, context)).toEqual({
      outcome: "SUBSCRIPTION_NOT_FOUND",
    });
  });
});

describe("applyObservation — CANCELLATION_NOT_EFFECTIVE (I-4, Phase VI)", () => {
  const PERIOD_END = at(29 * DAY);

  /** An ACTIVE row whose cycle-end cancel was requested an hour ago, in the period ending at PERIOD_END. */
  async function cancelling(overrides: Partial<Prisma.SubscriptionUncheckedCreateInput> = {}) {
    const { userId, sub, psub } = await subscription({
      phase: "ACTIVE",
      providerPlanId: "plan_pro_m",
      currentPeriodEnd: PERIOD_END,
      lastAppliedObservationAt: at(-2 * HOUR),
      ...overrides,
    });
    const request = await insertOperation(userId, {
      kind: "CANCEL_AT_CYCLE_END",
      status: "SUCCEEDED",
      subscriptionId: sub.id,
      requestSentAt: at(-HOUR),
      request: { atCycleEnd: true, periodEnd: PERIOD_END.toISOString() },
    });

    await prisma.subscription.update({
      where: { id: sub.id },
      data: { cancelAtPeriodEnd: true, cancelRequestedAt: at(-HOUR), cancelRequestedByOperationId: request.id },
    });

    return { userId, sub, psub };
  }

  const notEffective = (subscriptionId: string) => anomaliesOf(AnomalySubject.subscription(subscriptionId));

  it("keeps the request while observations agree with it", async () => {
    const { sub, psub } = await cancelling();

    await applyObservation(sub.id, { state: state({ providerSubscriptionId: psub }), observationAt: NOW }, context);

    expect(await reload(sub.id)).toMatchObject({ cancelAtPeriodEnd: true });
    expect(await notEffective(sub.id)).toHaveLength(0);
  });

  it("(i) raises it, and clears the flag, when still active after the requested period end + margin", async () => {
    const { sub, psub } = await cancelling();
    const late = new Date(PERIOD_END.getTime() + schedule.checkpointMarginSeconds * 1000 + MIN);

    await applyObservation(
      sub.id,
      { state: state({ providerSubscriptionId: psub, currentStart: PERIOD_END, currentEnd: at(59 * DAY) }), observationAt: late },
      { ...context, now: late },
    );

    expect(await reload(sub.id)).toMatchObject({ cancelAtPeriodEnd: false, phase: "ACTIVE" });
    expect(await notEffective(sub.id)).toEqual([
      expect.objectContaining({ type: "CANCELLATION_NOT_EFFECTIVE", resolvedAt: null, details: expect.objectContaining({ reason: "PERIOD_PASSED" }) }),
    ]);
    expect(await historyOf(sub.id)).toContainEqual(
      expect.objectContaining({ change: "CANCEL_AT_PERIOD_END", fromValue: "true", toValue: "false", cause: "PROVIDER_OBSERVED" }),
    );
  });

  it("(ii) raises it for a CHARGE dated after the cancel request was sent", async () => {
    const { userId, sub, psub } = await cancelling();

    await prisma.billingMoneyFact.create({
      data: {
        kind: "CHARGE",
        providerMode: "TEST",
        providerObjectId: `pay_${PREFIX}${Date.now()}`,
        subscriptionId: sub.id,
        userId,
        amountMinor: 1000,
        currency: "INR",
        occurredAt: at(-MIN),
      },
    });
    await applyObservation(sub.id, { state: state({ providerSubscriptionId: psub }), observationAt: NOW }, context);

    expect(await reload(sub.id)).toMatchObject({ cancelAtPeriodEnd: false });
    expect((await notEffective(sub.id))[0]?.details).toMatchObject({ reason: "CHARGED_AFTER_REQUEST" });
  });

  it("(ii) ignores the charge that paid the current period, before the request", async () => {
    const { userId, sub, psub } = await cancelling();

    await prisma.billingMoneyFact.create({
      data: {
        kind: "CHARGE",
        providerMode: "TEST",
        providerObjectId: `pay_${PREFIX}${Date.now()}`,
        subscriptionId: sub.id,
        userId,
        amountMinor: 1000,
        currency: "INR",
        occurredAt: at(-DAY),
      },
    });
    await applyObservation(sub.id, { state: state({ providerSubscriptionId: psub }), observationAt: NOW }, context);

    expect(await reload(sub.id)).toMatchObject({ cancelAtPeriodEnd: true });
  });

  it("(iii) raises it when the subscription is HALTED with the flag set", async () => {
    const { sub, psub } = await cancelling();

    await applyObservation(sub.id, { state: state({ providerSubscriptionId: psub, rawStatus: "halted" }), observationAt: NOW }, context);

    expect(await reload(sub.id)).toMatchObject({ phase: "HALTED", cancelAtPeriodEnd: false });
    expect((await notEffective(sub.id))[0]?.details).toMatchObject({ reason: "HALTED", observedPhase: "HALTED" });
  });

  it("clears the flag without an anomaly when the cancellation is observed", async () => {
    const { sub, psub } = await cancelling();

    await applyObservation(sub.id, { state: state({ providerSubscriptionId: psub, rawStatus: "cancelled" }), observationAt: NOW }, context);

    expect(await reload(sub.id)).toMatchObject({ phase: "CANCELLED", cancelAtPeriodEnd: false });
    expect(await notEffective(sub.id)).toHaveLength(0);
  });

  it("never grants or cuts access on the strength of the request (I-5)", async () => {
    const { userId, sub, psub } = await cancelling();

    await applyObservation(sub.id, { state: state({ providerSubscriptionId: psub }), observationAt: NOW }, context);

    expect((await resolveEffectiveAccess(userId, { expectedMode: "TEST", now: NOW })).plan).toBe("PRO");
  });
});

describe("applyObservation — an unknown cycle-end update proven by the flag (Phase VI)", () => {
  it("settles it and adopts its target, with history", async () => {
    const { userId, sub, psub } = await subscription({
      phase: "ACTIVE",
      plan: "PRO_PLUS",
      providerPlanId: "plan_plus_m",
      lastAppliedObservationAt: at(-2 * HOUR),
    });
    const update = await insertOperation(userId, {
      kind: "UPDATE_PLAN",
      status: "OUTCOME_UNKNOWN",
      subscriptionId: sub.id,
      requestSentAt: at(-HOUR),
      request: { plan: "PRO", cycle: "MONTHLY", scheduleChangeAt: "CYCLE_END" },
    });

    await applyObservation(
      sub.id,
      { state: state({ providerSubscriptionId: psub, providerPlanId: "plan_plus_m", hasScheduledChanges: true }), observationAt: NOW },
      context,
    );

    expect(await prisma.billingOperation.findUniqueOrThrow({ where: { id: update.id } })).toMatchObject({ status: "SUCCEEDED" });
    expect(await reload(sub.id)).toMatchObject({ plan: "PRO_PLUS", scheduledPlan: "PRO", scheduledCycle: "MONTHLY", scheduledByOperationId: update.id });
    expect(await historyOf(sub.id)).toContainEqual(
      expect.objectContaining({ change: "SCHEDULED_CHANGE", toValue: "PRO/MONTHLY", cause: "KIZUNIA_COMMAND", operationId: update.id }),
    );
    // Access is unchanged until the new plan itself is observed.
    expect((await resolveEffectiveAccess(userId, { expectedMode: "TEST", now: NOW })).plan).toBe("PRO_PLUS");
  });
});
