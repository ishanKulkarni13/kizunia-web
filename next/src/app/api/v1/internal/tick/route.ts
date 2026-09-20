/**
 * The scheduled tick.
 *
 * Follows the repository's internal-job convention exactly — see
 * `docs/architecture/workflows/internal-jobs.md`: a `GET` route, authenticated
 * by `Authorization: Bearer <CRON_SECRET>` (the header Vercel's own cron
 * feature sends once `CRON_SECRET` is set), compared in constant time, failing
 * closed with a 401, wrapping its domain call in try/catch so the platform's
 * retry behaviour sees a real status.
 *
 * It differs from the existing internal routes in one respect, and only because
 * it has to: it dispatches a *registry* of tasks rather than one service.
 * Vercel's Hobby plan allows two cron entries at daily granularity, and this
 * project already uses both — so a third job cannot get a slot, and adding one
 * would fail the deploy. One endpoint, many tasks, each with its own cadence.
 *
 * Every task remains individually invocable at its own route. Nothing about the
 * existing convention is withdrawn.
 *
 * The domain services below have no idea this route, Vercel, or a cron schedule
 * exist. This file is the entire boundary between "something invoked this" and
 * "the work runs".
 *
 * Safe to invoke more than once, concurrently, or on a retry: scheduling is
 * idempotent on the occurrence key, claiming is exclusive, and every task is
 * guarded by its own last-run marker.
 */
import { NextRequest, NextResponse } from "next/server";

import { runDueTasks, type InternalTask } from "@/lib/internal-jobs/registry";
import { PostgresRateLimitStore } from "@/lib/rate-limit/postgres.store";
import { secretEquals } from "@/lib/security/timing-safe-equal";
import { assetReconciliationService } from "@/modules/assets/backend/reconciliation.service";
import { JOB_CONFIG, SCHEDULE_CONFIG } from "@/modules/notifications/config/notification-config";
import { NotificationTickService } from "@/modules/notifications/backend/notification-tick.service";

/** Three days, matching the cadence those jobs were registered with. */
const THREE_DAYS_SECONDS = 3 * 24 * 60 * 60;

/**
 * Without this, a `GET` handler can be statically evaluated at build time and
 * never actually run in production — which would look exactly like a cron that
 * silently does nothing.
 */
export const dynamic = "force-dynamic";

/**
 * Vercel's Hobby ceiling. Raise alongside `JOB_CONFIG.wallClockBudgetMs` on a
 * plan that allows longer executions; the budget must stay below this with room
 * for one more job plus teardown.
 */
export const maxDuration = 60;

const tasks: readonly InternalTask[] = [
  {
    id: "notifications:tick",
    // The subsystem's own cadence. The trigger may fire more often than this —
    // an external pinger, a manual run — and the marker is what keeps the
    // scheduling pass from running more often than intended.
    minIntervalSeconds: Math.min(SCHEDULE_CONFIG.sweepIntervalSeconds, 300),
    run: async () => {
      const result = await NotificationTickService.run({
        budgetMs: JOB_CONFIG.wallClockBudgetMs,
      });

      // Flattened, with the two discovery passes kept distinct: they enqueue
      // different work, and collapsing both into one `enqueued` would make a
      // silent failure in either invisible in the tick's own output.
      return {
        enqueued: result.scheduled.enqueued,
        duplicates: result.scheduled.duplicates,
        adminNoticesEnqueued: result.adminNotices.enqueued,
        adminNoticesDuplicates: result.adminNotices.duplicates,
        ...result.drained,
        pruned: result.pruned,
      };
    },
  },

  /*
   * The two pre-existing maintenance jobs, moved here from their own cron
   * entries so the project fits inside Hobby's two-slot limit.
   *
   * Nothing about them changes: same services, same three-day cadence, same
   * dedicated routes still available for a manual run. Only the trigger is
   * shared. Both are safety-net reconciliations whose writes are already
   * compare-and-set, so running them from a shared tick is no different from
   * running them from their own.
   */
  {
    id: "rate-limit:prune",
    minIntervalSeconds: THREE_DAYS_SECONDS,
    run: async () => ({ pruned: await new PostgresRateLimitStore().prune() }),
  },
  {
    id: "assets:reconcile",
    minIntervalSeconds: THREE_DAYS_SECONDS,
    run: async () => ({ ...(await assetReconciliationService.runAll()) }),
  },
];

export async function GET(request: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET;
  const providedAuthorization = request.headers.get("authorization");

  if (
    !expectedSecret ||
    !providedAuthorization ||
    !secretEquals(providedAuthorization, `Bearer ${expectedSecret}`)
  ) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized." } },
      { status: 401 },
    );
  }

  try {
    const summary = await runDueTasks(tasks, new Date());

    // A task that failed is reported in the body but does not fail the request.
    // The platform's retry keys off the status, and re-running the whole tick
    // to recover one task would redo the ones that succeeded — which is only
    // safe because they are idempotent, not because it is a good idea. Each
    // task's own retry state is the right recovery mechanism.
    return NextResponse.json({ success: true, data: summary });
  } catch (error) {
    console.error("Internal tick failed", error);

    return NextResponse.json(
      {
        success: false,
        error: { code: "TICK_FAILED", message: "Scheduled tick failed." },
      },
      { status: 500 },
    );
  }
}
