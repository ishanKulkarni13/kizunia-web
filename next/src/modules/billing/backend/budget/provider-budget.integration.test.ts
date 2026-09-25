/**
 * The outbound request budget against real Postgres.
 *
 * The claim that matters cannot be proven with an in-memory store: acquisition
 * is one atomic `INSERT ... ON CONFLICT DO UPDATE ... WHERE count < ceiling`,
 * so many concurrent callers are admitted exactly up to the ceiling. These
 * tests race real connections for it, and check the headroom rule across
 * priorities on the same shared counter.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import prisma from "@/lib/prisma";
import { resetLogSink, setLogSink, type LogRecord } from "@/lib/logger";
import { PostgresRateLimitStore } from "@/lib/rate-limit/postgres.store";

import { ProviderPriority } from "../../provider/types";
import { ProviderBudget } from "./provider-budget";

const SCOPE = "razorpay-outbound:";

// ceilings: P1 = 10, P2 = 7, P3 = 4, P4 = 2
const settings = {
  windowSeconds: 60,
  limit: 10,
  headroomForPriority1: 3,
  headroomForPriority2: 3,
  orphanCeiling: 2,
} as const;

// A window far from any real one, so a running dev server cannot collide.
const WINDOW_START = new Date("2031-03-01T00:00:00.000Z");
const inWindow = (seconds: number) => new Date(WINDOW_START.getTime() + seconds * 1000);

function budget(mode: "TEST" | "LIVE" = "TEST", now: Date = inWindow(30)) {
  return new ProviderBudget(mode, { store: new PostgresRateLimitStore(), settings, now: () => now });
}

async function cleanup() {
  await prisma.rateLimit.deleteMany({ where: { key: { startsWith: SCOPE } } });
}

let records: LogRecord[];

beforeEach(async () => {
  await cleanup();
  records = [];
  setLogSink((record) => {
    records.push(record);
  });
});
afterEach(async () => {
  resetLogSink();
  await cleanup();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("ProviderBudget — atomic acquisition", () => {
  it("admits exactly the ceiling when many callers race for it", async () => {
    const results = await Promise.all(
      Array.from({ length: 40 }, () => budget().acquire(ProviderPriority.COMMAND)),
    );

    expect(results.filter(Boolean)).toHaveLength(10);
    expect(results.filter((admitted) => !admitted)).toHaveLength(30);
  });

  it("holds the same limit across separate budget instances, as separate app instances would", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => budget("TEST").acquire(ProviderPriority.COMMAND).then((ok) => [i, ok])),
    );

    expect(results.filter(([, ok]) => ok)).toHaveLength(10);
  });
});

describe("ProviderBudget — headroom across priorities on one counter", () => {
  it("refuses a lower priority while a higher one still has room", async () => {
    const admitted = async (priority: ProviderPriority, times: number) => {
      const outcomes: boolean[] = [];

      for (let i = 0; i < times; i += 1) outcomes.push(await budget().acquire(priority));

      return outcomes;
    };

    // Reconciliation (P3) may use 4 of the 10 units.
    expect(await admitted(ProviderPriority.RECONCILIATION, 5)).toEqual([true, true, true, true, false]);

    // Orphan discovery (P4) only runs while the window is quiet: it is already shut out.
    expect(await admitted(ProviderPriority.ORPHAN_DISCOVERY, 1)).toEqual([false]);

    // Checkout confirmation and webhooks (P2) can go on to 7.
    expect(await admitted(ProviderPriority.CONFIRMATION, 4)).toEqual([true, true, true, false]);

    // Commands (P1) keep the last 3, so a backlog can never crowd out a waiting customer.
    expect(await admitted(ProviderPriority.COMMAND, 4)).toEqual([true, true, true, false]);
  });

  it("never lets background work take what commands are entitled to, under concurrency", async () => {
    const attempts = [
      ...Array.from({ length: 20 }, () => ({ priority: ProviderPriority.RECONCILIATION })),
      ...Array.from({ length: 20 }, () => ({ priority: ProviderPriority.COMMAND })),
    ];

    const results = await Promise.all(
      attempts.map(async ({ priority }) => ({ priority, ok: await budget().acquire(priority) })),
    );

    const admitted = results.filter((result) => result.ok);
    const reconciliation = admitted.filter((result) => result.priority === ProviderPriority.RECONCILIATION);

    // Ten units in all; reconciliation held to its ceiling however the race fell.
    expect(admitted).toHaveLength(10);
    expect(reconciliation.length).toBeLessThanOrEqual(4);
  });

  it("gives orphan discovery a slot only while the window is nearly empty", async () => {
    expect(await budget().acquire(ProviderPriority.ORPHAN_DISCOVERY)).toBe(true);
    expect(await budget().acquire(ProviderPriority.ORPHAN_DISCOVERY)).toBe(true);
    expect(await budget().acquire(ProviderPriority.ORPHAN_DISCOVERY)).toBe(false);
  });
});

describe("ProviderBudget — windows and modes", () => {
  it("starts a fresh counter in the next window", async () => {
    for (let i = 0; i < 10; i += 1) await budget("TEST", inWindow(5)).acquire(ProviderPriority.COMMAND);

    expect(await budget("TEST", inWindow(59)).acquire(ProviderPriority.COMMAND)).toBe(false);
    expect(await budget("TEST", inWindow(60)).acquire(ProviderPriority.COMMAND)).toBe(true);
  });

  it("keeps TEST and LIVE budgets apart", async () => {
    for (let i = 0; i < 10; i += 1) await budget("TEST").acquire(ProviderPriority.COMMAND);

    expect(await budget("TEST").acquire(ProviderPriority.COMMAND)).toBe(false);
    expect(await budget("LIVE").acquire(ProviderPriority.COMMAND)).toBe(true);
  });

  it("keys the counter by scope, mode and window start, so the row expires with its window", async () => {
    await budget("TEST", inWindow(30)).acquire(ProviderPriority.COMMAND);

    const row = await prisma.rateLimit.findUnique({
      where: { key: `razorpay-outbound:TEST:${WINDOW_START.getTime()}` },
    });

    expect(row?.count).toBe(1);
    expect(row?.expiresAt.getTime()).toBe(WINDOW_START.getTime() + 60_000);
  });
});

describe("ProviderBudget — observability", () => {
  it("logs an acquisition with its ceiling and count, and a refusal with its ceiling", async () => {
    await budget().acquire(ProviderPriority.CONFIRMATION);
    for (let i = 0; i < 6; i += 1) await budget().acquire(ProviderPriority.CONFIRMATION);
    await budget().acquire(ProviderPriority.CONFIRMATION);

    const acquired = records.filter((record) => record.event === "budget.acquired");
    const refused = records.filter((record) => record.event === "budget.refused");

    expect(acquired).toHaveLength(7);
    expect(acquired[0].fields).toMatchObject({ mode: "TEST", priority: 2, ceiling: 7, count: 1 });
    expect(refused).toHaveLength(1);
    expect(refused[0].fields).toMatchObject({ mode: "TEST", priority: 2, ceiling: 7, reason: "CEILING" });
  });
});
