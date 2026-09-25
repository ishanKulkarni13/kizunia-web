/**
 * Billing — Fake Provider
 *
 * An in-memory `BillingProvider` for tests and local development, so every
 * piece of Kizunia-side billing logic can be exercised with no Razorpay account
 * and no network ("all tests pass on admin grants" is never read as "Razorpay
 * integration verified"; the real implementation is checked separately by the
 * opt-in contract suite).
 *
 * What it is for:
 *
 *  - **Every failure class on demand.** `failNext(method, failureClass)` makes
 *    the next call fail as that class, for any of the ten, on any operation.
 *    Failures carry `requestSentAt` exactly as the real provider does, so a
 *    test can tell an unknown outcome (a request was sent) from a plain refusal
 *    (nothing was).
 *  - **A believable happy path.** With nothing scripted, operations behave like
 *    a small, well-behaved provider over an in-memory store: create, fetch,
 *    cancel, plan change and list.
 *  - **Disabled mode.** `disable()` makes every network operation answer
 *    `PROVIDER_DISABLED` with no work done.
 *  - **Realistic verification.** Signatures use the same HMAC scheme as the
 *    real provider, and `signWebhook` / `signCheckout` produce valid ones.
 *
 * It records every network call in `calls`, in order. It deliberately does
 * not model Razorpay's lifecycle (charges, retries, halting): a test that needs
 * a subscription in a given state seeds it with `seed`.
 */
import type { ProviderFailureClass } from "@/generated/prisma";

