/**
 * Razorpay — Provider
 *
 * The one `BillingProvider` implementation that talks to Razorpay. It is the
 * only code that knows Razorpay's endpoints, request shapes and error codes,
 * and the only code that turns a Kizunia plan and cycle into a Razorpay plan ID
 * (through the per-mode catalog).
 *
 * It is never used bare. `getBillingProvider(priority)` wraps it in
 * `BudgetedProvider`, which owns the request budget, the cooldown and the auth
 * pin; this class has none of that on purpose, so there is exactly one place a
 * call can be refused for budget reasons.
 *
 * Every network operation runs the same pipeline:
 *
 *   request -> no response?      TIMEOUT        (outcome unknown for a mutation)
 *           -> 2xx?               map the body   (a body that cannot be read is MALFORMED)
 *           -> anything else      classify by status and code (never by description)
 *
 * A failure carries `requestSentAt` (the request left the process), and a
 * success carries `observationAt` = that same send time. A 2xx whose body
 * cannot be mapped is `MALFORMED` *with* `requestSentAt`: for a mutation the
 * change probably happened, so it is resolved by a later read, not resent.
 *
 * Nothing here opens or joins a database transaction, and none of these methods
 * is ever given a transaction client (SB-RC-08).
 */
import type { ProviderMode } from "@/generated/prisma";

import type { RazorpayCredentials } from "../provider-mode";
import { getPlanCatalog, type PlanCatalog } from "../../config/plan-catalog";
import {
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
  type ProviderSubscriptionState,
  type UpdateSubscriptionPlanInput,
  type WebhookSignatureMatch,
} from "../types";
import { classifyHttpFailure } from "./classification";
import {
  mapPaymentEntity,
  mapSubscriptionCollection,
  mapSubscriptionEntity,
  type MappingResult,
} from "./mapping";
import {
  RazorpayClient,
  type RazorpayRequestMethod,
  type RazorpayRequestOptions,
} from "./razorpay-client";
import { verifyCheckoutSignature, verifyWebhookSignature, type WebhookSecret } from "./signatures";
import { parseRazorpayWebhook } from "./webhook-events";

const MAX_LIST_COUNT = 100;

function toEpochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export interface RazorpayBillingProviderDeps {
  readonly client?: RazorpayClient;
  readonly catalog?: PlanCatalog;
  readonly now?: () => Date;
}

export class RazorpayBillingProvider implements BillingProvider {
  private readonly client: RazorpayClient;
  private readonly catalog: PlanCatalog;
  private readonly now: () => Date;

  constructor(
    private readonly credentials: RazorpayCredentials,
    mode: ProviderMode,
    deps: RazorpayBillingProviderDeps = {},
  ) {
    this.now = deps.now ?? (() => new Date());
    this.catalog = deps.catalog ?? getPlanCatalog(mode);
    this.client =
      deps.client ??
      new RazorpayClient({
        keyId: credentials.keyId,
        keySecret: credentials.keySecret,
        now: this.now,
      });
  }

  // -- Mutations ------------------------------------------------------------

  async createSubscription(input: CreateSubscriptionInput): Promise<Outcome<ProviderSubscriptionState>> {
    const planId = this.catalog.currentProviderPlanId(input.plan, input.cycle);

    // Nothing to send: refused before any request, so it is not an unknown outcome.
    if (planId === undefined) return providerFailure("UNMAPPED_PLAN");

    return this.call("POST", "/subscriptions", mapSubscriptionEntity, {
      body: {
        plan_id: planId,
        total_count: input.totalCount,
        expire_by: toEpochSeconds(input.expireBy),
        ...(input.startAt && { start_at: toEpochSeconds(input.startAt) }),
        ...(input.offerId && { offer_id: input.offerId }),
        notes: input.notes,
      },
    });
  }

  async updateSubscriptionPlan(
    ref: string,
    input: UpdateSubscriptionPlanInput,
  ): Promise<Outcome<ProviderSubscriptionState>> {
    const planId = this.catalog.currentProviderPlanId(input.plan, input.cycle);

    if (planId === undefined) return providerFailure("UNMAPPED_PLAN");

    return this.call("PATCH", subscriptionPath(ref), mapSubscriptionEntity, {
      body: {
        plan_id: planId,
        schedule_change_at: input.scheduleChangeAt === "NOW" ? "now" : "cycle_end",
      },
    });
  }

