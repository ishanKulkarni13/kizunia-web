/**
 * Verifies the durable work queue against a real Postgres database.
 *
 * These are the tests that cannot be faked. `FOR UPDATE SKIP LOCKED` is a
 * property of Postgres, not of this code — an in-memory double would happily
 * "pass" a concurrency test it cannot actually violate, and would prove
 * nothing about the thing that matters most in this subsystem.
 *
 * Requires a reachable test database — see docs/testing/database.md.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { NotificationJobKind } from "@/generated/prisma";
import prisma from "@/lib/prisma";

import { PostgresWorkQueue } from "./postgres-work-queue";

const PREFIX = "__vitest_work_queue_test__";

function unique(name: string): string {
  return `${PREFIX}-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

const queue = new PostgresWorkQueue();

/** Any valid payload; these tests never reach a handler. */
function payloadFor(userId: string) {
  return {
    userId,
    occurrenceKey: "top:2026-09-17",
    evaluatedAt: "2026-09-17T13:00:00.000Z",
  };
}

async function seedJob(options: {
  dedupeKey: string;
  runAt?: Date;
  maxAttempts?: number;
}) {
  return queue.enqueue({
    kind: NotificationJobKind.EVALUATE_TOP_RELEVANT_COMPETITION,
    dedupeKey: options.dedupeKey,
    runAt: options.runAt ?? new Date(Date.now() - 1000),
    maxAttempts: options.maxAttempts ?? 3,
    payload: payloadFor("user-1"),
  });
}

/**
 * Claims, then picks out the job this test cares about.
 *
 * `claim` is global by nature: it takes whatever is due across the whole table,
 * oldest first. Taking index 0 would silently assert against another file's
 * leftover row — which fails in a way that points at the wrong code entirely.
 */
async function claimOwn(dedupeKey: string, options: { owner?: string; leaseSeconds?: number; now?: Date } = {}) {
  const batch = await queue.claim({
    now: options.now ?? new Date(),
    limit: 50,
    leaseSeconds: options.leaseSeconds ?? 60,
    owner: options.owner ?? "owner-a",
  });

  return batch.find((job) => job.dedupeKey === dedupeKey);
}

/**
 * Claiming is global, so a test asserting anything about *which* jobs come back
 * needs the queue empty when it starts. Leftovers from an earlier test in this
 * file are older, and would crowd out the rows the current test just created.
 */
afterEach(async () => {
  await prisma.notificationJob.deleteMany({
    where: { dedupeKey: { startsWith: PREFIX } },
  });
});

afterAll(async () => {
  await prisma.notificationJob.deleteMany({
    where: { dedupeKey: { startsWith: PREFIX } },
  });
  await prisma.$disconnect();
});

/**
 * A clean queue, before anything here runs.
 *
 * `claim` is a global operation, so these tests genuinely need the table empty
 * to assert anything about which jobs come back — a leftover row from an
 * earlier run is indistinguishable from one under test, and produces a failure
 * that points at the wrong code. Integration test files are serialised
 * (`fileParallelism: false`), so this cannot disturb another file's run.
 */
beforeAll(async () => {
  await prisma.notificationJob.deleteMany({});
});

describe("PostgresWorkQueue — enqueue", () => {
  it("treats a repeated dedupe key as already-scheduled, not as an error", async () => {
    // Failure case 3. A scheduler that runs twice for the same occasion must be
    // harmless, and the guarantee has to come from the constraint rather than
    // from a read-then-write check, which two concurrent schedulers would both
    // pass.
    const dedupeKey = unique("duplicate");

    const first = await seedJob({ dedupeKey });
    const second = await seedJob({ dedupeKey });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);

    const count = await prisma.notificationJob.count({ where: { dedupeKey } });
    expect(count).toBe(1);
  });

  it("counts duplicates in a bulk enqueue instead of failing the batch", async () => {
    const shared = unique("bulk-shared");
    const fresh = unique("bulk-fresh");

    await seedJob({ dedupeKey: shared });

    const result = await queue.enqueueMany([
      {
        kind: NotificationJobKind.EVALUATE_TOP_RELEVANT_COMPETITION,
        dedupeKey: shared,
        runAt: new Date(),
        maxAttempts: 3,
        payload: payloadFor("user-1"),
      },
      {
        kind: NotificationJobKind.EVALUATE_TOP_RELEVANT_COMPETITION,
        dedupeKey: fresh,
        runAt: new Date(),
        maxAttempts: 3,
        payload: payloadFor("user-2"),
      },
    ]);

    // One pre-existing user in a 2,000-user re-run must not abort the other
    // 1,999.
    expect(result).toEqual({ created: 1, duplicates: 1 });
  });
});

