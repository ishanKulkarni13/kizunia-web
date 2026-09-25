/**
 * The tasks the scheduled tick dispatches, in the order it runs them.
 *
 * Kept out of `route.ts` because a route file may export only its handlers
 * and route config, and the order is something a test must pin: the tick runs
 * its tasks one after another inside one `maxDuration`, so whatever runs first
 * gets its budget and whatever runs last gets what is left.
 *
 * `billing:sync` runs FIRST, with its own 10 s soft budget (IB-10): a paying
 * customer's changed subscription must not wait behind a long notification
 * drain. The notification drain's default was lowered to 30 s to make room.
 * The worst case (billing 10 s + one provider timeout 10 s, notifications
 * 30 s, the three-day maintenance tasks, teardown) stays under 60 s. The values
 * are recorded in docs/architecture/workflows/internal-jobs.md.
 */
import type { InternalTask } from "@/lib/internal-jobs/registry";
import { PostgresRateLimitStore } from "@/lib/rate-limit/postgres.store";
import { assetReconciliationService } from "@/modules/assets/backend/reconciliation.service";
import { BillingSyncTask } from "@/modules/billing/backend/reconciliation/billing-sync.task";
import { OrphanDiscoveryTask } from "@/modules/billing/backend/reconciliation/orphan-discovery.task";
import { ORPHAN_CONFIG, SYNC_CONFIG } from "@/modules/billing/config/billing-config";
import { JOB_CONFIG, SCHEDULE_CONFIG } from "@/modules/notifications/config/notification-config";
import { NotificationTickService } from "@/modules/notifications/backend/notification-tick.service";

/** Three days, matching the cadence those jobs were registered with. */
const THREE_DAYS_SECONDS = 3 * 24 * 60 * 60;

export const TICK_TASKS: readonly InternalTask[] = [
  {
    id: "billing:sync",
    // Every tick. Due-based: a tick with nothing due costs two small queries.
    minIntervalSeconds: 60,
    run: () => new BillingSyncTask().run({ budgetMs: SYNC_CONFIG.wallClockMs }),
  },
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

  /*
   * LAST, at low frequency (IB-25 item 6). The IB-10 arithmetic leaves no room
   * for another provider-calling task before notifications, so the orphan scan
   * takes what remains. It is read-only and saves its cursor after every page,
   * so a run that `maxDuration` cuts short loses nothing and the next run
   * resumes where it stopped.
   */
  {
    id: "billing:orphan-discovery",
    minIntervalSeconds: ORPHAN_CONFIG.minIntervalSeconds,
    run: () => new OrphanDiscoveryTask().run({ budgetMs: ORPHAN_CONFIG.wallClockMs }),
  },
];
