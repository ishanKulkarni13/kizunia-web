/**
 * Internal reconciliation trigger.
 *
 * Wired to Vercel's native Cron Jobs (see the `crons` entry in
 * vercel.json): a `GET` request, authenticated via `Authorization: Bearer
 * <CRON_SECRET>` — the header Vercel's own cron feature sends automatically
 * once a `CRON_SECRET` environment variable is configured. This is the one
 * standard convention for scheduled internal jobs in this repository going
 * forward — see docs/architecture/workflows/internal-jobs.md. (This route
 * previously used a separate `POST` + `x-internal-secret` convention that
 * nothing in this repository's own deployment configuration ever actually
 * scheduled; it has been migrated to the convention
 * `/api/v1/internal/rate-limit/prune` already used, so it can be registered
 * in `vercel.json` like that route.)
 *
 * Not a user-facing endpoint: it is not part of Kizunia's session-based
 * authorization model, so it is protected by this shared secret instead.
 * Fails closed (401) if `CRON_SECRET` is unset or does not match.
 *
 * The domain logic itself (`AssetReconciliationService`) has no idea this
 * route, Vercel, or a cron schedule even exist — this file is the entire
 * boundary between "something invoked this" and "the reconciliation runs."
 * Safe to invoke more than once, or concurrently with an admin-triggered
 * run: every underlying write is compare-and-set, scoped by the row's
 * expected current status.
 */

import { NextRequest, NextResponse } from "next/server";

import { secretEquals } from "@/lib/security/timing-safe-equal";
import { assetReconciliationService } from "@/modules/assets/backend/reconciliation.service";

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
    const summary = await assetReconciliationService.runAll();

    return NextResponse.json({ success: true, data: summary });
  } catch (error) {
    console.error("Asset reconciliation run failed", error);

    return NextResponse.json(
      {
        success: false,
        error: { code: "RECONCILIATION_FAILED", message: "Reconciliation run failed." },
      },
      { status: 500 },
    );
  }
}
