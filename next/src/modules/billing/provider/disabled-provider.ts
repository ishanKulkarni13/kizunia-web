/**
 * Billing — Disabled Provider
 *
 * What `getBillingProvider()` returns when no payment credentials are
 * configured (provider mode `DISABLED`, SB-PB-03): every network operation
 * answers `PROVIDER_DISABLED` immediately, with no request, no budget unit and
 * no state touched, and verification fails closed because there is no secret to
 * verify with.
 *
 * It is a supported production state, not an error: Free, admin grants and
 * every entitlement gate never reach a provider, so they keep working. Only
 * starting or changing a paid subscription is refused, and that refusal is
 * `503 BILLING_UNAVAILABLE`, raised before this is ever called by
 * `assertBillingProviderEnabled()`.
 *
 * Its methods take no parameters: they use none, and an implementation may
 * accept fewer than the interface declares.
 */
import type {
  BillingProvider,
  ListPage,
  Outcome,
  PaymentMethodInfo,
  ProviderSubscriptionState,
  WebhookSignatureMatch,
} from "./types";

const DISABLED: Outcome<never> = { kind: "PROVIDER_DISABLED" };

export class DisabledBillingProvider implements BillingProvider {
  createSubscription(): Promise<Outcome<ProviderSubscriptionState>> {
    return Promise.resolve(DISABLED);
  }

  updateSubscriptionPlan(): Promise<Outcome<ProviderSubscriptionState>> {
    return Promise.resolve(DISABLED);
  }

  cancelScheduledChange(): Promise<Outcome<ProviderSubscriptionState>> {
    return Promise.resolve(DISABLED);
  }

  cancelSubscription(): Promise<Outcome<ProviderSubscriptionState>> {
    return Promise.resolve(DISABLED);
  }

  fetchSubscription(): Promise<Outcome<ProviderSubscriptionState>> {
    return Promise.resolve(DISABLED);
  }

  listSubscriptions(): Promise<Outcome<ListPage<ProviderSubscriptionState>>> {
    return Promise.resolve(DISABLED);
  }

  fetchAuthorizationPaymentMethod(): Promise<Outcome<PaymentMethodInfo>> {
    return Promise.resolve(DISABLED);
  }

  /** No webhook secret exists, so nothing is trusted. */
  verifyWebhookSignature(): WebhookSignatureMatch {
    return { valid: false };
  }

  verifyCheckoutSignature(): boolean {
    return false;
  }
}
