/**
 * Orphan discovery against real Postgres and the fake provider: lost creates
 * are bound through Kizunia's notes, the watermark advances only after a full
 * window, and a create is closed ABANDONED only once the window has passed
 * its send time plus the overlap.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { BillingProviderState } from "@/generated/prisma";
import prisma from "@/lib/prisma";
import { cleanupBillingUsers, createBillingUser, insertBoundSubscription } from "@/testing/billing-sync-fixtures";

import { createPlanCatalog } from "../../config/plan-catalog";
import { BudgetedProvider } from "../../provider/budgeted-provider";
import { FakeBillingProvider } from "../../provider/fake-provider";
import { ProviderPriority } from "../../provider/types";
import { AnomalySubject } from "../anomalies/anomaly.repository";
import { CommandRunner, type CommandRunnerDeps } from "../commands/command-runner";
import { StartCheckoutCommand } from "../commands/start-checkout";
import { SupersedeCommand } from "../commands/supersede";
import { OrphanDiscoveryService, type OrphanDiscoverySettings, type OrphanRunResult } from "./orphan-discovery.service";

const PREFIX = "__vitest_billing_orphan__";
const MINUTE = 60_000;
const SETTINGS: OrphanDiscoverySettings = { overlapSeconds: 15 * 60, settleDelaySeconds: 5 * 60, pageSize: 100, maxPagesPerRun: 3 };

const catalog = createPlanCatalog(
  (["PRO", "PRO_PLUS"] as const).flatMap((plan) =>
    (["MONTHLY", "YEARLY"] as const).map((cycle) => ({ providerPlanId: `plan_fake_${plan}_${cycle}`, plan, cycle })),
  ),
);

let fake: FakeBillingProvider;
let clock: Date;
let tick = 0;
let sequence = 0;
let saved: BillingProviderState | null;
const now = () => clock;
const providerNow = () => new Date(clock.getTime() + (tick += 1));
const advance = (ms: number) => {
  clock = new Date(clock.getTime() + ms);
};

const service = (settings: Partial<OrphanDiscoverySettings> = {}, providerFor = () => fake as never) =>
  new OrphanDiscoveryService({ providerFor, resolvedMode: () => "TEST", now, catalog, settings: { ...SETTINGS, ...settings } });

async function scan(settings: Partial<OrphanDiscoverySettings> = {}): Promise<OrphanRunResult> {
  const result = await service(settings).run({ deadline: new Date(clock.getTime() + MINUTE) });

  if ("skipped" in result) throw new Error("unexpected skip");

  return result;
}

async function setCursor(watermark: Date | null, windowTo: Date | null = null, skip = 0) {
  await prisma.billingProviderState.upsert({
    where: { providerMode: "TEST" },
    create: { providerMode: "TEST", orphanWatermark: watermark, orphanWindowTo: windowTo, orphanSkip: skip },
    update: { orphanWatermark: watermark, orphanWindowTo: windowTo, orphanSkip: skip },
  });
}

const cursor = () => prisma.billingProviderState.findUniqueOrThrow({ where: { providerMode: "TEST" } });

async function startCheckout(userId: string, deps: CommandRunnerDeps = {}) {
  const runner = new CommandRunner({ providerFor: () => fake, resolvedMode: () => "TEST", assertEnabled: () => {}, now, catalog, ...deps });

  return runner.run(new StartCheckoutCommand({ plan: "PRO", cycle: "MONTHLY" }, { keyId: () => "k" }), {
    actor: { userId, actorKind: "USER", actorUserId: userId },
    idempotencyKey: `key_${PREFIX.replace(/[^A-Za-z0-9_]/g, "")}${Date.now()}_${(sequence += 1)}`,
  });
}

/** A HALTED subscription superseded through the runner (Phase VI): its create is a child of a SUPERSEDE root. */
async function supersede(userId: string) {
  const old = await insertBoundSubscription(userId, { phase: "HALTED", providerPlanId: "plan_fake_PRO_MONTHLY", lastAppliedObservationAt: new Date(clock.getTime() - MINUTE) });
  fake.seed({ providerSubscriptionId: old.providerSubscriptionId!, rawStatus: "halted", providerPlanId: "plan_fake_PRO_MONTHLY", notes: { kz_sub: old.id } }, new Date(clock.getTime() - 60 * MINUTE));
  const runner = new CommandRunner({ providerFor: () => fake, resolvedMode: () => "TEST", assertEnabled: () => {}, now, catalog });

  return runner.run(new SupersedeCommand({ plan: "PRO", cycle: "MONTHLY", supersedesSubscriptionId: old.id }, { keyId: () => "k" }), {
    actor: { userId, actorKind: "USER", actorUserId: userId },
    idempotencyKey: `key_${PREFIX.replace(/[^A-Za-z0-9_]/g, "")}${Date.now()}_${(sequence += 1)}`,
  });
}

