/**
 * Billing — Provider Boundary
 *
 * The narrow interface between Kizunia and its payment provider, sized to
 * exactly the operations Kizunia needs and no more (SB-PB-01). It is
 * deliberately not a generic payment abstraction: one interface, one Razorpay
 * implementation, one fake. No `UniversalPaymentProvider`, and none should
 * appear until a second real provider needs one.
 *
 * Everything here is Kizunia's vocabulary. No Razorpay SDK type, HTTP status
 * or error string crosses this file: a provider response is translated into
 * `ProviderSubscriptionState`, and a failure into one `ProviderFailureClass`.
 * Razorpay identifiers exist here only as opaque strings that stay inside
 * `modules/billing` (SB-PB-04).
 *
 * Three rules every implementation and caller relies on:
 *
 *  - **A failure to observe is never an observation.** A timeout, a 5xx or a
 *    malformed body leaves local state exactly as it was. For a mutation it
 *    means the outcome may be *unknown*, and it is resolved by reading the
 *    provider later, never by resending.
 *  - **No provider call inside a transaction or under a row lock** (SB-RC-08).
 *    Every method is a plain async function that is never handed a database
 *    client, so a transaction cannot be threaded through by accident.
 *  - **Every network operation is budgeted.** Callers get a provider from
 *    `getBillingProvider(priority)`, which wraps the real one in
 *    `BudgetedProvider`; nothing calls Razorpay directly.
 *
 * Not in the boundary, on purpose: pause/resume, refunds, Offer linking after
 * creation, invoice reads, plan or Offer lookup, and reading a pending
 * scheduled change. Kizunia does not initiate them in V1; they happen in the
 * Razorpay Dashboard and reach Kizunia as observations.
 *
 * See docs/architecture/subscription/implementation/provider-boundary.md and
 * docs/architecture/subscription/provider-boundary/interface-and-abstraction.md.
 */
import type {
  BillingCycle,
  MembershipPlan,
  MoneyFactKind,
  ProviderFailureClass,
  ProviderMode,
} from "@/generated/prisma";

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

/**
 * Who is calling, which decides how much of the shared request budget they may
 * use (docs/architecture/subscription/reconciliation/provider-rate-limits.md).
 * Lower numbers may use more, so a backlog can never crowd out a customer who
 * is waiting.
 */
export const ProviderPriority = {
  /** Customer and admin commands, and admin "sync now": the whole budget. */
  COMMAND: 1,
  /** Checkout confirmation and webhook-triggered syncs. */
  CONFIRMATION: 2,
  /** Due reconciliation: checkpoints, heartbeats and retries. */
  RECONCILIATION: 3,
  /** Orphan discovery: a small share, and only while the window is quiet. */
  ORPHAN_DISCOVERY: 4,
} as const;

export type ProviderPriority = (typeof ProviderPriority)[keyof typeof ProviderPriority];

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

export interface ProviderFailureDetails {
  /** The provider's own error code, for diagnosis only. Never shown to a user. */
  readonly providerErrorCode?: string;
  /** The provider's description, for diagnosis only. Never shown, never matched on. */
  readonly providerErrorDescription?: string;
}

/**
 * What a provider operation returns: exactly one of these, never a thrown
 * provider error.
 *
 * `observationAt` is the moment the request was **sent**, not when the answer
 * arrived. The sync apply path compares it with the last applied observation
 * to discard a stale read that overtook a newer one, so the response time
 * would be wrong.
 */
export type Outcome<T> =
  | { readonly kind: "SUCCESS"; readonly value: T; readonly observationAt: Date }
  | ({
      readonly kind: "FAILURE";
      readonly failureClass: ProviderFailureClass;
      /**
       * When the request was sent, if it reached the provider. Absent when
       * nothing was sent (`BUDGET_EXHAUSTED`, `UNMAPPED_PLAN`). For a mutation,
       * its presence on a failure is what makes the outcome *unknown* rather
       * than plainly not applied.
       */
      readonly requestSentAt?: Date;
    } & ProviderFailureDetails)
  /**
   * Billing is disabled (no provider configured): nothing was attempted and
   * nothing will be. Callers translate it into `503 BILLING_UNAVAILABLE`.
   */
  | { readonly kind: "PROVIDER_DISABLED" };

export type Failure = Extract<Outcome<never>, { kind: "FAILURE" }>;

export function providerSuccess<T>(value: T, observationAt: Date): Outcome<T> {
  return { kind: "SUCCESS", value, observationAt };
}

export function providerFailure(
  failureClass: ProviderFailureClass,
  details: ProviderFailureDetails & { readonly requestSentAt?: Date } = {},
): Failure {
  return { kind: "FAILURE", failureClass, ...details };
}

