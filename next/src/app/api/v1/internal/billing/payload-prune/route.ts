/**
 * Runs the `billing:payload-prune` task by hand: nulls webhook payloads older
 * than the retention horizon (180 days by default) in bounded batches. It never
 * deletes a row, and makes no provider call.
 *
 * The same task the scheduled tick runs daily (see `../../tick/tasks.ts`),
 * without the tick's last-run marker. For operators and TEST; every billing
 * task has a manual route, and re-running it is always safe (it only takes what
 * is still eligible).
 *
 * Follows the internal-job convention exactly
 * (docs/architecture/workflows/internal-jobs.md): `GET`, `Authorization: Bearer
 * <CRON_SECRET>` compared in constant time, 401 when it is missing or wrong, a
 * real 500 when the run fails. Safe to call concurrently: batches take
 * `FOR UPDATE SKIP LOCKED`, so overlapping runs never take the same rows.
 */
import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { logger, runWithLogContext } from "@/lib/logger";
import { secretEquals } from "@/lib/security/timing-safe-equal";
import { PayloadPruneTask } from "@/modules/billing/backend/reconciliation/payload-prune";

export const dynamic = "force-dynamic";

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
      const result = await new PayloadPruneTask().run();

      return NextResponse.json({ success: true, data: result });
    } catch (error) {
      logger.error("billing.payload_prune_failed", error);

      return NextResponse.json(
        { success: false, error: { code: "BILLING_PAYLOAD_PRUNE_FAILED", message: "Payload pruning failed." } },
        { status: 500 },
      );
    }
  });
}
