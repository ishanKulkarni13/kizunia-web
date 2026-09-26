/**
 * The trial lifecycle through the one apply path and the Phase VI commands
 * (Phase VII), against real Postgres and the fake provider: authenticated ->
 * TRIALING, the IB-9 conversion grace and its `TRIAL_CONVERSION_OVERDUE`
 * anomaly, conversion and first-charge failure, cancelling during the trial,
 * a plan change during it, and the races and stale observations around them.
 *
 * There is no trial-specific cancel, plan change, recovery or sync: each of
 * these is the existing code, extended only where the state machine requires
 * it. What the fake cannot show is what Razorpay does when `start_at` passes
 * (TEST mode never runs the first charge, A7); that is recorded in the
 * runbook and never claimed from here.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveEffectiveAccess } from "@/lib/entitlements/resolver";
import { resetLogSink, setLogSink, type LogRecord } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { cleanupBillingUsers, createBillingUser } from "@/testing/billing-sync-fixtures";
import { historyOf, lifecycleCatalog, operationsOf, reloadSubscription, seedLive } from "@/testing/billing-lifecycle-fixtures";

import { SYNC_SCHEDULE_CONFIG } from "../../config/billing-config";
import { PlanChangeUnavailableError, SubscriptionExistsError, TrialNotEligibleError } from "../../errors";
import { FakeBillingProvider } from "../../provider/fake-provider";
import { ProviderPriority } from "../../provider/types";
import { AnomalySubject } from "../anomalies/anomaly.repository";
import { CancelSubscriptionCommand } from "../commands/cancel";
import { ChangePlanCommand } from "../commands/change-plan";
import { CommandRunner } from "../commands/command-runner";
import { StartCheckoutCommand } from "../commands/start-checkout";
import { applyObservation } from "./apply";
import { SyncService } from "./sync.service";

const PREFIX = "__vitest_billing_trial_lifecycle__";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const GRACE_MS = SYNC_SCHEDULE_CONFIG.trialConversionGraceSeconds * 1000;
const INTL = { advisoryPaymentMethod: "card", advisoryInternationalCard: true } as const;

let fake: FakeBillingProvider;
let clock: Date;
let providerTick = 0;
let keys = 0;
let records: LogRecord[];
const now = () => clock;
const providerNow = () => new Date(clock.getTime() + (providerTick += 1));
const advance = (ms: number) => {
  clock = new Date(clock.getTime() + ms);
};

const runner = () => new CommandRunner({ providerFor: () => fake, resolvedMode: () => "TEST", assertEnabled: () => {}, now, catalog: lifecycleCatalog });
const key = () => `key_${PREFIX}${Date.now()}_${(keys += 1)}`;
const sync = () => new SyncService({ providerFor: () => fake, resolvedMode: () => "TEST", now, random: () => 0.5, catalog: lifecycleCatalog });
const access = async (userId: string) => (await resolveEffectiveAccess(userId, { expectedMode: "TEST", now: clock })).plan;
const events = (name: string) => records.filter((r) => r.event === name);
const alerts = () => records.filter((r) => r.event === "billing.alert").map((r) => r.fields.condition);
const overdueAnomalies = (subscriptionId: string) =>
  prisma.billingAnomaly.findMany({ where: { type: "TRIAL_CONVERSION_OVERDUE", subjectKey: AnomalySubject.subscription(subscriptionId) } });

/** A TRIALING subscription whose trial ends at `startAt`. */
async function trialing(startAt: Date, plan: "PRO" | "PRO_PLUS" = "PRO") {
  const userId = await createBillingUser(PREFIX);
  const row = await seedLive(fake, userId, { phase: "TRIALING", plan, now: clock, row: { startAt }, provider: { startAt, paidCount: 0 }, ...INTL });

  return { userId, row, psub: row.providerSubscriptionId! };
}

const observe = (subscriptionId: string, psub: string, observationAt = new Date(clock.getTime() + 1)) =>
  applyObservation(subscriptionId, { state: fake.peek(psub)!, observationAt }, { resolvedMode: "TEST", catalog: lifecycleCatalog, now: clock, trigger: "WEBHOOK" });

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

