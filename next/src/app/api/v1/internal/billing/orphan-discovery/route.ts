/**
 * Runs the `billing:orphan-discovery` task by hand: one bounded, windowed scan
 * of the provider's subscriptions that binds lost creates through Kizunia's
 * notes and closes creates that provably never happened.
 *
 * The same task the scheduled tick runs last (see `../../tick/tasks.ts`), but
 * without the tick's last-run marker. Used in TEST, where the Hobby plan's
 * daily cron makes the tick a slow backstop (IB-19), and by operators.
 *
 * Follows the internal-job convention exactly
 * (docs/architecture/workflows/internal-jobs.md): `GET`, `Authorization: Bearer
 * <CRON_SECRET>` compared in constant time, 401 when it is missing or wrong, a
 * real 500 when the run fails. Safe to call concurrently: the cursor is
 * compare-and-set, and a losing run stops.
 */
import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { logger, runWithLogContext } from "@/lib/logger";
import { secretEquals } from "@/lib/security/timing-safe-equal";
import { OrphanDiscoveryTask } from "@/modules/billing/backend/reconciliation/orphan-discovery.task";
import { ORPHAN_CONFIG } from "@/modules/billing/config/billing-config";

export const dynamic = "force-dynamic";

/** Room for the scan's budget plus one provider timeout, well inside Vercel's limit. */
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
      const result = await new OrphanDiscoveryTask().run({ budgetMs: ORPHAN_CONFIG.wallClockMs });

      return NextResponse.json({ success: true, data: result });
    } catch (error) {
      logger.error("billing.orphan_discovery_failed", error);

      return NextResponse.json(
        { success: false, error: { code: "BILLING_ORPHAN_DISCOVERY_FAILED", message: "Orphan discovery failed." } },
        { status: 500 },
      );
    }
  });
}
