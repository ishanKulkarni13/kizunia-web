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
import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { runDueTasks } from "@/lib/internal-jobs/registry";
import { logger, runWithLogContext } from "@/lib/logger";
import { secretEquals } from "@/lib/security/timing-safe-equal";

import { TICK_TASKS } from "./tasks";

/**
 * Without this, a `GET` handler can be statically evaluated at build time and
 * never actually run in production — which would look exactly like a cron that
 * silently does nothing.
 */
export const dynamic = "force-dynamic";

/**
 * Vercel's Hobby ceiling. Raise alongside the task budgets in `./tasks.ts`
 * (`SYNC_CONFIG.wallClockMs`, `JOB_CONFIG.wallClockBudgetMs`) on a plan that
 * allows longer executions; together they must stay below this with room for
 * one more job plus teardown.
 */
export const maxDuration = 60;

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

  return runWithLogContext(randomUUID(), async () => {
    try {
      const summary = await runDueTasks(TICK_TASKS, new Date());

      // A task that failed is reported in the body but does not fail the request.
      // The platform's retry keys off the status, and re-running the whole tick
      // to recover one task would redo the ones that succeeded — which is only
      // safe because they are idempotent, not because it is a good idea. Each
      // task's own retry state is the right recovery mechanism.
      return NextResponse.json({ success: true, data: summary });
    } catch (error) {
      logger.error("internal_jobs.tick_failed", error);

      return NextResponse.json(
        {
          success: false,
          error: { code: "TICK_FAILED", message: "Scheduled tick failed." },
        },
        { status: 500 },
      );
    }
  });
}
