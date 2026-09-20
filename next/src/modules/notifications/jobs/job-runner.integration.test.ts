/**
 * Verifies the drain loop against a real queue: dispatch, fault isolation,
 * retry scheduling, permanent failure, and continuation.
 *
 * The handlers here are deliberately trivial — this file is about the loop's
 * behaviour around a handler, not about any handler's own logic.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { NotificationJobKind } from "@/generated/prisma";
import prisma from "@/lib/prisma";
import { NotFoundError } from "@/lib/errors";

import { completed, continued, type JobHandlerRegistry } from "./handler";
import { PermanentJobError } from "./job-error";
import { JobRunner } from "./job-runner";
import { PostgresWorkQueue } from "./postgres-work-queue";

const PREFIX = "__vitest_job_runner_test__";

function unique(name: string): string {
  return `${PREFIX}-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

const queue = new PostgresWorkQueue();

/** Deterministic, so asserted retry times are exact. */
const noJitter = () => 0;

function payload(userId = "user-1") {
  return {
    userId,
    occurrenceKey: "top:2026-09-17",
    evaluatedAt: "2026-09-17T13:00:00.000Z",
  };
}

/** A registry where only the discovery kind does anything interesting. */
function registryWith(
  handler: JobHandlerRegistry[typeof NotificationJobKind.EVALUATE_TOP_RELEVANT_COMPETITION],
): JobHandlerRegistry {
  const unreachable = async () => completed();

  return {
    EVALUATE_TOP_RELEVANT_COMPETITION: handler,
    EVALUATE_REGISTRATION_CLOSING: unreachable,
    FANOUT_ANNOUNCEMENT: unreachable,
    NOTIFY_ADMINS_OF_SUGGESTION: unreachable,
    DELIVER_NOTIFICATION: unreachable,
  };
}

async function seed(dedupeKey: string, maxAttempts = 3, body = payload()) {
  await queue.enqueue({
    kind: NotificationJobKind.EVALUATE_TOP_RELEVANT_COMPETITION,
    dedupeKey,
    runAt: new Date(Date.now() - 1000),
    maxAttempts,
    payload: body,
  });
}

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