describe("a trial through the apply path", () => {
  it("is TRIALING and contributes the trial's plan before start_at, and never before authentication", async () => {
    const userId = await createBillingUser(PREFIX);
    const row = await seedLive(fake, userId, { phase: "PENDING_AUTHENTICATION", plan: "PRO_PLUS", now: clock, row: { kind: "TRIAL", startAt: new Date(clock.getTime() + 14 * DAY) } });
    const psub = row.providerSubscriptionId!;

    expect(await access(userId)).toBe("FREE");

    fake.seed({ ...fake.peek(psub)!, providerSubscriptionId: psub, rawStatus: "authenticated", startAt: new Date(clock.getTime() + 14 * DAY), paidCount: 0 });
    await observe(row.id, psub);

    expect(await reloadSubscription(row.id)).toMatchObject({ phase: "TRIALING" });
    expect(await access(userId)).toBe("PRO_PLUS");
    expect((await reloadSubscription(row.id)).firstContributedAt).not.toBeNull();
    expect(await historyOf(row.id)).toContainEqual(expect.objectContaining({ change: "PHASE", fromValue: "PENDING_AUTHENTICATION", toValue: "TRIALING" }));
    expect(events("trial.started")).toHaveLength(1);
  });

  it("never treats a STANDARD subscription with a future start as a trial (SB-LC-10)", async () => {
    const userId = await createBillingUser(PREFIX);
    const row = await seedLive(fake, userId, { phase: "PENDING_AUTHENTICATION", now: clock });
    const psub = row.providerSubscriptionId!;

    fake.seed({ ...fake.peek(psub)!, providerSubscriptionId: psub, rawStatus: "authenticated", startAt: new Date(clock.getTime() + 14 * DAY) });
    await observe(row.id, psub);

    expect(await reloadSubscription(row.id)).toMatchObject({ kind: "STANDARD", phase: "PENDING_AUTHENTICATION" });
    expect(await access(userId)).toBe("FREE");
  });
});

