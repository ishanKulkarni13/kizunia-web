/**
 * Runs the `billing:sync` task by hand: drain the subscriptions that are due,
 * resolve unmatched webhook events, and report counts.
 *
 * The same task the scheduled tick runs first (see `../../tick/tasks.ts`), but
 * without the tick's last-run marker, so it runs whenever it is called. Used
 * in TEST, where the Hobby plan's daily cron makes the tick a slow backstop
 * (IB-19), and by operators after an incident.
 *
 * Follows the internal-job convention exactly
 * (docs/architecture/workflows/internal-jobs.md): `GET`, `Authorization: Bearer
 * <CRON_SECRET>` compared in constant time, 401 when it is missing or wrong, a
 * real 500 when the run fails. Safe to call concurrently: claims are
 * exclusive, and the apply path discards a stale observation.
 */
import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { logger, runWithLogContext } from "@/lib/logger";
import { secretEquals } from "@/lib/security/timing-safe-equal";
import { BillingSyncTask } from "@/modules/billing/backend/reconciliation/billing-sync.task";
import { SYNC_CONFIG } from "@/modules/billing/config/billing-config";

export const dynamic = "force-dynamic";

/** Room for the drain's budget plus one provider timeout, well inside Vercel's limit. */
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
      const result = await new BillingSyncTask().run({ budgetMs: SYNC_CONFIG.wallClockMs });

      return NextResponse.json({ success: true, data: result });
    } catch (error) {
      logger.error("billing.sync_failed", error);

      return NextResponse.json(
        { success: false, error: { code: "BILLING_SYNC_FAILED", message: "Billing sync failed." } },
        { status: 500 },
      );
    }
  });
}
