/**
 * Internal Task Registry
 *
 * One scheduled trigger, many tasks, each with its own cadence.
 *
 * ## Why this exists
 *
 * `docs/architecture/workflows/internal-jobs.md` establishes the convention:
 * a `GET` route per job, authenticated by `CRON_SECRET`, registered in
 * `vercel.json`. That convention is sound and unchanged — every task here is
 * still individually invocable at its own route.
 *
 * What does not scale is the *registration*. Vercel's Hobby plan allows **two**
 * cron entries, triggered daily, and this project already uses both. A third
 * job cannot get a slot, and adding one would fail the deploy rather than fail
 * quietly.
 *
 * So the cron entry points at one tick endpoint, and this registry decides what
 * actually runs. One slot serves every scheduled task; each declares how often
 * it wants to run, and a durable marker row records when it last did.
 *
 * The result is that cadence becomes configuration. The same endpoint is
 * correct invoked daily on Hobby, every five minutes on Pro, or by an external
 * pinger — nothing structural changes between them.
 *
 * ## Why the marker is in the database
 *
 * Every invocation is a fresh process. There is nowhere else to put it that
 * survives, and two concurrent executions have to agree on what has already
 * run.
 */
import prisma from "@/lib/prisma";

export interface InternalTaskResult {
  readonly ran: boolean;
  readonly detail?: Record<string, unknown>;
}

export interface InternalTask {
  /** Stable identity. It is the primary key of the marker row. */
  readonly id: string;
  /**
   * The minimum gap between runs, in seconds.
   *
   * A floor, not a schedule: the task runs on the first tick after this has
   * elapsed. With a daily trigger, anything under a day means "every tick".
   */
  readonly minIntervalSeconds: number;
  readonly run: () => Promise<Record<string, unknown>>;
}

export interface TickSummary {
  readonly ran: readonly string[];
  readonly skipped: readonly string[];
  readonly failed: readonly { readonly id: string; readonly error: string }[];
  readonly details: Record<string, unknown>;
}

/**
 * Runs every task whose interval has elapsed.
 *
 * A failing task is recorded and skipped over, never allowed to abort the tick:
 * these tasks are unrelated to each other, and letting the first failure
 * prevent the rest from running would turn one broken job into a stalled
 * platform.
 */
export async function runDueTasks(
  tasks: readonly InternalTask[],
  now: Date,
): Promise<TickSummary> {
  const ran: string[] = [];
  const skipped: string[] = [];
  const failed: { id: string; error: string }[] = [];
  const details: Record<string, unknown> = {};

  for (const task of tasks) {
    const due = await claimTask(task, now);

    if (!due) {
      skipped.push(task.id);
      continue;
    }

    try {
      details[task.id] = await task.run();
      ran.push(task.id);
      await recordOutcome(task.id, now, "ok", null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ id: task.id, error: message });
      await recordOutcome(task.id, now, "failed", message);
    }
  }

  return { ran, skipped, failed, details };
}

/**
 * Marks a task as started if its interval has elapsed, and reports whether the
 * caller won it.
 *
 * The `updatedMany`-with-a-predicate shape is what makes this safe under
 * concurrency: two executions ticking at the same instant both attempt the
 * conditional update, and exactly one changes a row. The loser skips rather
 * than running the task a second time.
 *
 * This is a lighter guarantee than the work queue's lease — the tasks
 * themselves are idempotent, so a genuinely simultaneous double-run is
 * survivable — but it stops the ordinary case of two overlapping ticks doing
 * everything twice.
 */
async function claimTask(task: InternalTask, now: Date): Promise<boolean> {
  const threshold = new Date(now.getTime() - task.minIntervalSeconds * 1000);

  const created = await prisma.internalJobRun
    .create({
      data: { taskId: task.id, lastRunAt: now, lastStatus: "running", runCount: 1 },
    })
    .catch(() => null);

  // No row existed: this execution created it and therefore owns the run.
  if (created) return true;

  const claimed = await prisma.internalJobRun.updateMany({
    where: {
      taskId: task.id,
      OR: [{ lastRunAt: null }, { lastRunAt: { lte: threshold } }],
    },
    data: { lastRunAt: now, lastStatus: "running", runCount: { increment: 1 } },
  });

  return claimed.count > 0;
}

async function recordOutcome(
  taskId: string,
  now: Date,
  status: string,
  error: string | null,
): Promise<void> {
  await prisma.internalJobRun.update({
    where: { taskId },
    data: { lastRunAt: now, lastStatus: status, lastError: error?.slice(0, 2000) ?? null },
  });
}
