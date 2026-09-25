/**
 * Entitlements — Expected Billing Mode
 *
 * Which provider mode's subscriptions are *real* for this deployment. Only
 * subscriptions stamped with this mode contribute access (SB-EA-07): a `TEST`
 * subscription can never grant anything in a `LIVE`-expected deployment, and a
 * database copied between environments cannot make test payments grant
 * production access.
 *
 * This is deliberately independent of the payment credentials. The credentials
 * decide what Kizunia can *do* right now (they may be absent, which is the
 * supported `disabled` state); the expected mode decides which subscriptions
 * are honored. Keeping them apart is what lets a production deployment without
 * credentials keep honoring its `LIVE` subscriptions. The credential side
 * lives in `modules/billing/provider/provider-mode.ts`; it lives here because
 * the read side must know the expected mode without importing billing.
 *
 * Source: `BILLING_EXPECTED_MODE` (`test` | `live`) when set; otherwise `LIVE`
 * for a Vercel production deployment (`VERCEL_ENV=production`) and `TEST`
 * everywhere else (IB-13, docs/architecture/subscription/implementation/
 * open-decisions.md#ib-13--boot-time-mode-validation-and-expected-mode).
 *
 * Reads the environment on each call: it is a cheap lookup with no I/O, so
 * there is no cached value to go stale or to reset in tests.
 */
import type { ProviderMode } from "@/generated/prisma";

export function expectedBillingMode(env: NodeJS.ProcessEnv = process.env): ProviderMode {
  const configured = env.BILLING_EXPECTED_MODE?.trim();

  if (configured) {
    const normalized = configured.toLowerCase();

    if (normalized === "live") return "LIVE";
    if (normalized === "test") return "TEST";

    // A typo here would silently pick the wrong side of the TEST/LIVE
    // isolation, so it is a configuration error, not something to guess at.
    throw new Error(
      `BILLING_EXPECTED_MODE must be "test" or "live"; received "${configured}".`,
    );
  }

  return env.VERCEL_ENV === "production" ? "LIVE" : "TEST";
}