describe("PostgresWorkQueue — claim", () => {
  it("does not claim a job whose run time is still in the future", async () => {
    const dedupeKey = unique("future");
    await seedJob({ dedupeKey, runAt: new Date(Date.now() + 60_000) });

    const claimed = await queue.claim({
      now: new Date(),
      limit: 10,
      leaseSeconds: 60,
      owner: "owner-a",
    });

    expect(claimed.map((job) => job.dedupeKey)).not.toContain(dedupeKey);
  });

  it("consumes an attempt at claim time, not at completion", async () => {
    // The load-bearing detail behind failure case 1. If attempts were charged
    // on completion, a worker that dies mid-job would never burn one, and the
    // job would be re-claimed forever after every lease expiry.
    const dedupeKey = unique("attempt-on-claim");
    await seedJob({ dedupeKey });

    const claimed = await claimOwn(dedupeKey);

    expect(claimed?.attempts).toBe(1);

    const row = await prisma.notificationJob.findUniqueOrThrow({
      where: { dedupeKey },
    });
    expect(row.attempts).toBe(1);
    expect(row.status).toBe("PROCESSING");
    expect(row.leaseOwner).toBe("owner-a");
  });

  it("re-claims a job whose lease expired, so a crashed worker loses nothing", async () => {
    // Failure case 1. No operator, no recovery sweep, no dead-letter dance —
    // the lease lapsing is the entire mechanism.
    const dedupeKey = unique("expired-lease");
    await seedJob({ dedupeKey, maxAttempts: 3 });

    const claimedAt = new Date();
    await queue.claim({
      now: claimedAt,
      limit: 10,
      leaseSeconds: 30,
      owner: "worker-that-dies",
    });

    // The worker never completes or fails the job: it simply vanishes.
    const afterLease = new Date(claimedAt.getTime() + 31_000);

    const reclaimed = await queue.claim({
      now: afterLease,
      limit: 10,
      leaseSeconds: 30,
      owner: "worker-that-survives",
    });

    const job = reclaimed.find((candidate) => candidate.dedupeKey === dedupeKey);

    expect(job).toBeDefined();
    expect(job?.attempts).toBe(2);

    const row = await prisma.notificationJob.findUniqueOrThrow({
      where: { dedupeKey },
    });
    expect(row.leaseOwner).toBe("worker-that-survives");
  });

  it("never hands one job to two concurrent claimers", async () => {
    // Failure case 2, and the reason these tests run against real Postgres:
    // this asserts a property of SKIP LOCKED, which no in-memory double can
    // meaningfully fail.
    const keys = await Promise.all(
      Array.from({ length: 10 }, (_, index) => {
        const dedupeKey = unique(`concurrent-${index}`);
        return seedJob({ dedupeKey }).then(() => dedupeKey);
      }),
    );

    const now = new Date();
    const [batchA, batchB] = await Promise.all([
      queue.claim({ now, limit: 10, leaseSeconds: 60, owner: "owner-a" }),
      queue.claim({ now, limit: 10, leaseSeconds: 60, owner: "owner-b" }),
    ]);

    const idsA = new Set(
      batchA.filter((j) => keys.includes(j.dedupeKey)).map((j) => j.id),
    );
    const idsB = new Set(
      batchB.filter((j) => keys.includes(j.dedupeKey)).map((j) => j.id),
    );

    const overlap = [...idsA].filter((id) => idsB.has(id));

    expect(overlap).toEqual([]);
    expect(idsA.size + idsB.size).toBe(keys.length);
  });

  it("respects the batch limit", async () => {
    const keys = await Promise.all(
      Array.from({ length: 5 }, (_, index) => {
        const dedupeKey = unique(`limit-${index}`);
        return seedJob({ dedupeKey }).then(() => dedupeKey);
      }),
    );

    const claimed = await queue.claim({
      now: new Date(),
      limit: 2,
      leaseSeconds: 60,
      owner: "owner-a",
    });

    expect(claimed.length).toBeLessThanOrEqual(2);
    expect(keys.length).toBe(5);
  });

  it("stops offering a job once its attempts are spent", async () => {
    const dedupeKey = unique("exhausted");
    await seedJob({ dedupeKey, maxAttempts: 1 });

    const now = new Date();
    await queue.claim({ now, limit: 10, leaseSeconds: 1, owner: "owner-a" });

    const later = new Date(now.getTime() + 5_000);
    const second = await queue.claim({
      now: later,
      limit: 10,
      leaseSeconds: 1,
      owner: "owner-b",
    });

    expect(second.map((job) => job.dedupeKey)).not.toContain(dedupeKey);
  });
});

