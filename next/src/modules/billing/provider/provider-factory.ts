/**
 * Billing — Provider Factory
 *
 * The composition root for the provider boundary, and the only place a
 * `BillingProvider` is built. Every caller asks for one by its priority:
 *
 *   const provider = getBillingProvider(ProviderPriority.COMMAND);
 *
 * and gets, by construction, one of exactly two things:
 *
 *  - `DisabledBillingProvider`, when no credentials are configured; or
 *  - the Razorpay provider inside `BudgetedProvider`, which owns the shared
 *    request budget, the global cooldown and the auth pin.
 *
 * There is no way to obtain the bare Razorpay provider from outside this
 * directory, so no call can bypass the budget. (The ESLint boundary rule
 * rejects any import of `provider/razorpay/**` from outside `provider/`.)
 *
 * It lives in `provider/` rather than `backend/` for that reason: it is the one
 * caller of the Razorpay implementation. The budget and cooldown adapters it
 * wires in live in `backend/budget/` and reach the decorator only through two
 * small ports, so the decorator itself never touches a database.
 *
 * The Razorpay provider and the store are created once per process; the
 * decorator, which is cheap and holds a priority, is created per call.
 */
import { PostgresRateLimitStore } from "@/lib/rate-limit/postgres.store";
import type { RateLimitStore } from "@/lib/rate-limit/store";

import { keyFingerprint, ProviderHealthTracker } from "../backend/budget/provider-health";
import { ProviderBudget } from "../backend/budget/provider-budget";
import { BudgetedProvider, type ProviderBudgetGate, type ProviderHealth } from "./budgeted-provider";
import { DisabledBillingProvider } from "./disabled-provider";
import { getProviderConfiguration, type ProviderConfiguration } from "./provider-mode";
import { RazorpayBillingProvider } from "./razorpay/razorpay-provider";
import type { BillingProvider, ProviderPriority } from "./types";

export interface BillingProviderOverrides {
  /** Replaces the Razorpay provider, typically with the fake. */
  readonly inner?: BillingProvider;
  readonly store?: RateLimitStore;
  readonly budget?: ProviderBudgetGate;
  readonly health?: ProviderHealth;
}

/**
 * Builds a provider for a configuration. `getBillingProvider` is this over the
 * process's resolved configuration; the overrides exist so tests can exercise
 * the real budget and cooldown around a fake provider.
 */
export function buildBillingProvider(
  configuration: ProviderConfiguration,
  priority: ProviderPriority,
  overrides: BillingProviderOverrides = {},
): BillingProvider {
  if (configuration.mode === "DISABLED") return new DisabledBillingProvider();

  const { mode, razorpay } = configuration;

  return new BudgetedProvider(
    overrides.inner ?? new RazorpayBillingProvider(razorpay, mode),
    overrides.budget ?? new ProviderBudget(mode, { store: overrides.store ?? new PostgresRateLimitStore() }),
    overrides.health ?? new ProviderHealthTracker(mode, keyFingerprint(razorpay.keyId)),
    priority,
  );
}

let shared: { readonly inner: BillingProvider; readonly store: RateLimitStore } | null = null;

/** The provider for this process's configuration, at a caller's priority. */
export function getBillingProvider(priority: ProviderPriority): BillingProvider {
  const configuration = getProviderConfiguration();

  if (configuration.mode === "DISABLED") return new DisabledBillingProvider();

  shared ??= {
    inner: new RazorpayBillingProvider(configuration.razorpay, configuration.mode),
    store: new PostgresRateLimitStore(),
  };

  return buildBillingProvider(configuration, priority, shared);
}

/** For tests, which need a fresh decision per case. */
export function resetBillingProviderForTests(): void {
  shared = null;
}
