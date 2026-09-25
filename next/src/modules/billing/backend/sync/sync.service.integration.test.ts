/**
 * SyncService against real Postgres and the fake provider: fetch-then-apply,
 * missing-subscription detection (IB-23), ordering between fetches in flight,
 * webhooks during a fetch, coalescing, the targeted claim, and the drain's
 * stopping rules.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Prisma } from "@/generated/prisma";
import { resetLogSink, setLogSink, type LogRecord } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { cleanupBillingUsers, createBillingUser, insertBoundSubscription } from "@/testing/billing-sync-fixtures";

import { createPlanCatalog } from "../../config/plan-catalog";
import { FakeBillingProvider } from "../../provider/fake-provider";
import { ProviderPriority, type BillingProvider } from "../../provider/types";
import { AnomalySubject } from "../anomalies/anomaly.repository";
import { SyncClaimRepository } from "./claim.repository";
import { drainPriorityFor, SyncService } from "./sync.service";

const PREFIX = "__vitest_billing_syncsvc__";
const T0 = new Date("2026-10-01T12:00:00.000Z");
const SEC = 1000;
const MIN = 60 * SEC;

const catalog = createPlanCatalog([
  { providerPlanId: "plan_pro_m", plan: "PRO", cycle: "MONTHLY" },
  { providerPlanId: "plan_plus_m", plan: "PRO_PLUS", cycle: "MONTHLY" },
]);

let clock: Date;
let fake: FakeBillingProvider;
let records: LogRecord[];

const now = () => clock;
const advance = (ms: number) => {
  clock = new Date(clock.getTime() + ms);
};

function service(provider: BillingProvider = fake, overrides: Partial<ConstructorParameters<typeof SyncService>[0]> = {}) {
  return new SyncService({
    providerFor: () => provider,
    resolvedMode: () => "TEST",
    now,
    random: () => 0.5,
    catalog,
    ...overrides,
  });
}

async function bound(overrides: Partial<Prisma.SubscriptionUncheckedCreateInput> = {}) {
  const userId = await createBillingUser(PREFIX);
  const sub = await insertBoundSubscription(userId, { phase: "ACTIVE", ...overrides });

  return { userId, sub, psub: sub.providerSubscriptionId! };
}

function seedActive(psub: string) {
  return fake.seed({ providerSubscriptionId: psub, rawStatus: "active", providerPlanId: "plan_pro_m" });
}

const reload = (id: string) => prisma.subscription.findUniqueOrThrow({ where: { id } });
const fetchesOf = (psub: string) =>
  fake.calls.filter((call) => call.method === "fetchSubscription" && call.args[0] === psub).length;

/** A provider whose fetch is sent (and stamped) at once, but answers only when released. */
class GatedProvider {
  private releases: (() => void)[] = [];

  constructor(private readonly inner: FakeBillingProvider) {}

  asProvider(): BillingProvider {
    return new Proxy(this.inner, {
      get: (target, property, receiver) => {
        if (property !== "fetchSubscription") return Reflect.get(target, property, receiver);

        return async (ref: string) => {
          const outcome = await target.fetchSubscription(ref);
          await new Promise<void>((resolve) => this.releases.push(resolve));

          return outcome;
        };
      },
    });
  }

  async waitForPending(count = 1) {
    while (this.releases.length < count) await new Promise((resolve) => setTimeout(resolve, 5));
  }

  releaseNext() {
    this.releases.shift()?.();
  }

  releaseLast() {
    this.releases.pop()?.();
  }
}