describe("JobRunner", () => {
  it("runs a handler and completes the job", async () => {
    const dedupeKey = unique("happy");
    await seed(dedupeKey);

    const seen: string[] = [];
    const summary = await JobRunner.run({
      queue,
      handlers: registryWith(async ({ payload: p }) => {
        seen.push(p.userId);
        return completed();
      }),
      random: noJitter,
    });

    expect(seen).toEqual(["user-1"]);
    expect(summary.completed).toBe(1);

    const row = await prisma.notificationJob.findUniqueOrThrow({
      where: { dedupeKey },
    });
    expect(row.status).toBe("COMPLETED");
  });

  it("leaves a retryable failure pending, with a backed-off run time", async () => {
    // Failure case 4: the recommendation engine throwing must cost the job an
    // attempt and nothing else. Notably it must not be mistaken for a decision
    // that there was nothing to notify about.
    const dedupeKey = unique("engine-throws");
    await seed(dedupeKey, 3);

    const before = Date.now();
    const summary = await JobRunner.run({
      queue,
      handlers: registryWith(async () => {
        throw new Error("recommendation engine unavailable");
      }),
      random: noJitter,
    });

    expect(summary.retried).toBe(1);
    expect(summary.failed).toBe(0);

    const row = await prisma.notificationJob.findUniqueOrThrow({
      where: { dedupeKey },
    });

    expect(row.status).toBe("PENDING");
    expect(row.attempts).toBe(1);
    expect(row.lastError).toContain("recommendation engine unavailable");
    expect(row.runAt.getTime()).toBeGreaterThan(before);
  });

  it("gives up permanently once attempts are exhausted", async () => {
    const dedupeKey = unique("exhausts");
    await seed(dedupeKey, 1);

    const summary = await JobRunner.run({
      queue,
      handlers: registryWith(async () => {
        throw new Error("still broken");
      }),
      random: noJitter,
    });

    expect(summary.failed).toBe(1);

    const row = await prisma.notificationJob.findUniqueOrThrow({
      where: { dedupeKey },
    });
    expect(row.status).toBe("FAILED");

    // And is never offered again — a terminal job that kept being claimed
    // would spend the whole batch budget on work that cannot succeed.
    const second = await JobRunner.run({
      queue,
      handlers: registryWith(async () => completed()),
      random: noJitter,
    });
    expect(second.claimed).toBe(0);
  });

  it("does not retry a failure that cannot change its mind", async () => {
    const dedupeKey = unique("permanent");
    await seed(dedupeKey, 5);

    const summary = await JobRunner.run({
      queue,
      handlers: registryWith(async () => {
        throw new PermanentJobError("the announcement no longer exists");
      }),
      random: noJitter,
    });

    expect(summary.failed).toBe(1);

    const row = await prisma.notificationJob.findUniqueOrThrow({
      where: { dedupeKey },
    });
    // Four attempts still available, and deliberately not used.
    expect(row.status).toBe("FAILED");
    expect(row.attempts).toBe(1);
  });

  it("treats a missing resource as permanent, not as a transient blip", async () => {
    const dedupeKey = unique("not-found");
    await seed(dedupeKey, 5);

    await JobRunner.run({
      queue,
      handlers: registryWith(async () => {
        throw new NotFoundError({
          code: "COMPETITION_NOT_FOUND",
          message: "Competition not found.",
        });
      }),
      random: noJitter,
    });

    const row = await prisma.notificationJob.findUniqueOrThrow({
      where: { dedupeKey },
    });
    expect(row.status).toBe("FAILED");
  });

  it("fails a job whose payload does not match its kind, without retrying", async () => {
    const dedupeKey = unique("bad-payload");
    await queue.enqueue({
      kind: NotificationJobKind.EVALUATE_TOP_RELEVANT_COMPETITION,
      dedupeKey,
      runAt: new Date(Date.now() - 1000),
      maxAttempts: 5,
      payload: { nothing: "useful" },
    });

    let handlerRan = false;
    await JobRunner.run({
      queue,
      handlers: registryWith(async () => {
        handlerRan = true;
        return completed();
      }),
      random: noJitter,
    });

    // The handler is never reached: validation happens first, precisely so a
    // handler can trust its input.
    expect(handlerRan).toBe(false);

    const row = await prisma.notificationJob.findUniqueOrThrow({
      where: { dedupeKey },
    });
    expect(row.status).toBe("FAILED");
    expect(row.lastError).toContain("Invalid job payload");
  });

  it("keeps one job's failure from affecting the rest of the batch", async () => {
    // NFR-1, and the single most important property of this loop: at 2,000
    // users, one user's bad data must not cost the other 1,999 their
    // notifications.
    const failing = unique("isolated-failure");
    const healthyKeys = [unique("healthy-a"), unique("healthy-b")];

    await seed(failing, 3, payload("explodes"));
    for (const key of healthyKeys) await seed(key, 3, payload("fine"));

    const summary = await JobRunner.run({
      queue,
      handlers: registryWith(async ({ payload: p }) => {
        if (p.userId === "explodes") throw new Error("boom");
        return completed();
      }),
      random: noJitter,
    });

    expect(summary.completed).toBe(2);
    expect(summary.retried).toBe(1);

    for (const key of healthyKeys) {
      const row = await prisma.notificationJob.findUniqueOrThrow({
        where: { dedupeKey: key },
      });
      expect(row.status).toBe("COMPLETED");
    }
  });

  it("leaves a continuing job alone rather than completing it", async () => {
    const dedupeKey = unique("continues");
    await seed(dedupeKey, 3);

    let calls = 0;
    const summary = await JobRunner.run({
      queue,
      handlers: registryWith(async ({ job, queue: q, now }) => {
        calls += 1;
        if (calls === 1) {
          await q.reschedule({
            jobId: job.id,
            now,
            runAt: new Date(now.getTime() - 1000),
            payload: payload("page-2"),
          });
          return continued();
        }
        return completed();
      }),
      random: noJitter,
    });

    // The same drain pass picks the re-armed job straight back up, which is
    // what makes a large fan-out finish in one execution rather than one page
    // per tick.
    expect(calls).toBe(2);
    expect(summary.continued).toBe(1);
    expect(summary.completed).toBe(1);

    const row = await prisma.notificationJob.findUniqueOrThrow({
      where: { dedupeKey },
    });
    expect(row.status).toBe("COMPLETED");
  });

  it("reports that work remains when it runs out of time", async () => {
    const keys = [unique("budget-a"), unique("budget-b"), unique("budget-c")];
    for (const key of keys) await seed(key);

    const summary = await JobRunner.run({
      queue,
      handlers: registryWith(async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return completed();
      }),
      batchSize: 3,
      budgetMs: 10,
      random: noJitter,
    });

    // Stopping cleanly beats being killed mid-job by a platform timeout: the
    // lease would recover the work either way, but a kill wastes an attempt.
    expect(summary.hasMore).toBe(true);
    expect(summary.claimed).toBeLessThanOrEqual(3);
  });

  it("returns an empty summary when there is nothing due", async () => {
    const summary = await JobRunner.run({
      queue,
      handlers: registryWith(async () => completed()),
      random: noJitter,
    });

    expect(summary.claimed).toBe(0);
    expect(summary.hasMore).toBe(false);
  });
});
