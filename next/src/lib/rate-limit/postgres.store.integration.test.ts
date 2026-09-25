/**
 * Integration tests against a real Postgres database — same expectation as
 * this repo's existing `scripts/verify-*.ts` scripts, which already run
 * against the local dev database rather than a mock. There is no DB test
 * harness in this repository (see the audit); this uses the same
 * `DATABASE_URL` those scripts use and cleans up everything it writes.
 *
 * Requires a reachable database. If `DATABASE_URL` does not point at one,
 * these tests fail loudly rather than silently skipping — the same
 * trade-off the existing verify scripts already make.
 */
import { afterAll, describe, expect, it } from "vitest";

import prisma from "@/lib/prisma";

import { PostgresRateLimitStore } from "./postgres.store";

const TEST_KEY_PREFIX = "__vitest_rate_limit_test__";

function testKey(name: string): string {
  return `${TEST_KEY_PREFIX}:${name}:${Date.now()}:${Math.random()}`;
}

afterAll(async () => {
  await prisma.rateLimit.deleteMany({
    where: { key: { startsWith: TEST_KEY_PREFIX } },
  });
  await prisma.$disconnect();
});

describe("PostgresRateLimitStore.increment", () => {
  it("starts a new key at count 1", async () => {
    const store = new PostgresRateLimitStore();
    const key = testKey("fresh");

    const result = await store.increment(key, new Date(Date.now() + 60_000));

    expect(result.count).toBe(1);
  });

  it("increments an existing key atomically (no lost updates under concurrency)", async () => {
    const store = new PostgresRateLimitStore();
    const key = testKey("concurrent");
    const expiresAt = new Date(Date.now() + 60_000);

    // The real correctness claim: this goes through Postgres's
    // `INSERT ... ON CONFLICT DO UPDATE SET count = count + 1`, not a
    // read-then-write, so 25 concurrent increments against the same row
    // must produce exactly the counts 1..25 with none lost or duplicated —
    // the guarantee an in-memory store cannot prove on its own (see
    // service.test.ts's concurrency test for that half).
    const results = await Promise.all(
      Array.from({ length: 25 }, () => store.increment(key, expiresAt)),
    );

    const counts = results.map((r) => r.count).sort((a, b) => a - b);

    expect(counts).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });
});

describe("PostgresRateLimitStore.prune", () => {
  it("deletes expired rows and leaves live ones", async () => {
    const store = new PostgresRateLimitStore();
    const expiredKey = testKey("expired");
    const liveKey = testKey("live");

    await store.increment(expiredKey, new Date(Date.now() - 1_000));
    await store.increment(liveKey, new Date(Date.now() + 60_000));

    await store.prune();

    const [expiredRow, liveRow] = await Promise.all([
      prisma.rateLimit.findUnique({ where: { key: expiredKey } }),
      prisma.rateLimit.findUnique({ where: { key: liveKey } }),
    ]);

    expect(expiredRow).toBeNull();
    expect(liveRow).not.toBeNull();
  });
});

describe("PostgresRateLimitStore.incrementIfBelow", () => {
  it("admits exactly the ceiling under concurrency, however many callers race for it", async () => {
    const store = new PostgresRateLimitStore();
    const key = testKey("conditional-concurrent");
    const expiresAt = new Date(Date.now() + 60_000);

    // The real claim: one atomic `INSERT ... ON CONFLICT DO UPDATE ... WHERE
    // count < ceiling`. 25 callers race for 10 slots. A read-then-write would
    // over-admit here; this must admit exactly 10, with the counts 1..10 each
    // handed out once, and refuse the other 15.
    const results = await Promise.all(
      Array.from({ length: 25 }, () => store.incrementIfBelow(key, 10, expiresAt)),
    );

    const admitted = results.flatMap((result) => (result.acquired ? [result.count] : []));

    expect(admitted.sort((a, b) => a - b)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
    expect(results.filter((result) => !result.acquired)).toHaveLength(15);

    // Refusals never moved the counter past the ceiling.
    expect((await prisma.rateLimit.findUnique({ where: { key } }))?.count).toBe(10);
    expect(await store.incrementIfBelow(key, 10, expiresAt)).toEqual({ acquired: false });
  });

  it("honours a different ceiling on the same key without disturbing the count", async () => {
    const store = new PostgresRateLimitStore();
    const key = testKey("conditional-priority");
    const expiresAt = new Date(Date.now() + 60_000);

    // Priorities share one counter but have different ceilings: a lower
    // priority is refused while a higher one still has headroom.
    for (let i = 0; i < 3; i += 1) await store.incrementIfBelow(key, 3, expiresAt);

    expect(await store.incrementIfBelow(key, 3, expiresAt)).toEqual({ acquired: false });
    expect(await store.incrementIfBelow(key, 5, expiresAt)).toEqual({ acquired: true, count: 4 });
  });

  it("admits nothing and writes no row for a ceiling below 1", async () => {
    const store = new PostgresRateLimitStore();
    const key = testKey("conditional-zero");

    expect(await store.incrementIfBelow(key, 0, new Date(Date.now() + 60_000))).toEqual({ acquired: false });
    expect(await prisma.rateLimit.findUnique({ where: { key } })).toBeNull();
  });

  it("stores the expiry as the instant given, whatever the session time zone", async () => {
    const store = new PostgresRateLimitStore();
    const key = testKey("conditional-expiry");
    const expiresAt = new Date(Date.now() + 90_000);

    await store.incrementIfBelow(key, 1, expiresAt);

    const row = await prisma.rateLimit.findUnique({ where: { key } });

    expect(row?.expiresAt.getTime()).toBe(expiresAt.getTime());
  });
});