describe("conversion (IB-9, C7)", () => {
  it("keeps access through the first charge: TRIALING -> ACTIVE, with no gap, and records the conversion", async () => {
    const { userId, row, psub } = await trialing(new Date(clock.getTime() + DAY));

    advance(2 * DAY); // start_at has passed, Razorpay has not reported a charge yet
    await observe(row.id, psub);
    expect(await reloadSubscription(row.id)).toMatchObject({ phase: "TRIALING" });
    expect(await access(userId)).toBe("PRO");

    fake.seed({ ...fake.peek(psub)!, providerSubscriptionId: psub, rawStatus: "active", paidCount: 1, currentStart: clock, currentEnd: new Date(clock.getTime() + 30 * DAY) });
    advance(MINUTE);
    await observe(row.id, psub);

    const after = await reloadSubscription(row.id);
    expect(after).toMatchObject({ phase: "ACTIVE", kind: "TRIAL" });
    expect(await access(userId)).toBe("PRO");
    expect(events("trial.converted")).toHaveLength(1);
    expect(await historyOf(row.id)).toContainEqual(expect.objectContaining({ change: "PHASE", fromValue: "TRIALING", toValue: "ACTIVE" }));
  });

  it("stays TRIALING for a trial still authenticated up to the last instant of the grace, then stops contributing and raises the anomaly", async () => {
    const startAt = new Date(clock.getTime() + DAY);
    const { userId, row, psub } = await trialing(startAt);

    clock = new Date(startAt.getTime() + GRACE_MS - 1);
    await observe(row.id, psub);
    expect(await reloadSubscription(row.id)).toMatchObject({ phase: "TRIALING" });
    expect(await access(userId)).toBe("PRO");
    expect(await overdueAnomalies(row.id)).toHaveLength(0);

    clock = new Date(startAt.getTime() + GRACE_MS);
    await observe(row.id, psub);

    expect(await reloadSubscription(row.id)).toMatchObject({ phase: "PENDING_AUTHENTICATION" });
    expect(await access(userId)).toBe("FREE");

    const anomalies = await overdueAnomalies(row.id);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]).toMatchObject({ type: "TRIAL_CONVERSION_OVERDUE", resolvedAt: null, occurrences: 1, userId });
    expect(alerts().filter((condition) => condition === "TRIAL_CONVERSION_OVERDUE")).toHaveLength(1);
    expect(events("trial.ended")).toHaveLength(1);
  });

  it("raises the anomaly once: a repeat observation bumps its count and does not alert again", async () => {
    const startAt = new Date(clock.getTime() + DAY);
    const { row, psub } = await trialing(startAt);
    clock = new Date(startAt.getTime() + GRACE_MS + HOUR);

    await observe(row.id, psub);
    advance(MINUTE);
    await observe(row.id, psub);

    const anomalies = await overdueAnomalies(row.id);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].occurrences).toBe(2);
    expect(alerts().filter((condition) => condition === "TRIAL_CONVERSION_OVERDUE")).toHaveLength(1);
  });

  it("leaves the anomaly open when the first charge finally arrives: it is for an operator, never auto-resolved (IB-27 item 18)", async () => {
    const startAt = new Date(clock.getTime() + DAY);
    const { userId, row, psub } = await trialing(startAt);
    clock = new Date(startAt.getTime() + GRACE_MS + HOUR);
    await observe(row.id, psub);

    fake.seed({ ...fake.peek(psub)!, providerSubscriptionId: psub, rawStatus: "active", paidCount: 1, currentStart: clock, currentEnd: new Date(clock.getTime() + 30 * DAY) });
    advance(MINUTE);
    await observe(row.id, psub);

    expect(await reloadSubscription(row.id)).toMatchObject({ phase: "ACTIVE" });
    expect(await access(userId)).toBe("PRO");
    expect((await overdueAnomalies(row.id))[0].resolvedAt).toBeNull();
  });

  it("presumes the ordinary pending -> halted path for a failed first charge: PAST_DUE still contributes, HALTED does not (A7 is unverified)", async () => {
    const { userId, row, psub } = await trialing(new Date(clock.getTime() + DAY));
    advance(2 * DAY);

    fake.seed({ ...fake.peek(psub)!, providerSubscriptionId: psub, rawStatus: "pending" });
    await observe(row.id, psub);
    expect(await reloadSubscription(row.id)).toMatchObject({ phase: "PAST_DUE" });
    expect(await access(userId)).toBe("PRO");
    expect(events("trial.first_charge_failed")).toHaveLength(1);

    fake.seed({ ...fake.peek(psub)!, providerSubscriptionId: psub, rawStatus: "halted" });
    advance(MINUTE);
    await observe(row.id, psub);
    expect(await reloadSubscription(row.id)).toMatchObject({ phase: "HALTED" });
    expect(await access(userId)).toBe("FREE");
  });

  it("ignores a stale observation: an older fetch never rolls a converted trial back to TRIALING", async () => {
    const { row, psub } = await trialing(new Date(clock.getTime() + DAY));
    advance(2 * DAY);
    const stale = { ...fake.peek(psub)! }; // still authenticated
    fake.seed({ ...fake.peek(psub)!, providerSubscriptionId: psub, rawStatus: "active", paidCount: 1 });
    const later = new Date(clock.getTime() + 10 * MINUTE);

    await observe(row.id, psub, later);
    const result = await applyObservation(
      row.id,
      { state: stale, observationAt: new Date(later.getTime() - 5 * MINUTE) },
      { resolvedMode: "TEST", catalog: lifecycleCatalog, now: clock, trigger: "WEBHOOK" },
    );

    expect(result.outcome).toBe("STALE_DISCARDED");
    expect(await reloadSubscription(row.id)).toMatchObject({ phase: "ACTIVE" });
  });

  it("converges on the same state whether a webhook or the reconciliation sync observes the conversion", async () => {
    const a = await trialing(new Date(clock.getTime() + DAY));
    const b = await trialing(new Date(clock.getTime() + DAY));
    advance(2 * DAY);
    for (const { psub } of [a, b]) {
      fake.seed({ ...fake.peek(psub)!, providerSubscriptionId: psub, rawStatus: "active", paidCount: 1 });
    }

    await Promise.all([observe(a.row.id, a.psub), sync().syncTargeted(b.row.id, ProviderPriority.CONFIRMATION)]);

    expect((await reloadSubscription(a.row.id)).phase).toBe("ACTIVE");
    expect((await reloadSubscription(b.row.id)).phase).toBe("ACTIVE");
  });
});

