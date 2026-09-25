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
 *    (nothing was). With `afterApplying: true` the operation is performed
 *    first and only its answer is lost — the case that makes a create's
 *    outcome truly unknown (a timeout after Razorpay created it).
 *  - **A believable happy path.** With nothing scripted, operations behave like
 *    a small, well-behaved provider over an in-memory store: create, fetch,
 *    cancel, plan change and list.
 *  - **Disabled mode.** `disable()` makes every network operation answer
 *    `PROVIDER_DISABLED` with no work done.
 *  - **Realistic verification.** Signatures use the same HMAC scheme as the
 *    real provider, and `signWebhook` / `signCheckout` produce valid ones.
 *    A previous webhook secret with a rotation deadline can be configured,
 *    and `webhookBody` builds a Razorpay-shaped event, which `parseWebhookEvent`
 *    reads with the real parser.
 *
 * An ID it does not hold is answered as Razorpay TEST answers one: a `400
 * BAD_REQUEST_ERROR`, classified `REJECTED`, never a `NOT_FOUND` (D12 in
 * razorpay-facts.md). The sync path relies on that to detect a missing
 * provider subscription (IB-23), so the fake must not be kinder than reality.
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
  type WebhookSecret,
} from "./razorpay/signatures";
import { parseRazorpayWebhook } from "./razorpay/webhook-events";
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
  type ParsedWebhook,
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
  /** A previous webhook secret, accepted until `previousWebhookSecretUntil` (SB-WH-07). */
  readonly previousWebhookSecret?: string;
  readonly previousWebhookSecretUntil?: Date | null;
  /** The merchant account `webhookBody` stamps on an event. */
  readonly accountId?: string;
}

/** The parts of a Razorpay event `webhookBody` fills in. Epoch seconds are derived from dates. */
export interface FakeWebhookInput {
  readonly eventType: string;
  readonly providerSubscriptionId?: string | null;
  readonly accountId?: string;
  readonly createdAt?: Date;
  /** Extra subscription entity fields (e.g. notes, status). The status is never read by Kizunia. */
  readonly subscription?: Readonly<Record<string, unknown>>;
  readonly payment?: { readonly id: string; readonly amount: number; readonly invoiceId?: string; readonly createdAt?: Date };
  readonly refund?: { readonly id: string; readonly paymentId: string; readonly amount: number; readonly createdAt?: Date };
  readonly dispute?: { readonly id: string; readonly paymentId: string; readonly amount: number; readonly createdAt?: Date };
}

interface ScriptedFailure extends ProviderFailureDetails {
  readonly method: FakeNetworkMethod | "*";
  readonly failureClass: ProviderFailureClass;
  /** Perform the operation, then answer with the failure (a lost response). */
  readonly afterApplying: boolean;
  remaining: number;
}

export interface FailNextOptions extends ProviderFailureDetails {
  readonly times?: number;
  /** Apply the operation at the "provider" and then fail: the response was lost, not the request. */
  readonly afterApplying?: boolean;
}

const TERMINAL_STATUSES = new Set(["cancelled", "completed", "expired"]);

export class FakeBillingProvider implements BillingProvider {
  /** Every network call, in order. Verification calls are not network calls and are not recorded. */
  readonly calls: FakeProviderCall[] = [];

