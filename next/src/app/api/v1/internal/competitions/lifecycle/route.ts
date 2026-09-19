/**
 * Internal competition lifecycle sweep trigger.
 *
 * There is no scheduled-job infrastructure in this repository (see
 * `src/app/api/v1/internal/assets/reconcile/route.ts` and
 * `docs/architecture/domain/assets/security.md#orphan-and-cleanup-architecture`
 * for the precedent this follows). This route exists purely as the
 * invocation point an external scheduler calls once a day; the scheduling
 * mechanism itself is deliberately kept outside this codebase.
 *
 * Not a user-facing endpoint: it is not part of Kizunia's session-based
 * authorization model, so it is protected by a shared secret instead.
 * Requires the INTERNAL_LIFECYCLE_SECRET environment variable to be set;
 * fails closed (401) if it is missing or does not match. A separate secret
 * from `INTERNAL_RECONCILE_SECRET` so the two internal jobs' credentials can
 * be rotated independently.
 *
 * Runs the same canonical `CompetitionLifecycleService` (and, through it,
 * the same pure `resolveAutomaticStatus`) that the admin preview/apply
 * endpoints use — see that service for the idempotency and
 * automatic-eligibility guarantees this route relies on. Safe to invoke more
 * than once: a row already at its correct status is simply not re-written.
 *
 * IMPORTANT — before pointing a scheduler at this route in production, run
 * an unfiltered admin lifecycle preview (`/admin/competitions/lifecycle`)
 * and review every proposed change first. Every existing competition
 * defaults to `automaticStatusUpdatesDisabled = false`, so the first sweep
 * after this feature ships will recalculate the entire table — including
 * competitions whose status was previously set by hand.
 */

import { NextRequest, NextResponse } from "next/server";

import { CompetitionLifecycleService } from "@/modules/competitions/backend/lifecycle.service";

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.INTERNAL_LIFECYCLE_SECRET;

  const providedSecret = request.headers.get("x-internal-secret");

  if (!expectedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized." } },
      { status: 401 },
    );
  }

  const summary = await CompetitionLifecycleService.runAutomaticSweep();

  return NextResponse.json({ success: true, data: summary });
}
