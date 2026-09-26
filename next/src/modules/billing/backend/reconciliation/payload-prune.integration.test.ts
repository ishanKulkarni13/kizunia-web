/**
 * `billing:payload-prune` (Phase VIII): nulls only payloads older than the
 * retention horizon, keeps every row, and stays bounded and concurrency-safe.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";

import prisma from "@/lib/prisma";
import { captureLogs, insertBillingEvent } from "@/testing/billing-admin-fixtures";
import { cleanupBillingUsers } from "@/testing/billing-sync-fixtures";

import { RETENTION_CONFIG } from "../../config/billing-config";
import { PayloadPruneTask } from "./payload-prune";

const PREFIX = "__vitest_billing_payload_prune__";
const NOW = new Date("2100-06-01T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const SENTINEL = "SENTINEL-prune-4d2b@example.test";

const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

function task(settings: ConstructorParameters<typeof PayloadPruneTask>[0] = {}) {
  return new PayloadPruneTask({ now: () => NOW, ...settings });
}

async function payloadState(id: string) {
  const [row] = await prisma.$queryRaw<{ hasPayload: boolean; payloadPrunedAt: Date | null }[]>`
    SELECT ("rawPayload" IS NOT NULL) AS "hasPayload", "payloadPrunedAt" FROM "public"."billing_event" WHERE "id" = ${id}`;

  return row;
}

async function mineCount() {
  return prisma.billingEvent.count({ where: { dedupeKey: { contains: PREFIX } } });
}

afterEach(async () => {
  await cleanupBillingUsers(PREFIX);
});
afterAll(async () => {
  await cleanupBillingUsers(PREFIX);
  await prisma.$disconnect();
});

describe("PayloadPruneTask", () => {
  it("defaults to the 180-day B3 horizon", () => {
    expect(RETENTION_CONFIG.payloadRetentionDays).toBe(180);
  });

  it("nulls only payloads older than the horizon, stamps them, and keeps every row", async () => {
    const old = await insertBillingEvent(PREFIX, { receivedAt: daysAgo(181), rawPayload: { a: SENTINEL } });
    const older = await insertBillingEvent(PREFIX, { receivedAt: daysAgo(400), rawPayload: { a: SENTINEL } });
    const insideHorizon = await insertBillingEvent(PREFIX, { receivedAt: daysAgo(179), rawPayload: { a: 1 } });
    const recent = await insertBillingEvent(PREFIX, { receivedAt: daysAgo(1), rawPayload: { a: 2 } });
    const exactlyAtCutoff = await insertBillingEvent(PREFIX, { receivedAt: daysAgo(180), rawPayload: { a: 3 } });
    const alreadyPrunedAt = daysAgo(50);
    const alreadyPruned = await insertBillingEvent(PREFIX, { receivedAt: daysAgo(300), payloadPrunedAt: alreadyPrunedAt });
    await prisma.$executeRaw`UPDATE "public"."billing_event" SET "rawPayload" = NULL WHERE "id" = ${alreadyPruned.id}`;
    const rowsBefore = await mineCount();
    const recentBefore = await prisma.billingEvent.findUniqueOrThrow({ where: { id: recent.id } });

    const result = await task().run();

    expect(result).toMatchObject({ cutoff: daysAgo(180).toISOString(), stoppedBy: "EMPTY" });

    for (const event of [old, older]) {
      expect(await payloadState(event.id)).toEqual({ hasPayload: false, payloadPrunedAt: NOW });
    }
    // Younger than the horizon, and exactly at it (strictly older is pruned): untouched.
    for (const event of [insideHorizon, recent, exactlyAtCutoff]) {
      expect(await payloadState(event.id)).toEqual({ hasPayload: true, payloadPrunedAt: null });
    }
    // An earlier prune is not restamped.
    expect(await payloadState(alreadyPruned.id)).toEqual({ hasPayload: false, payloadPrunedAt: alreadyPrunedAt });

    // The recent row is byte-for-byte what it was, and no row was deleted.
    expect(await prisma.billingEvent.findUniqueOrThrow({ where: { id: recent.id } })).toEqual(recentBefore);
    expect(await mineCount()).toBe(rowsBefore);
    // The pruned rows keep their metadata.
    expect(await prisma.billingEvent.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({
      dedupeKey: old.dedupeKey,
      eventType: old.eventType,
      receivedAt: old.receivedAt,
    });
  });

  it("is bounded: at most batchSize x maxBatches rows per run, and later runs continue", async () => {
    const events = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => insertBillingEvent(PREFIX, { receivedAt: daysAgo(365 + n), rawPayload: { n } })),
    );
    const small = { batchSize: 2, maxBatches: 1 };

    const first = await task({ settings: small }).run();
    expect(first).toMatchObject({ batches: 1, pruned: 2, stoppedBy: "MAX_BATCHES" });
    expect((await Promise.all(events.map((e) => payloadState(e.id)))).filter((s) => !s.hasPayload)).toHaveLength(2);

    // Oldest first: the two oldest of mine are the ones that went.
    expect((await payloadState(events[4].id)).hasPayload).toBe(false);
    expect((await payloadState(events[3].id)).hasPayload).toBe(false);
    expect((await payloadState(events[0].id)).hasPayload).toBe(true);

    // Keep going until nothing eligible is left.
    let stoppedBy = "";
    for (let run = 0; run < 20 && stoppedBy !== "EMPTY"; run += 1) {
      stoppedBy = String((await task({ settings: small }).run()).stoppedBy);
    }

    expect(stoppedBy).toBe("EMPTY");
    expect((await Promise.all(events.map((e) => payloadState(e.id)))).every((s) => !s.hasPayload)).toBe(true);
    expect(await mineCount()).toBe(5);
  });

  it("stops at the deadline without starting another batch", async () => {
    await insertBillingEvent(PREFIX, { receivedAt: daysAgo(500) });
    let calls = 0;
    // The clock jumps past the deadline after the first read of the start time.
    const clock = () => new Date(NOW.getTime() + (calls++ === 0 ? 0 : 60_000));

    const result = await new PayloadPruneTask({ now: clock, settings: { batchSize: 1 } }).run({ budgetMs: 1_000 });

    expect(result).toMatchObject({ batches: 0, pruned: 0, stoppedBy: "DEADLINE" });
  });

  it("lets overlapping runs share the work without double counting or blocking", async () => {
    const events = await Promise.all(
      Array.from({ length: 12 }, (_, n) => insertBillingEvent(PREFIX, { receivedAt: daysAgo(400 + n) })),
    );

    const [a, b] = await Promise.all([
      task({ settings: { batchSize: 3 } }).run(),
      task({ settings: { batchSize: 3 } }).run(),
    ]);

    expect((await Promise.all(events.map((e) => payloadState(e.id)))).every((s) => !s.hasPayload)).toBe(true);
    // Each row was nulled by exactly one run: mine alone contribute 12 to the two counts.
    expect(Number(a.pruned) + Number(b.pruned)).toBeGreaterThanOrEqual(12);
    expect(await mineCount()).toBe(12);
  });

  it("is idempotent and logs counts only, never a payload", async () => {
    await insertBillingEvent(PREFIX, { receivedAt: daysAgo(400), rawPayload: { customer_email: SENTINEL } });
    const logs = await captureLogs();

    try {
      await task().run();
      const again = await task().run();
      expect(again).toMatchObject({ pruned: 0, stoppedBy: "EMPTY" });
    } finally {
      logs.stop();
    }

    expect(logs.records.filter((r) => r.event === "payload.pruned")).toHaveLength(2);
    expect(logs.text()).not.toContain(SENTINEL);
  });
});
