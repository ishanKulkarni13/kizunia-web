/**
 * Notifications — The Tick
 *
 * Business Layer
 *
 * One pass of everything this subsystem does on a timer: schedule the
 * evaluations that are due, drain the work queue, prune what has aged out.
 *
 * Responsibilities
 * ----------------
 * ✓ Compose the three passes, in the order that lets work finish in one tick
 * ✓ Report what happened
 *
 * Does NOT
 * ----------------
 * ✗ Know it was invoked by cron, by an admin, or by a test (principle 8)
 * ✗ Read a secret, parse a request, or return an HTTP response
 *
 * ## Why the order matters
 *
 * Schedule first, then drain. The scheduler enqueues evaluation jobs; the drain
 * runs them; running one enqueues a delivery job, which the *same* drain then
 * picks up because it loops until a claim comes back empty.
 *
 * So a single tick can carry a notification from "it is this user's turn" all
 * the way to a push. Draining first would leave everything scheduled this tick
 * waiting for the next one — a day, on a daily trigger.
 *
 * ## Two scheduling passes, one drain
 *
 * The per-user evaluations and the admin suggestion notices are discovered
 * separately, because they are looking at different things: one asks "whose
 * turn is it today?", the other "what has arrived in the review queue?". They
 * feed the same drain, and both are idempotent, so the split costs nothing and
 * keeps each query answering one question.
 *
 * A failure in either pass must not prevent the other from running or the drain
 * from happening — they are independent, and a broken recommendation sweep
 * silently suppressing operational notices would be a bad trade.
 */
import { JOB_CONFIG, RETENTION_CONFIG, SCHEDULE_CONFIG } from "../config/notification-config";
import { notificationJobHandlers } from "../jobs/handlers";
import { JobRunner } from "../jobs/job-runner";
import { workQueue } from "../jobs/postgres-work-queue";
import type { WorkQueue } from "../jobs/work-queue.port";
import { logNotificationEvent } from "../observability/log";
import { NotificationSchedulerService } from "./notification-scheduler.service";

export interface TickOptions {
  readonly now?: Date;
  readonly queue?: WorkQueue;
  /** Skip the scheduling pass — for a drain-only trigger. */
  readonly skipSchedule?: boolean;
  readonly budgetMs?: number;
}

export interface NotificationTickResult {
  readonly scheduled: { enqueued: number; duplicates: number };
  readonly adminNotices: { enqueued: number; duplicates: number };
  readonly drained: {
    claimed: number;
    completed: number;
    failed: number;
    hasMore: boolean;
  };
  readonly pruned: number;
}

export class NotificationTickService {
  static async run(options: TickOptions = {}): Promise<NotificationTickResult> {
    const now = options.now ?? new Date();
    const queue = options.queue ?? workQueue;

    // Whether the scheduling pass produces anything is decided by the
    // occurrence key, not by this call: running the tick ten times in one day
    // schedules one evaluation per user, because the other nine collide on the
    // dedupe key and are absorbed (ND-D-06). That is what makes the tick safe
    // at any cadence, from daily to every few minutes.
    const scheduled = options.skipSchedule
      ? { enqueued: 0, duplicates: 0 }
      : await this.safely("due-evaluations", () =>
          NotificationSchedulerService.scheduleDueEvaluations({
            queue,
            anchor: now,
          }),
        );

    // Independent of the pass above, and deliberately isolated from it: these
    // are operational notices about work sitting in a queue, and a failure in
    // the recommendation sweep is no reason for nobody to hear about them.
    const adminNotices =
      options.skipSchedule
        ? { enqueued: 0, duplicates: 0 }
        : await this.safely("admin-suggestion-notices", () =>
            NotificationSchedulerService.scheduleAdminSuggestionNotices({
              queue,
              anchor: now,
            }),
          );

    const drained = await JobRunner.run({
      queue,
      handlers: notificationJobHandlers,
      budgetMs: options.budgetMs ?? JOB_CONFIG.wallClockBudgetMs,
      now: () => new Date(),
    });

    // Last, and bounded. Pruning is housekeeping — it must never be the reason
    // a tick runs out of budget before delivering anything.
    const pruned = await queue.prune(
      new Date(now.getTime() - RETENTION_CONFIG.completedJobSeconds * 1000),
      RETENTION_CONFIG.pruneBatchSize,
    );

    const result: NotificationTickResult = {
      scheduled: {
        enqueued: scheduled.enqueued,
        duplicates: scheduled.duplicates,
      },
      adminNotices: {
        enqueued: adminNotices.enqueued,
        duplicates: adminNotices.duplicates,
      },
      drained: {
        claimed: drained.claimed,
        completed: drained.completed,
        failed: drained.failed,
        hasMore: drained.hasMore,
      },
      pruned,
    };

    logNotificationEvent("tick.complete", {
      adminNoticesEnqueued: result.adminNotices.enqueued,
      ...result.scheduled,
      ...result.drained,
      pruned,
      sweepIntervalSeconds: SCHEDULE_CONFIG.sweepIntervalSeconds,
    });

    return result;
  }

  /**
   * Runs a scheduling pass, reporting a failure rather than propagating it.
   *
   * The drain is the part that actually delivers, and it must run even when
   * discovery failed — there may be a backlog from the previous tick that a
   * broken query has nothing to do with. Returning zeroes keeps the summary
   * shape intact; the log line is what makes the failure visible.
   *
   * Deliberately narrow. This swallows an error from *discovery*, where the
   * consequence is a delayed notice that the next tick re-finds. It is not a
   * pattern to extend to the queue, where swallowing an error would lose work.
   */
  private static async safely(
    pass: string,
    run: () => Promise<{ enqueued: number; duplicates: number }>,
  ): Promise<{ enqueued: number; duplicates: number }> {
    try {
      return await run();
    } catch (error) {
      logNotificationEvent("tick.schedule_pass_failed", {
        pass,
        error: error instanceof Error ? error.message : String(error),
      });

      return { enqueued: 0, duplicates: 0 };
    }
  }
}
