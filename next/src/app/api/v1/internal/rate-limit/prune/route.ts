/**
 * Internal rate-limit counter cleanup trigger.
 *
 * The store already prunes opportunistically on a small fraction of normal
 * increments (see `PostgresRateLimitStore`), which is what keeps the
 * `rate_limit` table bounded without this route ever running under normal
 * traffic. This route is the backstop for low-traffic windows where the
 * opportunistic sweep does not fire often enough to keep up.
 *
 * Wired to Vercel's native Cron Jobs (see the `crons` entry in
 * vercel.json), which invoke a `GET` request and — when a `CRON_SECRET`
 * environment variable is configured — send it as `Authorization: Bearer
 * <CRON_SECRET>`. That is the mechanism this route checks. It is not the
 * same shared-secret convention as `/api/v1/internal/assets/reconcile`
 * (a `POST` with an `x-internal-secret` header, for an external scheduler
 * outside Vercel's own cron feature) — this repo had no route actually
 * wired to Vercel's cron feature before this one, so there was no existing
 * *working* convention to match; this follows Vercel's own documented one
 * instead. Fails closed (401) if the secret is unset or does not match.
 */

import { NextRequest, NextResponse } from "next/server";

import { PostgresRateLimitStore } from "@/lib/rate-limit/postgres.store";
import { secretEquals } from "@/lib/security/timing-safe-equal";

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

  const pruned = await new PostgresRateLimitStore().prune();

  return NextResponse.json({ success: true, data: { pruned } });
}