  async cancelScheduledChange(ref: string): Promise<Outcome<ProviderSubscriptionState>> {
    return this.call("POST", `${subscriptionPath(ref)}/cancel_scheduled_changes`, mapSubscriptionEntity, {
      body: {},
    });
  }

  async cancelSubscription(
    ref: string,
    input: CancelSubscriptionInput,
  ): Promise<Outcome<ProviderSubscriptionState>> {
    return this.call("POST", `${subscriptionPath(ref)}/cancel`, mapSubscriptionEntity, {
      body: { cancel_at_cycle_end: input.atCycleEnd ? 1 : 0 },
    });
  }

  // -- Reads ----------------------------------------------------------------

  async fetchSubscription(ref: string): Promise<Outcome<ProviderSubscriptionState>> {
    return this.call("GET", subscriptionPath(ref), mapSubscriptionEntity);
  }

  async listSubscriptions(
    window: ListWindow,
    page: ListPageRequest,
  ): Promise<Outcome<ListPage<ProviderSubscriptionState>>> {
    return this.call("GET", "/subscriptions", mapSubscriptionCollection, {
      query: {
        // Filters on creation time, both bounds inclusive (TEST-observed).
        from: toEpochSeconds(window.from),
        to: toEpochSeconds(window.to),
        count: Math.min(MAX_LIST_COUNT, Math.max(1, Math.trunc(page.count))),
        skip: Math.max(0, Math.trunc(page.skip)),
      },
    });
  }

  async fetchAuthorizationPaymentMethod(paymentRef: string): Promise<Outcome<PaymentMethodInfo>> {
    return this.call("GET", `/payments/${encodeURIComponent(paymentRef)}`, mapPaymentEntity);
  }

  // -- Verification (no network) --------------------------------------------

  verifyWebhookSignature(
    rawBody: string | Uint8Array,
    signature: string | null | undefined,
    now: Date = this.now(),
  ): WebhookSignatureMatch {
    const secrets: WebhookSecret[] = [
      { secret: this.credentials.webhookSecret, label: "CURRENT", validUntil: null },
    ];

    if (this.credentials.previousWebhookSecret !== null) {
      secrets.push({
        secret: this.credentials.previousWebhookSecret,
        label: "PREVIOUS",
        validUntil: this.credentials.previousWebhookSecretUntil,
      });
    }

    return verifyWebhookSignature({ rawBody, signature, secrets, now });
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
      keySecret: this.credentials.keySecret,
    });
  }

  parseWebhookEvent(rawBody: string | Uint8Array): ParsedWebhook {
    return parseRazorpayWebhook(rawBody);
  }

  // -- Internals ------------------------------------------------------------

  private async call<T>(
    method: RazorpayRequestMethod,
    path: string,
    map: (body: unknown) => MappingResult<T>,
    options: RazorpayRequestOptions = {},
  ): Promise<Outcome<T>> {
    const raw = await this.client.request(method, path, options);

    if (raw.kind === "NO_RESPONSE") {
      return providerFailure("TIMEOUT", { requestSentAt: raw.sentAt });
    }

    if (raw.status >= 200 && raw.status < 300) {
      const mapped = map(raw.body);

      return mapped.ok
        ? providerSuccess(mapped.value, raw.sentAt)
        : providerFailure("MALFORMED", {
            requestSentAt: raw.sentAt,
            providerErrorDescription: mapped.reason,
          });
    }

    const { failureClass, providerErrorCode, providerErrorDescription } = classifyHttpFailure(
      raw.status,
      raw.body,
    );

    return providerFailure(failureClass, {
      requestSentAt: raw.sentAt,
      providerErrorCode,
      providerErrorDescription,
    });
  }
}

function subscriptionPath(ref: string): string {
  return `/subscriptions/${encodeURIComponent(ref)}`;
}