import {
  hmacSha256Hex,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "./razorpay/signatures";
import {
  failureImpliesRequestSent,
  providerFailure,
  providerSuccess,
  type BillingProvider,
  type CancelSubscriptionInput,
  type CreateSubscriptionInput,
  type ListPage,
  type ListPageRequest,
  type ListWindow,
  type Outcome,
  type PaymentMethodInfo,
  type ProviderFailureDetails,
  type ProviderSubscriptionState,
  type UpdateSubscriptionPlanInput,
  type WebhookSignatureMatch,
} from "./types";

export type FakeNetworkMethod =
  | "createSubscription"
  | "updateSubscriptionPlan"
  | "cancelScheduledChange"
  | "cancelSubscription"
  | "fetchSubscription"
  | "listSubscriptions"
  | "fetchAuthorizationPaymentMethod";

export interface FakeProviderCall {
  readonly method: FakeNetworkMethod;
  readonly args: readonly unknown[];
  readonly at: Date;
}

export interface FakeProviderOptions {
  /** The clock; tests freeze it to assert `observationAt`. */
  readonly now?: () => Date;
  readonly keySecret?: string;
  readonly webhookSecret?: string;
}

interface ScriptedFailure extends ProviderFailureDetails {
  readonly method: FakeNetworkMethod | "*";
  readonly failureClass: ProviderFailureClass;
  remaining: number;
}

const TERMINAL_STATUSES = new Set(["cancelled", "completed", "expired"]);

export class FakeBillingProvider implements BillingProvider {
  /** Every network call, in order. Verification calls are not network calls and are not recorded. */
  readonly calls: FakeProviderCall[] = [];

  private readonly now: () => Date;
  private readonly keySecret: string;
  private readonly webhookSecret: string;

  private readonly subscriptions = new Map<string, ProviderSubscriptionState>();
  private readonly createdAt = new Map<string, Date>();
  private readonly paymentMethods = new Map<string, PaymentMethodInfo>();
  private readonly failures: ScriptedFailure[] = [];
  private disabled = false;
  private sequence = 0;

  constructor(options: FakeProviderOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.keySecret = options.keySecret ?? "fake-key-secret";
    this.webhookSecret = options.webhookSecret ?? "fake-webhook-secret";
  }

  // -- Scripting ------------------------------------------------------------

  /**
   * Makes the next `times` calls of `method` (or of any network method, for
   * `"*"`) fail as `failureClass`. Scripted failures are consumed in the order
   * they were added.
   */
  failNext(
    method: FakeNetworkMethod | "*",
    failureClass: ProviderFailureClass,
    options: ProviderFailureDetails & { readonly times?: number } = {},
  ): this {
    const { times = 1, ...details } = options;

    this.failures.push({ method, failureClass, remaining: times, ...details });

    return this;
  }

  /** Every network operation answers `PROVIDER_DISABLED` without any work. */
  disable(): this {
    this.disabled = true;

    return this;
  }

  enable(): this {
    this.disabled = false;

    return this;
  }

  /** Puts a subscription into the store in any state, for tests that start mid-lifecycle. */
  seed(
    overrides: Partial<ProviderSubscriptionState> & { readonly providerSubscriptionId: string },
    createdAt: Date = this.now(),
  ): ProviderSubscriptionState {
    const state: ProviderSubscriptionState = { ...this.baseState(overrides.providerSubscriptionId), ...overrides };

    this.subscriptions.set(state.providerSubscriptionId, state);
    this.createdAt.set(state.providerSubscriptionId, createdAt);

    return state;
  }

  /** The current stored state, for assertions. */
  peek(providerSubscriptionId: string): ProviderSubscriptionState | undefined {
    return this.subscriptions.get(providerSubscriptionId);
  }

  setPaymentMethod(paymentRef: string, info: PaymentMethodInfo): this {
    this.paymentMethods.set(paymentRef, info);

    return this;
  }

  /** A valid `X-Razorpay-Signature` for `rawBody`, signed with this fake's webhook secret. */
  signWebhook(rawBody: string | Uint8Array): string {
    return hmacSha256Hex(this.webhookSecret, rawBody);
  }

  /** A valid checkout signature for a payment and subscription. */
  signCheckout(paymentId: string, providerSubscriptionId: string): string {
    return hmacSha256Hex(this.keySecret, `${paymentId}|${providerSubscriptionId}`);
  }

  // -- Mutations ------------------------------------------------------------

  async createSubscription(input: CreateSubscriptionInput): Promise<Outcome<ProviderSubscriptionState>> {
    return this.run("createSubscription", [input], () => {
      const providerSubscriptionId = `sub_fake_${++this.sequence}`;
      const state = this.seed({
        providerSubscriptionId,
        rawStatus: "created",
        providerPlanId: `plan_fake_${input.plan}_${input.cycle}`,
        startAt: input.startAt ?? null,
        expireBy: input.expireBy,
        offerId: input.offerId ?? null,
        notes: { ...input.notes },
        shortUrl: `https://fake.invalid/pay/${providerSubscriptionId}`,
      });

      return providerSuccess(state, this.now());
    });
  }

  async updateSubscriptionPlan(
    ref: string,
    input: UpdateSubscriptionPlanInput,
  ): Promise<Outcome<ProviderSubscriptionState>> {
    return this.run("updateSubscriptionPlan", [ref, input], () => {
      const current = this.subscriptions.get(ref);

      if (!current) return this.fail("NOT_FOUND");
      if (current.rawStatus !== "active" && current.rawStatus !== "authenticated") {
        return this.fail("REJECTED", { providerErrorCode: "BAD_REQUEST_ERROR" });
      }

      const providerPlanId = `plan_fake_${input.plan}_${input.cycle}`;
      const updated =
        input.scheduleChangeAt === "NOW"
          ? { ...current, providerPlanId }
          : { ...current, hasScheduledChanges: true };

      this.subscriptions.set(ref, updated);

      return providerSuccess(updated, this.now());
    });
  }

  async cancelScheduledChange(ref: string): Promise<Outcome<ProviderSubscriptionState>> {
    return this.run("cancelScheduledChange", [ref], () => {
      const current = this.subscriptions.get(ref);

      if (!current) return this.fail("NOT_FOUND");
      if (!current.hasScheduledChanges) {
        return this.fail("REJECTED", { providerErrorCode: "BAD_REQUEST_ERROR" });
      }

      const updated = { ...current, hasScheduledChanges: false };
      this.subscriptions.set(ref, updated);

      return providerSuccess(updated, this.now());
    });
  }

  async cancelSubscription(
    ref: string,
    input: CancelSubscriptionInput,
  ): Promise<Outcome<ProviderSubscriptionState>> {
    return this.run("cancelSubscription", [ref, input], () => {
      const current = this.subscriptions.get(ref);

      if (!current) return this.fail("NOT_FOUND");
      if (TERMINAL_STATUSES.has(current.rawStatus)) {
        return this.fail("REJECTED", { providerErrorCode: "BAD_REQUEST_ERROR" });
      }

      // A cycle-end cancellation is accepted and changes nothing observable
      // (A2): only Kizunia's own record can say it was requested.
      if (input.atCycleEnd) return providerSuccess(current, this.now());

      const updated = { ...current, rawStatus: "cancelled", endedAt: this.now() };
      this.subscriptions.set(ref, updated);

      return providerSuccess(updated, this.now());
    });
  }

  // -- Reads ----------------------------------------------------------------

  async fetchSubscription(ref: string): Promise<Outcome<ProviderSubscriptionState>> {
    return this.run("fetchSubscription", [ref], () => {
      const current = this.subscriptions.get(ref);

      return current ? providerSuccess(current, this.now()) : this.fail("NOT_FOUND");
    });
  }

  async listSubscriptions(
    window: ListWindow,
    page: ListPageRequest,
  ): Promise<Outcome<ListPage<ProviderSubscriptionState>>> {
    return this.run("listSubscriptions", [window, page], () => {
      const inWindow = [...this.subscriptions.values()].filter((state) => {
        const created = this.createdAt.get(state.providerSubscriptionId);

        // Both bounds inclusive, on creation time (TEST-observed).
        return (
          created !== undefined &&
          created.getTime() >= window.from.getTime() &&
          created.getTime() <= window.to.getTime()
        );
      });

      return providerSuccess({ items: inWindow.slice(page.skip, page.skip + page.count) }, this.now());
    });
  }

  async fetchAuthorizationPaymentMethod(paymentRef: string): Promise<Outcome<PaymentMethodInfo>> {
    return this.run("fetchAuthorizationPaymentMethod", [paymentRef], () => {
      const info = this.paymentMethods.get(paymentRef);

      return info ? providerSuccess(info, this.now()) : this.fail("NOT_FOUND");
    });
  }

  // -- Verification (no network) --------------------------------------------

  verifyWebhookSignature(
    rawBody: string | Uint8Array,
    signature: string | null | undefined,
    now: Date = this.now(),
  ): WebhookSignatureMatch {
    return verifyWebhookSignature({
      rawBody,
      signature,
      secrets: [{ secret: this.webhookSecret, label: "CURRENT", validUntil: null }],
      now,
    });
  }

  verifyCheckoutSignature(
    paymentId: string,
    providerSubscriptionId: string,
    signature: string | null | undefined,
  ): boolean {
    return verifyCheckoutSignature({
      paymentId,
      providerSubscriptionId,
      signature,
      keySecret: this.keySecret,
    });
  }

  // -- Internals ------------------------------------------------------------

  private run<T>(
    method: FakeNetworkMethod,
    args: readonly unknown[],
    happyPath: () => Outcome<T>,
  ): Promise<Outcome<T>> {
    this.calls.push({ method, args, at: this.now() });

    if (this.disabled) return Promise.resolve({ kind: "PROVIDER_DISABLED" });

    const scripted = this.failures.find(
      (failure) => failure.remaining > 0 && (failure.method === "*" || failure.method === method),
    );

    if (scripted) {
      scripted.remaining -= 1;

      const { failureClass, providerErrorCode, providerErrorDescription } = scripted;

      return Promise.resolve(this.fail(failureClass, { providerErrorCode, providerErrorDescription }));
    }

    return Promise.resolve(happyPath());
  }

  private fail(failureClass: ProviderFailureClass, details: ProviderFailureDetails = {}) {
    return providerFailure(failureClass, {
      ...details,
      ...(failureImpliesRequestSent(failureClass) && { requestSentAt: this.now() }),
    });
  }

  private baseState(providerSubscriptionId: string): ProviderSubscriptionState {
    return {
      providerSubscriptionId,
      rawStatus: "created",
      providerPlanId: "plan_fake",
      currentStart: null,
      currentEnd: null,
      chargeAt: null,
      startAt: null,
      endAt: null,
      endedAt: null,
      expireBy: null,
      hasScheduledChanges: false,
      changeScheduledAt: null,
      offerId: null,
      notes: {},
      paidCount: 0,
      shortUrl: null,
      paymentMethod: null,
      haltedAt: null,
    };
  }
}