  private readonly now: () => Date;
  private readonly keySecret: string;
  private readonly webhookSecret: string;
  private readonly previousWebhookSecret: string | null;
  private readonly previousWebhookSecretUntil: Date | null;
  private readonly accountId: string;

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
    this.previousWebhookSecret = options.previousWebhookSecret ?? null;
    this.previousWebhookSecretUntil = options.previousWebhookSecretUntil ?? null;
    this.accountId = options.accountId ?? "acc_fake";
  }

  // -- Scripting ------------------------------------------------------------

  /**
   * Makes the next `times` calls of `method` (or of any network method, for
   * `"*"`) fail as `failureClass`. Scripted failures are consumed in the order
   * they were added.
   */
  failNext(method: FakeNetworkMethod | "*", failureClass: ProviderFailureClass, options: FailNextOptions = {}): this {
    const { times = 1, afterApplying = false, ...details } = options;

    this.failures.push({ method, failureClass, afterApplying, remaining: times, ...details });

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

  /** A signature made with the previous webhook secret, as a retry from before a rotation carries. */
  signWebhookWithPrevious(rawBody: string | Uint8Array): string {
    if (this.previousWebhookSecret === null) throw new Error("no previous webhook secret configured");

    return hmacSha256Hex(this.previousWebhookSecret, rawBody);
  }

  /** A Razorpay-shaped webhook body, as bytes Razorpay would send. */
  webhookBody(input: FakeWebhookInput): string {
    const createdAt = input.createdAt ?? this.now();
    const seconds = (date: Date) => Math.floor(date.getTime() / 1000);
    const payload: Record<string, unknown> = {};
    const contains: string[] = [];

    if (input.providerSubscriptionId !== undefined && input.providerSubscriptionId !== null) {
      const state = this.subscriptions.get(input.providerSubscriptionId);

      contains.push("subscription");
      payload.subscription = {
        entity: {
          id: input.providerSubscriptionId,
          entity: "subscription",
          plan_id: state?.providerPlanId ?? "plan_fake",
          status: state?.rawStatus ?? "active",
          current_start: state?.currentStart ? seconds(state.currentStart) : null,
          current_end: state?.currentEnd ? seconds(state.currentEnd) : null,
          notes: state?.notes ?? {},
          ...input.subscription,
        },
      };
    }

    if (input.payment) {
      contains.push("payment");
      payload.payment = {
        entity: {
          id: input.payment.id,
          entity: "payment",
          amount: input.payment.amount,
          currency: "INR",
          status: "captured",
          invoice_id: input.payment.invoiceId ?? null,
          created_at: seconds(input.payment.createdAt ?? createdAt),
        },
      };
    }

    if (input.refund) {
      contains.push("refund");
      payload.refund = {
        entity: {
          id: input.refund.id,
          entity: "refund",
          payment_id: input.refund.paymentId,
          amount: input.refund.amount,
          currency: "INR",
          status: "processed",
          created_at: seconds(input.refund.createdAt ?? createdAt),
        },
      };
    }

    if (input.dispute) {
      contains.push("dispute");
      payload.dispute = {
        entity: {
          id: input.dispute.id,
          entity: "dispute",
          payment_id: input.dispute.paymentId,
          amount: input.dispute.amount,
          currency: "INR",
          created_at: seconds(input.dispute.createdAt ?? createdAt),
        },
      };
    }

    return JSON.stringify({
      entity: "event",
      account_id: input.accountId ?? this.accountId,
      event: input.eventType,
      contains,
      payload,
      created_at: seconds(createdAt),
    });
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

      if (!current) return this.unknownId();
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

      if (!current) return this.unknownId();
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

      if (!current) return this.unknownId();
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

      return current ? providerSuccess(current, this.now()) : this.unknownId();
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

      return info ? providerSuccess(info, this.now()) : this.unknownId();
    });
  }

  // -- Verification (no network) --------------------------------------------

  verifyWebhookSignature(
    rawBody: string | Uint8Array,
    signature: string | null | undefined,
    now: Date = this.now(),
  ): WebhookSignatureMatch {
    const secrets: WebhookSecret[] = [{ secret: this.webhookSecret, label: "CURRENT", validUntil: null }];

    if (this.previousWebhookSecret !== null) {
      secrets.push({
        secret: this.previousWebhookSecret,
        label: "PREVIOUS",
        validUntil: this.previousWebhookSecretUntil,
      });
    }

    return verifyWebhookSignature({ rawBody, signature, secrets, now });
  }

  /** The real Razorpay parser: the fake's events are Razorpay-shaped. */
  parseWebhookEvent(rawBody: string | Uint8Array): ParsedWebhook {
    return parseRazorpayWebhook(rawBody);
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

      if (scripted.afterApplying) happyPath();

      return Promise.resolve(this.fail(failureClass, { providerErrorCode, providerErrorDescription }));
    }

    return Promise.resolve(happyPath());
  }

  /**
   * What Razorpay TEST returns for a well-formed ID it does not know (D12,
   * observed 2026-09-25): a `400 BAD_REQUEST_ERROR`, so `REJECTED`.
   */
  private unknownId() {
    return this.fail("REJECTED", {
      providerErrorCode: "BAD_REQUEST_ERROR",
      providerErrorDescription: "The ID provided is invalid or could not be found.",
    });
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