const psubId = () => `sub_${PREFIX}${Date.now()}_${(sequence += 1)}`;
const crash = { beforeSettle: async () => Promise.reject(new Error("process died")) };

beforeAll(async () => {
  saved = await prisma.billingProviderState.findUnique({ where: { providerMode: "TEST" } });
});
beforeEach(async () => {
  clock = new Date();
  fake = new FakeBillingProvider({ now: providerNow, idPrefix: `sub_${PREFIX}${Date.now()}_` });
  // Leftover unknown creates from other suites must not be closed by (or confuse) these runs.
  await setCursor(new Date(clock.getTime() - MINUTE));
});
afterEach(() => cleanupBillingUsers(PREFIX));
afterAll(async () => {
  await cleanupBillingUsers(PREFIX);
  await prisma.billingProviderState.update({
    where: { providerMode: "TEST" },
    data: {
      orphanWatermark: saved?.orphanWatermark ?? null,
      orphanWindowTo: saved?.orphanWindowTo ?? null,
      orphanSkip: saved?.orphanSkip ?? 0,
    },
  });
  await prisma.$disconnect();
});

describe("orphan discovery — binding lost creates through notes", () => {
  it("binds a create whose response was lost: provider ID, create SUCCEEDED, state applied", async () => {
    const userId = await createBillingUser(PREFIX);
    fake.failNext("createSubscription", "TIMEOUT", { afterApplying: true });
    await startCheckout(userId);
    const [subscription] = await prisma.subscription.findMany({ where: { userId } });
    const [operation] = await prisma.billingOperation.findMany({ where: { userId } });
    expect(operation.status).toBe("OUTCOME_UNKNOWN");

    advance(6 * MINUTE);
    const result = await scan();

    expect(result).toMatchObject({ bound: 1, stoppedBy: "WINDOW_COMPLETE", closed: 0 });
    expect(await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } })).toMatchObject({
      phase: "PENDING_AUTHENTICATION",
      providerSubscriptionId: expect.stringContaining(PREFIX),
    });
    expect(await prisma.billingOperation.findUniqueOrThrow({ where: { id: operation.id } })).toMatchObject({ status: "SUCCEEDED" });
    const binding = await prisma.subscriptionHistoryEntry.findFirst({ where: { subscriptionId: subscription.id, change: "BINDING" } });
    expect(binding).toMatchObject({ trigger: "ORPHAN_DISCOVERY", cause: "KIZUNIA_COMMAND", operationId: operation.id });
    expect(fake.calls.filter((call) => call.method === "createSubscription")).toHaveLength(1);
  });

  it("recovers a create the provider made before the process died (lease lapsed, requestSentAt never written)", async () => {
    const userId = await createBillingUser(PREFIX);
    await expect(startCheckout(userId, crash)).rejects.toThrow("process died");

    advance(6 * MINUTE);
    const result = await scan();

    expect(result).toMatchObject({ operationsExpired: 1, bound: 1 });
    expect(await prisma.billingOperation.findFirstOrThrow({ where: { userId } })).toMatchObject({ status: "SUCCEEDED" });
  });

  it("skips known IDs, and flags notes that name nothing it can bind, another mode, or no notes at all", async () => {
    const userId = await createBillingUser(PREFIX);
    const known = await insertBoundSubscription(userId, { providerSubscriptionId: psubId() });
    const createdAt = new Date(clock.getTime() + MINUTE);
    fake.seed({ providerSubscriptionId: known.providerSubscriptionId! }, createdAt);
    const conflict = fake.seed({ providerSubscriptionId: psubId(), notes: { kz_sub: known.id, kz_op: "op", kz_env: "TEST" } }, createdAt);
    const otherMode = fake.seed({ providerSubscriptionId: psubId(), notes: { kz_sub: "x", kz_op: "y", kz_env: "LIVE" } }, createdAt);
    const bare = fake.seed({ providerSubscriptionId: psubId() }, createdAt);

    advance(7 * MINUTE);
    const result = await scan();

    expect(result).toMatchObject({ items: 4, known: 1, unmatched: 1, conflicts: 2, bound: 0 });
    const anomalies = await prisma.billingAnomaly.findMany({ where: { subjectKey: { contains: PREFIX } } });
    const typeOf = (psub: string) => anomalies.find((a) => a.subjectKey === AnomalySubject.providerSubscription(psub))?.type;
    expect(typeOf(conflict.providerSubscriptionId)).toBe("NOTES_CONFLICT");
    expect(typeOf(otherMode.providerSubscriptionId)).toBe("PROVIDER_MODE_MISMATCH");
    expect(typeOf(bare.providerSubscriptionId)).toBe("UNMATCHED_PROVIDER_SUBSCRIPTION");
    // Never attached, never cancelled.
    expect(fake.calls.map((call) => call.method)).toEqual(["listSubscriptions"]);
  });
});

