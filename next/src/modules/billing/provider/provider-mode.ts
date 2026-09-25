/**
 * Billing — Provider Mode
 *
 * Which payment-provider mode this process is in, resolved from the
 * credentials in the environment. This is the ONE place that reads
 * `RAZORPAY_*` variables: no feature module, and no other part of billing,
 * looks at them (SB-PB-04).
 *
 *   no credentials at all        -> DISABLED  (a supported production state)
 *   `rzp_test_…` key             -> TEST
 *   `rzp_live_…` key             -> LIVE
 *   anything else                -> fail at boot
 *
 * "DISABLED" is a runtime state and never stamped on a row, which is why it is
 * not in the Prisma `ProviderMode` enum. (The design docs write the three
 * states in lower case; the two that are stored are `TEST` and `LIVE`.)
 *
 * The resolved mode is one half of the picture. The other is the *expected*
 * mode (`expectedBillingMode`, in `lib/entitlements`), which says which
 * subscriptions are real for this deployment. They are kept apart on purpose:
 * a production deployment with no credentials is `DISABLED` yet still honors
 * its `LIVE` subscriptions, while a `TEST` subscription can never grant access
 * in production. The only combinations allowed at boot are resolved =
 * expected, or resolved = DISABLED.
 *
 * Resolved once, at server start, from `src/instrumentation.ts` (IB-13), then
 * memoized. `isBillingProviderEnabled()` is the only runtime question anyone
 * asks; it is never re-derived from the environment at a call site.
 *
 * See docs/architecture/subscription/provider-availability/environments.md and
 * docs/architecture/subscription/provider-availability/disabled-provider-mode.md.
 */
import type { ProviderMode } from "@/generated/prisma";
import { expectedBillingMode } from "@/lib/entitlements/billing-mode";

import { BillingConfigurationError } from "../errors/billing-configuration-error";
import { BillingUnavailableError } from "../errors/billing-unavailable-error";
import { logBillingAlert, logBillingEvent } from "../observability/log";

export type ResolvedProviderMode = ProviderMode | "DISABLED";

/**
 * The Razorpay credentials of an enabled deployment. Secrets: never logged,
 * never returned to a client, never stored on a row.
 */
export interface RazorpayCredentials {
  readonly keyId: string;
  /** API auth and the checkout-signature key. */
  readonly keySecret: string;
  /** Distinct from the key secret; verifies webhook signatures. */
  readonly webhookSecret: string;
  /** Payload `account_id` check: an event from another account is rejected. */
  readonly accountId: string;
  /**
   * The webhook secret before a rotation. Razorpay signs retries of events
   * created before a rotation with the old secret, so it is accepted for a
   * bounded window (SB-WH-07).
   */
  readonly previousWebhookSecret: string | null;
  /** When the previous secret stops being accepted. `null` = until removed. */
  readonly previousWebhookSecretUntil: Date | null;
}

export type ProviderConfiguration =
  | { readonly mode: "DISABLED" }
  | { readonly mode: ProviderMode; readonly razorpay: RazorpayCredentials };

const TEST_KEY_PREFIX = "rzp_test_";
const LIVE_KEY_PREFIX = "rzp_live_";

/** The three variables that, together, enable billing. All or none. */
const REQUIRED_CREDENTIALS = [
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
] as const;

function read(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();

  return value ? value : undefined;
}

function parsePreviousUntil(raw: string): Date {
  const until = new Date(raw);

  if (Number.isNaN(until.getTime())) {
    // A rotation window that silently fails to parse would either never expire
    // or expire at once; either way the operator must be told.
    throw new BillingConfigurationError(
      "RAZORPAY_WEBHOOK_SECRET_PREVIOUS_UNTIL is not a valid date. Use an ISO 8601 timestamp, for example 2026-10-01T00:00:00Z.",
    );
  }

  return until;
}

/**
 * Derives the provider configuration from an environment, and validates it.
 * Pure apart from reading `env`: no logging, no memoization, so every case is
 * directly testable.
 *
 * Throws `BillingConfigurationError` for anything that is neither cleanly
 * absent nor cleanly valid. A partial configuration is never guessed at.
 */