/**
 * Whether a failure of this class means a request actually left the process.
 * `BUDGET_EXHAUSTED` (no slot) and `UNMAPPED_PLAN` (no plan to send) are
 * decided before anything is sent; every other class was produced by, or in
 * flight to, the provider.
 */
export function failureImpliesRequestSent(failureClass: ProviderFailureClass): boolean {
  return failureClass !== "BUDGET_EXHAUSTED" && failureClass !== "UNMAPPED_PLAN";
}

// ---------------------------------------------------------------------------
// Provider state (Kizunia-defined, translated from the provider's entity)
// ---------------------------------------------------------------------------

/**
 * A provider subscription as Kizunia sees it: the normalized fields the sync
 * apply path needs. Translated from the provider's response in one place, never
 * a re-exported provider type.
 *
 * `rawStatus` is the provider's own status string, passed through untouched.
 * It is NOT a Kizunia phase: mapping a status to a phase is the sync apply
 * path's job (Phase IV), and the raw string never leaves `modules/billing`.
 */
export interface ProviderSubscriptionState {
  readonly providerSubscriptionId: string;
  readonly rawStatus: string;
  readonly providerPlanId: string;
  readonly currentStart: Date | null;
  readonly currentEnd: Date | null;
  readonly chargeAt: Date | null;
  readonly startAt: Date | null;
  /** The scheduled end of the subscription. */
  readonly endAt: Date | null;
  /** When it actually ended. */
  readonly endedAt: Date | null;
  readonly expireBy: Date | null;
  readonly hasScheduledChanges: boolean;
  /**
   * When a scheduled change takes effect, if the provider says so as a
   * timestamp. The documentation does not settle its type (`now`/`cycle_end`
   * versus a timestamp), so anything that is not a timestamp reads as `null`;
   * `hasScheduledChanges` is the reliable signal.
   */
  readonly changeScheduledAt: Date | null;
  readonly offerId: string | null;
  /** Kizunia's own identifiers echoed back (`kz_sub`, `kz_op`, `kz_env`). */
  readonly notes: Readonly<Record<string, string>>;
  readonly paidCount: number | null;
  /** The hosted authentication page. Present on a create response. */
  readonly shortUrl: string | null;

  /**
   * Read defensively. Both fields are returned by the provider but are absent
   * from its documented subscription entity (D3): useful, never depended on.
   */
  readonly paymentMethod: string | null;
  readonly haltedAt: Date | null;
}

export interface PaymentMethodInfo {
  readonly method: string;
  /** For a card: whether it is international. `null` when unknown. */
  readonly international: boolean | null;
}

/** The Kizunia identifiers carried in the provider's `notes`, so a lost create can be found again. */
export interface KizuniaNotes {
  readonly kz_sub: string;
  readonly kz_op: string;
  readonly kz_env: ProviderMode;
}

// ---------------------------------------------------------------------------
// Operation inputs
// ---------------------------------------------------------------------------

export interface CreateSubscriptionInput {
  /** Resolved to a provider plan through the per-mode catalog, inside the provider. */
  readonly plan: MembershipPlan;
  readonly cycle: BillingCycle;
  readonly totalCount: number;
  /** How long the customer has to complete authentication. */
  readonly expireBy: Date;
  /** Trial subscriptions only: when the first charge is due. */
  readonly startAt?: Date;
  readonly offerId?: string;
  readonly notes: KizuniaNotes;
}

export interface UpdateSubscriptionPlanInput {
  readonly plan: MembershipPlan;
  readonly cycle: BillingCycle;
  readonly scheduleChangeAt: "NOW" | "CYCLE_END";
}

export interface CancelSubscriptionInput {
  /** `true` cancels at the end of the current cycle. Sent only for `active`. */
  readonly atCycleEnd: boolean;
}

/** Filters on the provider's creation time, both bounds inclusive. */
export interface ListWindow {
  readonly from: Date;
  readonly to: Date;
}

export interface ListPageRequest {
  /** At most 100. */
  readonly count: number;
  readonly skip: number;
}

export interface ListPage<T> {
  readonly items: readonly T[];
}

export type WebhookSignatureMatch =
  | { readonly valid: true; readonly matchedSecret: "CURRENT" | "PREVIOUS" }
  | { readonly valid: false };

// ---------------------------------------------------------------------------
// Webhook events (Kizunia-defined, translated from the provider's payload)
// ---------------------------------------------------------------------------

/**
 * The events the webhook is subscribed to, exactly (SB-WH-08): the ten
 * subscription lifecycle events, plus two recorded only as money facts. Any
 * other type that arrives is still verified and recorded, as unsupported.
 */