describe("orphan discovery — the window and the watermark", () => {
  it("advances the watermark only after a full window, resuming a partial one where it stopped", async () => {
    const start = new Date(clock.getTime() - MINUTE);
    for (let i = 0; i < 5; i += 1) fake.seed({ providerSubscriptionId: psubId() }, new Date(clock.getTime() + i * 1000));
    advance(7 * MINUTE);

    const first = await scan({ pageSize: 2, maxPagesPerRun: 1 });
    expect(first).toMatchObject({ pages: 1, items: 2, stoppedBy: "MAX_PAGES" });
    expect(await cursor()).toMatchObject({ orphanWatermark: start, orphanSkip: 2 });
    const windowTo = (await cursor()).orphanWindowTo;
    expect(windowTo).not.toBeNull();

    advance(MINUTE); // later runs continue the same window, not a new one
    const second = await scan({ pageSize: 2, maxPagesPerRun: 1 });
    expect(second).toMatchObject({ items: 2, stoppedBy: "MAX_PAGES" });
    expect(await cursor()).toMatchObject({ orphanWatermark: start, orphanWindowTo: windowTo, orphanSkip: 4 });

    const third = await scan({ pageSize: 2, maxPagesPerRun: 1 });
    expect(third).toMatchObject({ items: 1, stoppedBy: "WINDOW_COMPLETE" });
    expect(await cursor()).toMatchObject({ orphanWatermark: windowTo, orphanWindowTo: null, orphanSkip: 0 });
    expect(first.unmatched + second.unmatched + third.unmatched).toBe(5);
  });

  it("keeps the cursor when the budget refuses the call: nothing sent, nothing skipped", async () => {
    fake.seed({ providerSubscriptionId: psubId() }, new Date(clock.getTime() + MINUTE));
    advance(7 * MINUTE);
    const refusing = new BudgetedProvider(
      fake,
      { acquire: async () => false },
      { verdict: async () => "CLEAR", record: async () => {} },
      ProviderPriority.ORPHAN_DISCOVERY,
    );

    const result = await service({}, () => refusing as never).run({ deadline: new Date(clock.getTime() + MINUTE) });

    expect(result).toMatchObject({ stoppedBy: "NOT_ATTEMPTED", pages: 0 });
    expect(fake.calls).toHaveLength(0);
    expect(await cursor()).toMatchObject({ orphanSkip: 0 });
    expect((await cursor()).orphanWindowTo).not.toBeNull();

    // The next run with budget scans the same window from its start.
    expect(await scan()).toMatchObject({ items: 1, stoppedBy: "WINDOW_COMPLETE" });
  });

  it("scans nothing while the window would be empty (inside the settle delay)", async () => {
    await setCursor(clock);

    expect((await scan()).stoppedBy).toBe("EMPTY_WINDOW");
    expect(fake.calls).toHaveLength(0);
  });
});