export function resolveProviderConfiguration(
  env: NodeJS.ProcessEnv = process.env,
  expected: ProviderMode = expectedBillingMode(env),
): ProviderConfiguration {
  const keyId = read(env, "RAZORPAY_KEY_ID");
  const keySecret = read(env, "RAZORPAY_KEY_SECRET");
  const webhookSecret = read(env, "RAZORPAY_WEBHOOK_SECRET");

  if (keyId === undefined && keySecret === undefined && webhookSecret === undefined) {
    return { mode: "DISABLED" };
  }

  if (keyId === undefined || keySecret === undefined || webhookSecret === undefined) {
    const missing = REQUIRED_CREDENTIALS.filter((name) => read(env, name) === undefined);

    throw new BillingConfigurationError(
      `Razorpay configuration is incomplete: missing ${missing.join(", ")}. ` +
        `Set all of ${REQUIRED_CREDENTIALS.join(", ")}, or none of them to run with paid billing disabled.`,
    );
  }

  let mode: ProviderMode;

  if (keyId.startsWith(TEST_KEY_PREFIX)) {
    mode = "TEST";
  } else if (keyId.startsWith(LIVE_KEY_PREFIX)) {
    mode = "LIVE";
  } else {
    // Razorpay documents only that test and live keys are separate; the
    // rzp_test_ / rzp_live_ prefixes are the established convention this
    // relies on. A key matching neither is a mistake, not a third mode.
    throw new BillingConfigurationError(
      `RAZORPAY_KEY_ID must start with "${TEST_KEY_PREFIX}" or "${LIVE_KEY_PREFIX}".`,
    );
  }

  const accountId = read(env, "RAZORPAY_ACCOUNT_ID");

  if (accountId === undefined) {
    throw new BillingConfigurationError(
      "RAZORPAY_ACCOUNT_ID is required when Razorpay credentials are set: webhook payloads are checked against it.",
    );
  }

  const previousWebhookSecret = read(env, "RAZORPAY_WEBHOOK_SECRET_PREVIOUS") ?? null;
  const previousUntilRaw = read(env, "RAZORPAY_WEBHOOK_SECRET_PREVIOUS_UNTIL");

  if (previousUntilRaw !== undefined && previousWebhookSecret === null) {
    throw new BillingConfigurationError(
      "RAZORPAY_WEBHOOK_SECRET_PREVIOUS_UNTIL is set without RAZORPAY_WEBHOOK_SECRET_PREVIOUS.",
    );
  }

  const previousWebhookSecretUntil =
    previousUntilRaw === undefined ? null : parsePreviousUntil(previousUntilRaw);

  if (mode !== expected) {
    throw new BillingConfigurationError(
      `Razorpay credentials are ${mode} mode, but this deployment expects ${expected} mode ` +
        `(BILLING_EXPECTED_MODE, or VERCEL_ENV when it is unset). ` +
        `Use ${expected} credentials, set BILLING_EXPECTED_MODE, or remove the credentials to run with billing disabled.`,
    );
  }

  return {
    mode,
    razorpay: {
      keyId,
      keySecret,
      webhookSecret,
      accountId,
      previousWebhookSecret,
      previousWebhookSecretUntil,
    },
  };
}

// ---------------------------------------------------------------------------
// Memoized runtime access
// ---------------------------------------------------------------------------

let cached: ProviderConfiguration | null = null;

/**
 * The configuration for this process, resolved on first use and then fixed.
 * A configuration error is not cached, so it keeps failing loudly rather than
 * degrading to `DISABLED` after the first attempt.
 */
export function getProviderConfiguration(): ProviderConfiguration {
  cached ??= resolveProviderConfiguration();

  return cached;
}

export function getProviderMode(): ResolvedProviderMode {
  return getProviderConfiguration().mode;
}

/**
 * The configured merchant account ID, for the webhook payload's `account_id`
 * check, or `null` when billing is disabled. An identifier, not a secret: this
 * exists so webhook code never has to hold the credentials object.
 */
export function getProviderAccountId(): string | null {
  const configuration = getProviderConfiguration();

  return configuration.mode === "DISABLED" ? null : configuration.razorpay.accountId;
}

/**
 * The key ID Razorpay Checkout (`checkout.js`) needs in the browser, or `null`
 * when billing is disabled. An identifier, not a secret: it is returned to the
 * owner of a checkout in the checkout response, which is why there is no
 * `NEXT_PUBLIC_RAZORPAY_*` variable and the mode seam stays server-side.
 */
export function getCheckoutKeyId(): string | null {
  const configuration = getProviderConfiguration();

  return configuration.mode === "DISABLED" ? null : configuration.razorpay.keyId;
}

/**
 * Whether Kizunia can make a real billing operation right now. The single
 * seam: nothing else asks whether credentials exist.
 */
export function isBillingProviderEnabled(): boolean {
  return getProviderMode() !== "DISABLED";
}

/**
 * Refuses with `503 BILLING_UNAVAILABLE` when billing is disabled. Checkout
 * and every subscription command call this first, so a disabled deployment
 * answers plainly, sends nothing to a provider, and writes nothing locally.
 * Free, grants and every entitlement gate never call it and keep working.
 */
export function assertBillingProviderEnabled(): void {
  if (!isBillingProviderEnabled()) throw new BillingUnavailableError();
}

/** For tests, which need a fresh decision per case. */
export function resetProviderConfigurationForTests(): void {
  cached = null;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

/**
 * Validates billing configuration at server start and memoizes the result.
 * Called from `src/instrumentation.ts` `register()`.
 *
 * Throws on a misconfiguration, which stops the server from starting: a test
 * secret paired with a live key, or a production deployment holding test keys,
 * is exactly the kind of mistake that must never reach a running instance
 * quietly. Missing credentials are not a misconfiguration; they are the
 * supported `DISABLED` state and only get a log line.
 *
 * Logs the resolved and expected mode, never a key or a secret.
 */
export function validateBillingConfigurationAtBoot(
  env: NodeJS.ProcessEnv = process.env,
): ProviderConfiguration {
  const expected = expectedBillingMode(env);
  const configuration = resolveProviderConfiguration(env, expected);

  cached = configuration;

  logBillingEvent("mode.resolved", { mode: configuration.mode, expectedMode: expected });

  if (configuration.mode === "DISABLED" && expected === "LIVE") {
    // Expected before LIVE credentials exist, and it does not stop boot: LIVE
    // subscriptions keep being honored from Kizunia's own tables. But it must
    // be a deliberate state, so it is surfaced (medium once LIVE has been
    // used; that refinement needs the tables and arrives with the health
    // summary in Phase VIII).
    logBillingAlert("PROVIDER_DISABLED_IN_PRODUCTION", "LOW", {
      expectedMode: expected,
    });
  }

  return configuration;
}