describe("PostgresWorkQueue — outcomes", () => {
  it("returns a failed job to the queue at its retry time", async () => {
    const dedupeKey = unique("retry");
    await seedJob({ dedupeKey });

    const claimed = await claimOwn(dedupeKey);

    const retryAt = new Date(Date.now() + 120_000);
    await queue.fail({
      jobId: claimed!.id,
      now: new Date(),
      error: "transient database error",
      retryAt,
    });

    const row = await prisma.notificationJob.findUniqueOrThrow({
      where: { dedupeKey },
    });

    expect(row.status).toBe("PENDING");
    expect(row.runAt.getTime()).toBe(retryAt.getTime());
    expect(row.lastError).toContain("transient");
    // The lease must be released, or the row would look claimed while sitting
    // in a retry wait.
    expect(row.leaseOwner).toBeNull();
    expect(row.completedAt).toBeNull();
  });

  it("marks a terminal failure finished so it is prunable", async () => {
    const dedupeKey = unique("terminal");
    await seedJob({ dedupeKey });

    const claimed = await claimOwn(dedupeKey);

    await queue.fail({
      jobId: claimed!.id,
      now: new Date(),
      error: "payload will never validate",
      retryAt: null,
    });

    const row = await prisma.notificationJob.findUniqueOrThrow({
      where: { dedupeKey },
    });

    expect(row.status).toBe("FAILED");
    expect(row.completedAt).not.toBeNull();
  });

  it("truncates an enormous error rather than storing it whole", async () => {
    const dedupeKey = unique("huge-error");
    await seedJob({ dedupeKey });

    const claimed = await claimOwn(dedupeKey);

    await queue.fail({
      jobId: claimed!.id,
      now: new Date(),
      error: "x".repeat(10_000),
      retryAt: null,
    });

    const row = await prisma.notificationJob.findUniqueOrThrow({
      where: { dedupeKey },
    });

    expect(row.lastError?.length).toBeLessThanOrEqual(2000);
  });

  it("re-arms a continuing job without charging it an attempt", async () => {
    // How work larger than one execution makes progress. It cannot enqueue a
    // successor — the successor would carry the same dedupe key as the row
    // creating it — so it advances its own payload instead.
    const dedupeKey = unique("reschedule");
    await seedJob({ dedupeKey, maxAttempts: 2 });

    const claimed = await claimOwn(dedupeKey);

    await queue.reschedule({
      jobId: claimed!.id,
      now: new Date(),
      runAt: new Date(Date.now() - 1000),
      payload: { ...payloadFor("user-1"), occurrenceKey: "top:continued" },
    });

    const row = await prisma.notificationJob.findUniqueOrThrow({
      where: { dedupeKey },
    });

    expect(row.status).toBe("PENDING");
    expect(row.attempts).toBe(1);
    expect(row.leaseOwner).toBeNull();
    expect((row.payload as { occurrenceKey: string }).occurrenceKey).toBe(
      "top:continued",
    );

    // And it is immediately claimable again, which is what makes fan-out
    // continue rather than stall.
    const again = await queue.claim({
      now: new Date(),
      limit: 10,
      leaseSeconds: 60,
      owner: "owner-b",
    });
    expect(again.map((job) => job.dedupeKey)).toContain(dedupeKey);
  });

  it("clears the error when a retried job finally succeeds", async () => {
    const dedupeKey = unique("recovers");
    await seedJob({ dedupeKey });

    const claimed = await claimOwn(dedupeKey);

    await queue.fail({
      jobId: claimed!.id,
      now: new Date(),
      error: "temporary",
      retryAt: new Date(Date.now() - 1000),
    });

    const retried = await claimOwn(dedupeKey, { owner: "owner-b" });
    await queue.complete(retried!.id, new Date());

    const row = await prisma.notificationJob.findUniqueOrThrow({
      where: { dedupeKey },
    });

    expect(row.status).toBe("COMPLETED");
    // A stale error on a succeeded job would send whoever reads this table
    // chasing a problem that resolved itself.
    expect(row.lastError).toBeNull();
  });
});

