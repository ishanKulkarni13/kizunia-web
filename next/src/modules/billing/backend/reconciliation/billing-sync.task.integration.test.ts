/**
 * The `billing:sync` task against real Postgres and the fake provider: its
 * skips, its stops (deadline, empty claim, no budget), the cooldown's effect on
 * each priority, lapsed operations, and the health alerts.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Prisma } from "@/generated/prisma";
import { resetLogSink, setLogSink, type LogRecord } from "@/lib/logger";
import prisma from "@/lib/prisma";
import {
  cleanupBillingUsers,
  createBillingUser,
  insertBoundSubscription,
  insertOperation,
} from "@/testing/billing-sync-fixtures";

import { createPlanCatalog } from "../../config/plan-catalog";
import { BudgetedProvider, type ProviderHealth, type ProviderVerdict } from "../../provider/budgeted-provider";
import { FakeBillingProvider } from "../../provider/fake-provider";
import { ProviderPriority, type BillingProvider } from "../../provider/types";
import { SyncService } from "../sync/sync.service";
import { BillingSyncTask } from "./billing-sync.task";

const PREFIX = "__vitest_billing_synctask__";
const T0 = new Date("2026-10-01T12:00:00.000Z");
const SEC = 1000;
const DAY = 24 * 60 * 60 * SEC;

const catalog = createPlanCatalog([{ providerPlanId: "plan_pro_m", plan: "PRO", cycle: "MONTHLY" }]);

let clock: Date;
let fake: FakeBillingProvider;
let records: LogRecord[];
const now = () => clock;

class StubHealth implements ProviderHealth {
  constructor(public verdictToReturn: ProviderVerdict = "CLEAR") {}
  async verdict() {
    return this.verdictToReturn;
  }
  async record() {}
}

class Gate {
  constructor(public allow = true) {}
  async acquire() {
    return this.allow;
  }
}

function task(options: { health?: StubHealth; gate?: Gate; mode?: "TEST" | "DISABLED" } = {}) {
  const health = options.health ?? new StubHealth();
  const gate = options.gate ?? new Gate();
  const providerFor = (priority: ProviderPriority): BillingProvider => new BudgetedProvider(fake, gate, health, priority);
  const sync = new SyncService({
    providerFor,
    resolvedMode: () => options.mode ?? "TEST",
    now,
    random: () => 0.5,
    catalog,
  });

  return {
    sync,
    providerFor,
    task: new BillingSyncTask({ sync, health: () => health, resolvedMode: () => options.mode ?? "TEST", now }),
  };
}

async function due(overrides: Partial<Prisma.SubscriptionUncheckedCreateInput> = {}) {
  const userId = await createBillingUser(PREFIX);
  const sub = await insertBoundSubscription(userId, { syncDueAt: new Date(T0.getTime() - SEC), ...overrides });
  fake.seed({ providerSubscriptionId: sub.providerSubscriptionId!, rawStatus: "active", providerPlanId: "plan_pro_m" });

  return { userId, sub };
}

const fetches = () => fake.calls.filter((call) => call.method === "fetchSubscription").length;
const alerts = () => records.filter((r) => r.event === "billing.alert").map((r) => r.fields.condition);

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

describe("BillingSyncTask", () => {
  it("reports skipped when billing is disabled, and touches nothing", async () => {
    await due();

    expect(await task({ mode: "DISABLED" }).task.run()).toEqual({ skipped: "disabled" });
    expect(fetches()).toBe(0);
  });

  it("drains what is due and reports counts, stopping on an empty claim", async () => {
    const a = await due({ phase: "PENDING_AUTHENTICATION" });
    await due();

    const result = await task().task.run({ budgetMs: 10_000 });

    expect(result).toMatchObject({ mode: "TEST", stoppedBy: "EMPTY", remainingDue: 0 });
    expect((result.applied as number) + (result.noChange as number)).toBeGreaterThanOrEqual(2);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: a.sub.id } })).phase).toBe("ACTIVE");
  });

  it("stops when there is no budget, leaving everything due", async () => {
    const { sub } = await due();

    const result = await task({ gate: new Gate(false) }).task.run();

    expect(result).toMatchObject({ stoppedBy: "NOT_ATTEMPTED", notAttempted: 1 });
    expect(fetches()).toBe(0);
    expect(await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).toMatchObject({
      syncDueAt: new Date(T0.getTime() - SEC),
      syncLeaseUntil: null,
      syncAttempts: 0,
    });
    expect(alerts()).toContain("BUDGET_EXHAUSTED");
  });

  it("stops at the deadline", async () => {
    await due();

    const result = await task().task.run({ budgetMs: 0 });

    expect(result).toMatchObject({ stoppedBy: "DEADLINE", claimed: 0 });
    expect(fetches()).toBe(0);
  });

  it("skips all provider work while cooling down, but a priority-1 admin sync still reaches the provider", async () => {
    const { sub } = await due();
    const health = new StubHealth("COOLING_DOWN");
    const { task: cooling, sync } = task({ health });

    expect(await cooling.run()).toMatchObject({ skipped: "cooldown", claimed: 0 });
    expect(fetches()).toBe(0);

    // The decorator refuses P2–P4 during a cooldown, and lets P1 try.
    expect((await sync.syncTargeted(sub.id, ProviderPriority.CONFIRMATION)).outcome).toBe("NOT_ATTEMPTED");
    expect((await sync.syncTargeted(sub.id, ProviderPriority.COMMAND)).outcome).toMatch(/APPLIED|NO_CHANGE/);
    expect(fetches()).toBe(1);
  });

  it("skips provider work when the key is pinned after an auth failure", async () => {
    await due();

    expect(await task({ health: new StubHealth("AUTH_PINNED") }).task.run()).toMatchObject({ skipped: "auth_pinned" });
    expect(fetches()).toBe(0);
  });

  it("turns a lapsed IN_FLIGHT operation into OUTCOME_UNKNOWN and marks its subscription due", async () => {
    const { userId, sub } = await due({ syncDueAt: null });
    const op = await insertOperation(userId, {
      subscriptionId: sub.id,
      status: "IN_FLIGHT",
      leaseUntil: new Date(T0.getTime() - SEC),
      requestSentAt: new Date(T0.getTime() - 10 * SEC),
    });

    const result = await task({ health: new StubHealth("AUTH_PINNED") }).task.run();

    expect(result).toMatchObject({ operationsExpired: 1 });
    expect((await prisma.billingOperation.findUniqueOrThrow({ where: { id: op.id } })).status).toBe("OUTCOME_UNKNOWN");
    expect(await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).toMatchObject({
      syncDueAt: T0,
      syncReason: "COMMAND_CONFIRM",
    });
  });

  it("raises SYNC_OVERDUE when the oldest due subscription has waited too long", async () => {
    await due({ syncDueAt: new Date(T0.getTime() - 3 * DAY) });

    await task({ health: new StubHealth("COOLING_DOWN") }).task.run();

    expect(alerts()).toContain("SYNC_OVERDUE");
  });

  it("raises WEBHOOK_SILENCE when synced subscriptions exist but no event has come for a week", async () => {
    await due({ syncDueAt: null, createdAt: new Date(T0.getTime() - 30 * DAY) });
    // Only this suite's events count in an otherwise empty table; others may exist, so push the clock past them.
    const latest = await prisma.billingEvent.findFirst({ where: { providerMode: "TEST" }, orderBy: { receivedAt: "desc" } });
    clock = new Date(Math.max(T0.getTime(), (latest?.receivedAt.getTime() ?? 0) + 8 * DAY));

    await task().task.run();

    expect(alerts()).toContain("WEBHOOK_SILENCE");
  });
});