export const SUBSCRIBED_WEBHOOK_EVENTS = [
  "subscription.authenticated",
  "subscription.activated",
  "subscription.charged",
  "subscription.completed",
  "subscription.updated",
  "subscription.pending",
  "subscription.halted",
  "subscription.cancelled",
  "subscription.paused",
  "subscription.resumed",
  "refund.processed",
  "payment.dispute.created",
] as const;

/**
 * How Kizunia treats an event (docs/architecture/subscription/webhooks/event-catalog.md):
 *
 * - `SUBSCRIPTION` — marks its subscription sync-due. Its payload status is
 *   **never** applied (SB-WH-03): only an authoritative fetch changes state.
 * - `FACT_ONLY` — records a money fact and nothing else.
 * - `UNSUPPORTED` — recorded as received, then `SKIPPED_UNSUPPORTED`.
 */
export type WebhookEventCategory = "SUBSCRIPTION" | "FACT_ONLY" | "UNSUPPORTED";

/** An append-only money fact an event carries (SB-WH-04). Amounts are in minor units. */
export interface WebhookMoneyFact {
  readonly kind: MoneyFactKind;
  /** The payment, refund or dispute ID: the fact's identity. */
  readonly providerObjectId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly providerInvoiceId: string | null;
  readonly periodStart: Date | null;
  readonly periodEnd: Date | null;
  readonly occurredAt: Date;
  /** For a refund or dispute: the payment it concerns, which links it to a charge. */
  readonly relatedPaymentId: string | null;
}

export interface ProviderWebhookEvent {
  readonly kind: "EVENT";
  /** The provider's event type, as sent. Billing-internal. */
  readonly eventType: string;
  readonly category: WebhookEventCategory;
  /** The merchant account the event belongs to; checked against the configured one. */
  readonly accountId: string;
  readonly providerCreatedAt: Date | null;
  /** The subscription the event is about, when it names one. */
  readonly providerSubscriptionId: string | null;
  readonly moneyFact: WebhookMoneyFact | null;
  /** The parsed body, for the billing-internal event record. Never logged. */
  readonly payload: unknown;
}

/** A verified body that is not an event Kizunia can read. */
export interface MalformedWebhook {
  readonly kind: "MALFORMED";
  readonly reason: string;
}

export type ParsedWebhook = ProviderWebhookEvent | MalformedWebhook;

// ---------------------------------------------------------------------------
// The interface
// ---------------------------------------------------------------------------

export interface BillingProvider {
  // -- Mutations: only ever called by commands (Phase V onward). Never
  //    retried automatically, since a lost response may hide a real change.
  createSubscription(input: CreateSubscriptionInput): Promise<Outcome<ProviderSubscriptionState>>;

  updateSubscriptionPlan(
    ref: string,
    input: UpdateSubscriptionPlanInput,
  ): Promise<Outcome<ProviderSubscriptionState>>;

  cancelScheduledChange(ref: string): Promise<Outcome<ProviderSubscriptionState>>;

  cancelSubscription(
    ref: string,
    input: CancelSubscriptionInput,
  ): Promise<Outcome<ProviderSubscriptionState>>;

  // -- Reads: synchronization, orphan discovery, and the advisory capability.
  fetchSubscription(ref: string): Promise<Outcome<ProviderSubscriptionState>>;

  listSubscriptions(
    window: ListWindow,
    page: ListPageRequest,
  ): Promise<Outcome<ListPage<ProviderSubscriptionState>>>;

  fetchAuthorizationPaymentMethod(paymentRef: string): Promise<Outcome<PaymentMethodInfo>>;

  // -- Inbound verification: no network, so no budget and no Outcome.
  /**
   * Verifies a webhook signature over the RAW body against the current secret
   * and, inside its rotation window, the previous one. Fails closed: with no
   * secret configured (disabled) nothing verifies.
   */
  verifyWebhookSignature(
    rawBody: string | Uint8Array,
    signature: string | null | undefined,
    now?: Date,
  ): WebhookSignatureMatch;

  /**
   * Verifies a checkout signature against the **server-held** provider
   * subscription id, never the id the browser echoed back (SB-CM-06).
   */
  verifyCheckoutSignature(
    paymentId: string,
    providerSubscriptionId: string,
    signature: string | null | undefined,
  ): boolean;

  /**
   * Translates a webhook body into Kizunia's event vocabulary. Call it only
   * after `verifyWebhookSignature` accepted the same bytes: the body is not
   * parsed before it is verified (SB-WH-01). No network, so no budget.
   */
  parseWebhookEvent(rawBody: string | Uint8Array): ParsedWebhook;
}