describe("orphan discovery — closing the window (ABANDONED / NOT_APPLIED)", () => {
  it("closes an unknown create only once the watermark passes its send time plus the overlap", async () => {
    const userId = await createBillingUser(PREFIX);
    fake.failNext("createSubscription", "TIMEOUT"); // the provider never created it
    await startCheckout(userId);
    const [operation] = await prisma.billingOperation.findMany({ where: { userId } });
    const sentAt = operation.requestSentAt!;

    // A complete window that ends before sentAt + overlap: too early to close.
    advance(6 * MINUTE);
    expect(await scan()).toMatchObject({ stoppedBy: "WINDOW_COMPLETE", closed: 0 });
    expect(await prisma.subscription.findFirstOrThrow({ where: { userId } })).toMatchObject({ phase: "PROVISIONING" });
    expect((await cursor()).orphanWatermark!.getTime()).toBeLessThan(sentAt.getTime() + 15 * MINUTE);

    // Once a complete window passes it: closed.
    advance(20 * MINUTE);
    expect(await scan()).toMatchObject({ stoppedBy: "WINDOW_COMPLETE", closed: 1 });
    expect(await prisma.subscription.findFirstOrThrow({ where: { userId } })).toMatchObject({ phase: "ABANDONED" });
    expect(await prisma.billingOperation.findUniqueOrThrow({ where: { id: operation.id } })).toMatchObject({ status: "NOT_APPLIED" });
    const closing = await prisma.subscriptionHistoryEntry.findFirst({ where: { subscription: { userId }, toValue: "ABANDONED" } });
    expect(closing).toMatchObject({ trigger: "ORPHAN_DISCOVERY", cause: "KIZUNIA_COMMAND" });

    // The user may start again, and exactly one new create is sent.
    expect((await startCheckout(userId)).status).toBe("CHECKOUT_READY");
    expect(fake.calls.filter((call) => call.method === "createSubscription")).toHaveLength(2);
  });

  it("does not close while the window is only partly scanned", async () => {
    const userId = await createBillingUser(PREFIX);
    fake.failNext("createSubscription", "TIMEOUT");
    await startCheckout(userId);
    for (let i = 0; i < 3; i += 1) fake.seed({ providerSubscriptionId: psubId() }, new Date(clock.getTime() + i * 1000));

    advance(30 * MINUTE);
    const result = await scan({ pageSize: 1, maxPagesPerRun: 1 });

    expect(result).toMatchObject({ stoppedBy: "MAX_PAGES", closed: 0 });
    expect(await prisma.subscription.findFirstOrThrow({ where: { userId } })).toMatchObject({ phase: "PROVISIONING" });
  });

  it("bounds a crashed create's send time by its lease when requestSentAt was never written", async () => {
    const userId = await createBillingUser(PREFIX);
    fake.failNext("createSubscription", "TIMEOUT"); // nothing created, then the process dies before tx B
    await expect(startCheckout(userId, crash)).rejects.toThrow("process died");
    const [operation] = await prisma.billingOperation.findMany({ where: { userId } });
    expect(operation.requestSentAt).toBeNull();

    advance(30 * MINUTE);
    const result = await scan();

    expect(result).toMatchObject({ operationsExpired: 1, closed: 1 });
    expect(await prisma.billingOperation.findUniqueOrThrow({ where: { id: operation.id } })).toMatchObject({ status: "NOT_APPLIED" });
  });
});

describe("orphan discovery — a supersession's create is a child (Phase VI)", () => {
  it("closes a child create the provider never made, once the window passes it", async () => {
    const userId = await createBillingUser(PREFIX);
    fake.failNext("createSubscription", "TIMEOUT");
    expect((await supersede(userId)).status).toBe("CONFIRMING");
    const create = await prisma.billingOperation.findFirstOrThrow({ where: { userId, kind: "CREATE_SUBSCRIPTION" } });
    expect(create.parentOperationId).not.toBeNull();

    advance(30 * MINUTE);
    expect(await scan()).toMatchObject({ closed: 1 });

    expect(await prisma.billingOperation.findUniqueOrThrow({ where: { id: create.id } })).toMatchObject({ status: "NOT_APPLIED" });
    expect(await prisma.subscription.findUniqueOrThrow({ where: { id: create.subscriptionId! } })).toMatchObject({ phase: "ABANDONED" });
  });

  it("binds a child create whose response was lost, through its own kz_op", async () => {
    const userId = await createBillingUser(PREFIX);
    fake.failNext("createSubscription", "TIMEOUT", { afterApplying: true });
    await supersede(userId);
    const create = await prisma.billingOperation.findFirstOrThrow({ where: { userId, kind: "CREATE_SUBSCRIPTION" } });

    advance(10 * MINUTE);
    await scan();

    expect(await prisma.billingOperation.findUniqueOrThrow({ where: { id: create.id } })).toMatchObject({ status: "SUCCEEDED" });
    expect(await prisma.subscription.findUniqueOrThrow({ where: { id: create.subscriptionId! } })).toMatchObject({ phase: "PENDING_AUTHENTICATION" });
  });
});