beforeEach(() => {
  clock = T0;
  fake = new FakeBillingProvider({ now });
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

describe("SyncService.syncTargeted", () => {
  it("fetches and applies, with the requested trigger", async () => {
    const { sub, psub } = await bound({ phase: "PENDING_AUTHENTICATION" });
    seedActive(psub);

    const result = await service().syncTargeted(sub.id, ProviderPriority.COMMAND, { trigger: "ADMIN_SYNC", actorUserId: "admin_1" });

    expect(result).toMatchObject({ outcome: "APPLIED", phase: "ACTIVE" });
    expect(await reload(sub.id)).toMatchObject({ phase: "ACTIVE", syncLeaseUntil: null, lastAppliedObservationAt: T0 });
    expect(await prisma.subscriptionHistoryEntry.findFirst({ where: { subscriptionId: sub.id } })).toMatchObject({
      trigger: "ADMIN_SYNC",
      actorUserId: "admin_1",
    });
  });

  it("skips a row another worker holds, without fetching", async () => {
    const { sub, psub } = await bound({ syncLeaseUntil: new Date(T0.getTime() + MIN) });

    expect(await service().syncTargeted(sub.id, ProviderPriority.COMMAND)).toMatchObject({ outcome: "LEASED" });
    expect(fetchesOf(psub)).toBe(0);
  });

  it("never fetches a row of another provider mode: PROVIDER_MODE_MISMATCH", async () => {
    const { sub, psub } = await bound({ providerMode: "LIVE" });

    expect(await service().syncTargeted(sub.id, ProviderPriority.COMMAND)).toMatchObject({ outcome: "MODE_MISMATCH" });
    expect(fetchesOf(psub)).toBe(0);
    expect(await prisma.billingAnomaly.findFirst({ where: { subjectKey: AnomalySubject.subscription(sub.id) } })).toMatchObject({
      type: "PROVIDER_MODE_MISMATCH",
      providerMode: "LIVE",
    });
    expect((await reload(sub.id)).syncLeaseUntil).toBeNull();
  });

  it("reports an unbound row, an unknown one, and a disabled provider", async () => {
    const { sub } = await bound({ phase: "PROVISIONING", providerSubscriptionId: null });

    expect((await service().syncTargeted(sub.id, ProviderPriority.COMMAND)).outcome).toBe("NOT_SYNCABLE");
    expect((await service().syncTargeted("nope", ProviderPriority.COMMAND)).outcome).toBe("NOT_FOUND");
    expect(
      (await service(fake, { resolvedMode: () => "DISABLED" }).syncTargeted(sub.id, ProviderPriority.COMMAND)).outcome,
    ).toBe("PROVIDER_DISABLED");
  });
});

describe("SyncService — a missing provider subscription (IB-23)", () => {
  it("raises PROVIDER_SUBSCRIPTION_MISSING, changes nothing else, backs off, and resolves on a later success", async () => {
    const { sub, psub, userId } = await bound({ phase: "ACTIVE", plan: "PRO" });

    // The fake answers an unknown ID as Razorpay does: 400 BAD_REQUEST_ERROR -> REJECTED.
    const result = await service().syncTargeted(sub.id, ProviderPriority.CONFIRMATION);

    expect(result).toEqual({ outcome: "FAILED", failureClass: "REJECTED", stopBatch: false });
    expect(await reload(sub.id)).toMatchObject({
      phase: "ACTIVE",
      plan: "PRO",
      syncAttempts: 1,
      lastSyncFailureClass: "REJECTED",
      syncReason: "RETRY",
      syncLeaseUntil: null,
      syncDueAt: new Date(T0.getTime() + 45 * SEC),
    });
    const anomaly = await prisma.billingAnomaly.findFirstOrThrow({
      where: { subjectKey: AnomalySubject.providerSubscription(psub) },
    });
    expect(anomaly).toMatchObject({
      type: "PROVIDER_SUBSCRIPTION_MISSING",
      userId,
      providerSubscriptionId: psub,
      resolvedAt: null,
    });
    expect(records.filter((r) => r.event === "billing.alert").map((r) => r.fields.condition)).toContain(
      "PROVIDER_SUBSCRIPTION_MISSING",
    );

    advance(MIN);
    seedActive(psub);
    expect((await service().syncTargeted(sub.id, ProviderPriority.CONFIRMATION)).outcome).toBe("NO_CHANGE");
    expect(await prisma.billingAnomaly.findUniqueOrThrow({ where: { id: anomaly.id } })).toMatchObject({
      resolvedAt: clock,
    });
    expect((await reload(sub.id)).syncAttempts).toBe(0);
  });

  it("treats a NOT_FOUND fetch the same way", async () => {
    const { sub, psub } = await bound();
    fake.failNext("fetchSubscription", "NOT_FOUND");

    await service().syncTargeted(sub.id, ProviderPriority.CONFIRMATION);

    expect(
      await prisma.billingAnomaly.count({ where: { subjectKey: AnomalySubject.providerSubscription(psub), type: "PROVIDER_SUBSCRIPTION_MISSING" } }),
    ).toBe(1);
  });

  it("does not read a timeout as missing", async () => {
    const { sub, psub } = await bound();
    fake.failNext("fetchSubscription", "TIMEOUT");

    expect((await service().syncTargeted(sub.id, ProviderPriority.CONFIRMATION)).failureClass).toBe("TIMEOUT");
    expect(await prisma.billingAnomaly.count({ where: { subjectKey: AnomalySubject.providerSubscription(psub) } })).toBe(0);
  });
});

describe("SyncService — refusals that sent nothing", () => {
  it("leaves the row due exactly as it was, counts no attempt, and stops the batch", async () => {
    const due = new Date(T0.getTime() - MIN);
    const { sub } = await bound({ syncDueAt: due, syncReason: "WEBHOOK" });
    fake.failNext("fetchSubscription", "BUDGET_EXHAUSTED");

    const result = await service().syncTargeted(sub.id, ProviderPriority.CONFIRMATION);

    expect(result).toEqual({ outcome: "NOT_ATTEMPTED", failureClass: "BUDGET_EXHAUSTED", stopBatch: true });
    expect(await reload(sub.id)).toMatchObject({ syncDueAt: due, syncAttempts: 0, syncLeaseUntil: null, syncReason: "WEBHOOK" });
  });
});

describe("SyncService — ordering between fetches in flight", () => {
  it("discards an older fetch that answers after a newer one (lease lapsed mid-fetch)", async () => {
    const { sub, psub } = await bound({ phase: "ACTIVE" });
    seedActive(psub);
    const gate = new GatedProvider(fake);

    // Fetch A is sent at T0 and hangs past its lease.
    const a = service(gate.asProvider()).syncTargeted(sub.id, ProviderPriority.CONFIRMATION);
    await gate.waitForPending(1);

    advance(2 * MIN);
    fake.seed({ providerSubscriptionId: psub, rawStatus: "halted", providerPlanId: "plan_pro_m" });

    // Fetch B reclaims the row, is sent later, and answers first.
    const b = service(gate.asProvider()).syncTargeted(sub.id, ProviderPriority.CONFIRMATION);
    await gate.waitForPending(2);
    gate.releaseLast();
    expect((await b).outcome).toBe("APPLIED");

    gate.releaseNext();
    expect((await a).outcome).toBe("STALE_DISCARDED");

    expect(await reload(sub.id)).toMatchObject({ phase: "HALTED", lastAppliedObservationAt: clock });
  });

  it("applies the newer answer and discards the older one when the older arrives last", async () => {
    const { sub, psub } = await bound({ phase: "ACTIVE" });
    seedActive(psub);

    // Newer observation first (sent at T0 + 2 min, applied), then the older (sent at T0) arrives.
    const oldAnswer = await fake.fetchSubscription(psub);
    advance(2 * MIN);
    fake.seed({ providerSubscriptionId: psub, rawStatus: "halted", providerPlanId: "plan_pro_m" });

    expect((await service().syncTargeted(sub.id, ProviderPriority.CONFIRMATION)).outcome).toBe("APPLIED");

    const late: BillingProvider = new Proxy(fake, {
      get: (target, property, receiver) =>
        property === "fetchSubscription" ? async () => oldAnswer : Reflect.get(target, property, receiver),
    });

    expect((await service(late).syncTargeted(sub.id, ProviderPriority.CONFIRMATION)).outcome).toBe("STALE_DISCARDED");
    expect(await reload(sub.id)).toMatchObject({ phase: "HALTED", syncLeaseUntil: null });
  });

  it("a webhook recorded while a fetch is in flight leaves the row due for another fetch", async () => {
    const { sub, psub } = await bound({ phase: "ACTIVE" });
    seedActive(psub);
    const gate = new GatedProvider(fake);

    const inFlight = service(gate.asProvider()).syncTargeted(sub.id, ProviderPriority.CONFIRMATION);
    await gate.waitForPending();

    advance(SEC);
    await SyncClaimRepository.markDue(prisma, sub.id, "WEBHOOK", clock, { eventDriven: true, now: clock });

    gate.releaseNext();
    expect((await inFlight).outcome).toMatch(/APPLIED|NO_CHANGE/);

    // The fetch was sent before the event: the row stays due now, so the event is observed.
    expect(await reload(sub.id)).toMatchObject({ syncDueAt: clock, syncReason: "WEBHOOK" });

    await service().drain({ mode: "TEST", deadline: new Date(clock.getTime() + MIN) });
    expect(fetchesOf(psub)).toBe(2);
  });
});

describe("SyncService.drain", () => {
  it("coalesces a burst of webhooks into one fetch", async () => {
    const { sub, psub } = await bound();
    seedActive(psub);

    for (let i = 0; i < 10; i += 1) {
      await SyncClaimRepository.markDue(prisma, sub.id, "WEBHOOK", clock, { eventDriven: true, now: clock });
    }
    advance(SEC);

    const counts = await service().drain({ mode: "TEST", deadline: new Date(clock.getTime() + MIN) });

    expect(fetchesOf(psub)).toBe(1);
    expect(counts).toMatchObject({ stoppedBy: "EMPTY" });
    expect((await reload(sub.id)).syncDueAt!.getTime()).toBeGreaterThan(clock.getTime());
  });

  it("stops at the deadline and gives the unreached rows back, still due", async () => {
    const rows = await Promise.all(
      Array.from({ length: 4 }, async (_, i) => {
        const b = await bound({ syncDueAt: new Date(T0.getTime() - (10 - i) * SEC) });
        seedActive(b.psub);
        return b;
      }),
    );
    // Every fetch takes five seconds.
    const slow: BillingProvider = new Proxy(fake, {
      get: (target, property, receiver) =>
        property === "fetchSubscription"
          ? async (ref: string) => {
              const outcome = await target.fetchSubscription(ref);
              advance(5 * SEC);
              return outcome;
            }
          : Reflect.get(target, property, receiver),
    });

    const counts = await service(slow).drain({ mode: "TEST", deadline: new Date(T0.getTime() + 8 * SEC), batchSize: 10 });

    expect(counts).toMatchObject({ stoppedBy: "DEADLINE", claimed: 2 });
    expect(rows.map((r) => fetchesOf(r.psub))).toEqual([1, 1, 0, 0]);
    for (const r of rows.slice(2)) {
      expect(await reload(r.sub.id)).toMatchObject({ syncLeaseUntil: null, syncDueAt: new Date(T0.getTime() - (10 - rows.indexOf(r)) * SEC) });
    }
  });

  it("stops as soon as a call is refused before sending", async () => {
    const [a, b] = [await bound({ syncDueAt: new Date(T0.getTime() - 2 * SEC) }), await bound({ syncDueAt: new Date(T0.getTime() - SEC) })];
    fake.failNext("fetchSubscription", "BUDGET_EXHAUSTED");

    const counts = await service().drain({ mode: "TEST", deadline: new Date(T0.getTime() + MIN) });

    expect(counts).toMatchObject({ stoppedBy: "NOT_ATTEMPTED", notAttempted: 1 });
    expect(fetchesOf(b.psub)).toBe(0);
    for (const row of [a, b]) expect((await reload(row.sub.id)).syncLeaseUntil).toBeNull();
  });

  it("raises SYNC_OVERDUE when a subscription keeps failing", async () => {
    const { sub } = await bound({ syncAttempts: 5, syncDueAt: new Date(T0.getTime() - SEC) });
    fake.failNext("fetchSubscription", "UNAVAILABLE");

    const counts = await service().drain({ mode: "TEST", deadline: new Date(T0.getTime() + MIN) });

    expect(counts.failed).toEqual({ UNAVAILABLE: 1 });
    expect((await reload(sub.id)).syncAttempts).toBe(6);
    expect(records.some((r) => r.event === "billing.alert" && r.fields.condition === "SYNC_OVERDUE")).toBe(true);
  });

  it("fetches event-marked rows at priority 2 and everything else at priority 3", () => {
    expect(drainPriorityFor({ syncReason: "WEBHOOK" })).toBe(ProviderPriority.CONFIRMATION);
    expect(drainPriorityFor({ syncReason: "CHECKOUT_CONFIRM" })).toBe(ProviderPriority.CONFIRMATION);
    expect(drainPriorityFor({ syncReason: "HEARTBEAT" })).toBe(ProviderPriority.RECONCILIATION);
    expect(drainPriorityFor({ syncReason: "RETRY" })).toBe(ProviderPriority.RECONCILIATION);
  });
});