describe("cancelling during a trial — the existing cancel command", () => {
  it("cancels immediately (Razorpay refuses a cycle-end cancel before the first cycle), ends access at once, and keeps eligibility consumed", async () => {
    const { userId, row } = await trialing(new Date(clock.getTime() + 7 * DAY));

    const result = await runner().run(new CancelSubscriptionCommand("IMMEDIATE"), { actor: { userId, actorKind: "USER", actorUserId: userId }, idempotencyKey: key() });

    expect(result.status).toBe("CANCELLED");
    expect(fake.calls.find((call) => call.method === "cancelSubscription")!.args[1]).toEqual({ atCycleEnd: false });
    expect(await reloadSubscription(row.id)).toMatchObject({ phase: "CANCELLED", kind: "TRIAL" });
    expect(await access(userId)).toBe("FREE");
    expect(events("trial.cancelled")).toHaveLength(1);
    expect((await operationsOf(userId))[0]).toMatchObject({ kind: "CANCEL_IMMEDIATELY", status: "SUCCEEDED" });

    // One trial per account: cancelling did not give the trial back.
    const callsBefore = fake.calls.length;
    await expect(
      runner().run(new StartCheckoutCommand({ plan: "PRO", cycle: "MONTHLY", trial: true }, { keyId: () => "rzp_test_k" }), {
        actor: { userId, actorKind: "USER", actorUserId: userId },
        idempotencyKey: key(),
      }),
    ).rejects.toBeInstanceOf(TrialNotEligibleError);
    expect(fake.calls).toHaveLength(callsBefore);
  });

  it("refuses a cycle-end cancel of a trial: the timing the customer acknowledged must be the one required (immediate)", async () => {
    const { userId } = await trialing(new Date(clock.getTime() + 7 * DAY));

    await expect(
      runner().run(new CancelSubscriptionCommand("CYCLE_END"), { actor: { userId, actorKind: "USER", actorUserId: userId }, idempotencyKey: key() }),
    ).rejects.toMatchObject({ code: "BILLING_CANCELLATION_TIMING_CHANGED", details: { timing: "IMMEDIATE" } });
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses a second purchase or trial while the trial is running", async () => {
    const { userId } = await trialing(new Date(clock.getTime() + 7 * DAY));

    for (const trial of [true, false]) {
      await expect(
        runner().run(new StartCheckoutCommand({ plan: "PRO_PLUS", cycle: "MONTHLY", trial }, { keyId: () => "rzp_test_k" }), {
          actor: { userId, actorKind: "USER", actorUserId: userId },
          idempotencyKey: key(),
        }),
      ).rejects.toBeInstanceOf(SubscriptionExistsError);
    }
    expect(fake.calls).toHaveLength(0);
  });
});

describe("changing plan during a trial — the existing change-plan command", () => {
  const change = (userId: string, plan: "PRO" | "PRO_PLUS", cycle: "MONTHLY" | "YEARLY") =>
    runner().run(new ChangePlanCommand({ plan, cycle }), { actor: { userId, actorKind: "USER", actorUserId: userId }, idempotencyKey: key() });

  it("allows an upgrade where Razorpay accepts an update for the authenticated subscription", async () => {
    const { userId, row } = await trialing(new Date(clock.getTime() + 7 * DAY));

    expect((await change(userId, "PRO_PLUS", "MONTHLY")).status).toBe("UPGRADED");
    expect(await reloadSubscription(row.id)).toMatchObject({ plan: "PRO_PLUS", kind: "TRIAL", phase: "TRIALING" });
    expect(await access(userId)).toBe("PRO_PLUS");
  });

  it("refuses a downgrade during a trial: only a paid subscription schedules one, at cycle end", async () => {
    const { userId } = await trialing(new Date(clock.getTime() + 7 * DAY), "PRO_PLUS");

    await expect(change(userId, "PRO", "MONTHLY")).rejects.toBeInstanceOf(PlanChangeUnavailableError);
    expect(fake.calls).toHaveLength(0);
  });
});