describe("PostgresWorkQueue — reaping and pruning", () => {
  it("retires a job whose lease expired with no attempts left", async () => {
    // Without this the row is invisible to `claim` but still reads PROCESSING —
    // alive in the table, dead in practice, and misleading to anyone looking.
    const dedupeKey = unique("reap");
    await seedJob({ dedupeKey, maxAttempts: 1 });

    const now = new Date();
    await queue.claim({ now, limit: 10, leaseSeconds: 10, owner: "owner-a" });

    const reaped = await queue.reapExpired(new Date(now.getTime() + 20_000));
    expect(reaped).toBeGreaterThanOrEqual(1);

    const row = await prisma.notificationJob.findUniqueOrThrow({
      where: { dedupeKey },
    });
    expect(row.status).toBe("FAILED");
    expect(row.completedAt).not.toBeNull();
  });

  it("leaves a job with attempts remaining alone", async () => {
    const dedupeKey = unique("not-reaped");
    await seedJob({ dedupeKey, maxAttempts: 5 });

    const now = new Date();
    await queue.claim({ now, limit: 10, leaseSeconds: 10, owner: "owner-a" });

    await queue.reapExpired(new Date(now.getTime() + 20_000));

    const row = await prisma.notificationJob.findUniqueOrThrow({
      where: { dedupeKey },
    });
    // Reaping this would discard retries the caller is entitled to.
    expect(row.status).toBe("PROCESSING");
  });

  it("prunes only finished jobs older than the horizon", async () => {
    const oldKey = unique("prune-old");
    const recentKey = unique("prune-recent");
    const pendingKey = unique("prune-pending");

    await seedJob({ dedupeKey: oldKey });
    await seedJob({ dedupeKey: recentKey });
    await seedJob({ dedupeKey: pendingKey });

    const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await prisma.notificationJob.update({
      where: { dedupeKey: oldKey },
      data: { status: "COMPLETED", completedAt: longAgo },
    });
    await prisma.notificationJob.update({
      where: { dedupeKey: recentKey },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    await queue.prune(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), 500);

    expect(
      await prisma.notificationJob.count({ where: { dedupeKey: oldKey } }),
    ).toBe(0);
    expect(
      await prisma.notificationJob.count({ where: { dedupeKey: recentKey } }),
    ).toBe(1);
    // Unfinished work is never pruned, however old it is.
    expect(
      await prisma.notificationJob.count({ where: { dedupeKey: pendingKey } }),
    ).toBe(1);
  });
});
