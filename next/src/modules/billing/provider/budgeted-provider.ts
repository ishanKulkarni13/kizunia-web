/**
 * Billing — Budgeted Provider
 *
 * The decorator every real provider call goes through. It wraps any
 * `BillingProvider` and, for each network operation, in order:
 *
 *  1. refuses outright if the credentials already failed authentication
 *     (`AUTH_FAILURE`, every priority): retrying a rejected key only produces
 *     more rejections, and it stays pinned until the key changes;
 *  2. refuses priorities 2–4 while the global cooldown is running
 *     (`BUDGET_EXHAUSTED`; priority 1 may still try, since a customer asking to
 *     cancel should get a real answer if the provider has recovered);
 *  3. acquires one unit of the shared request budget at this caller's priority,
 *     and refuses (`BUDGET_EXHAUSTED`) if there is none;
 *  4. sends the call, which stamps `observationAt` / `requestSentAt` with the
 *     time the request was SENT;
 *  5. tells the health tracker what happened, so a 429 or a run of timeouts
 *     starts a cooldown and a bad key is pinned.
 *
 * A refusal in steps 1–3 sends nothing and carries no `requestSentAt`, so for a
 * mutation it is a plain "not applied", never an unknown outcome.
 *
 * Bookkeeping never costs a result. Recording the outcome (step 5) is guarded:
 * if the state store is unavailable it is logged and the outcome is returned
 * unchanged, because a mutation that reached the provider must not be turned
 * into an exception by a failure to note it.
 *
 * Verification (webhook and checkout signatures) is not a network operation:
 * it passes straight through with no budget and no cooldown. And this class
 * only ever sees the two small ports below; the store and the table behind them
 * live in `backend/budget/`, so nothing here touches a database.
 *
 * One instance serves one priority. Callers obtain it from
 * `getBillingProvider(priority)`.
 *
 * See docs/architecture/subscription/reconciliation/provider-rate-limits.md.
 */
import type { ProviderFailureClass } from "@/generated/prisma";

import { logBillingEvent } from "../observability/log";
import {
  ProviderPriority,
  providerFailure,
  type BillingProvider,
  type CancelSubscriptionInput,
  type CreateSubscriptionInput,
  type ListPage,
  type ListPageRequest,
  type ListWindow,
  type Outcome,
  type PaymentMethodInfo,
  type ProviderSubscriptionState,
  type UpdateSubscriptionPlanInput,
  type WebhookSignatureMatch,
} from "./types";

/** Whether a call at a priority may be sent now. */
export interface ProviderBudgetGate {
  /** Consumes one unit and returns `true`, or returns `false` when the priority's ceiling is reached. */
  acquire(priority: ProviderPriority): Promise<boolean>;
}

export type ProviderVerdict = "CLEAR" | "COOLING_DOWN" | "AUTH_PINNED";

/** The shared, cross-instance health of the provider connection. */
export interface ProviderHealth {
  verdict(): Promise<ProviderVerdict>;
  /** Records what a call that reached the provider returned. */
  record(result: ProviderFailureClass | "SUCCESS"): Promise<void>;
}

export class BudgetedProvider implements BillingProvider {
  constructor(
    private readonly inner: BillingProvider,
    private readonly budget: ProviderBudgetGate,
    private readonly health: ProviderHealth,
    private readonly priority: ProviderPriority,
  ) {}

  // -- Mutations ------------------------------------------------------------

  createSubscription(input: CreateSubscriptionInput): Promise<Outcome<ProviderSubscriptionState>> {
    return this.guarded(() => this.inner.createSubscription(input));
  }

  updateSubscriptionPlan(
    ref: string,
    input: UpdateSubscriptionPlanInput,
  ): Promise<Outcome<ProviderSubscriptionState>> {
    return this.guarded(() => this.inner.updateSubscriptionPlan(ref, input));
  }

  cancelScheduledChange(ref: string): Promise<Outcome<ProviderSubscriptionState>> {
    return this.guarded(() => this.inner.cancelScheduledChange(ref));
  }

  cancelSubscription(
    ref: string,
    input: CancelSubscriptionInput,
  ): Promise<Outcome<ProviderSubscriptionState>> {
    return this.guarded(() => this.inner.cancelSubscription(ref, input));
  }

  // -- Reads ----------------------------------------------------------------

  fetchSubscription(ref: string): Promise<Outcome<ProviderSubscriptionState>> {
    return this.guarded(() => this.inner.fetchSubscription(ref));
  }

  listSubscriptions(
    window: ListWindow,
    page: ListPageRequest,
  ): Promise<Outcome<ListPage<ProviderSubscriptionState>>> {
    return this.guarded(() => this.inner.listSubscriptions(window, page));
  }

  fetchAuthorizationPaymentMethod(paymentRef: string): Promise<Outcome<PaymentMethodInfo>> {
    return this.guarded(() => this.inner.fetchAuthorizationPaymentMethod(paymentRef));
  }

  // -- Verification: no network, so no budget and no cooldown ----------------

  verifyWebhookSignature(
    rawBody: string | Uint8Array,
    signature: string | null | undefined,
    now?: Date,
  ): WebhookSignatureMatch {
    return this.inner.verifyWebhookSignature(rawBody, signature, now);
  }

  verifyCheckoutSignature(
    paymentId: string,
    providerSubscriptionId: string,
    signature: string | null | undefined,
  ): boolean {
    return this.inner.verifyCheckoutSignature(paymentId, providerSubscriptionId, signature);
  }

  // -- Internals ------------------------------------------------------------

  private async guarded<T>(send: () => Promise<Outcome<T>>): Promise<Outcome<T>> {
    const verdict = await this.verdictSafely();

    if (verdict === "AUTH_PINNED") {
      logBillingEvent("budget.refused", { priority: this.priority, reason: "AUTH_PINNED" });

      return providerFailure("AUTH_FAILURE");
    }

    if (verdict === "COOLING_DOWN" && this.priority !== ProviderPriority.COMMAND) {
      logBillingEvent("budget.refused", { priority: this.priority, reason: "COOLDOWN" });

      return providerFailure("BUDGET_EXHAUSTED");
    }

    // A refusal for budget is logged by the budget itself, with its ceiling.
    if (!(await this.acquireSafely())) return providerFailure("BUDGET_EXHAUSTED");

    const outcome = await send();

    // Nothing was attempted in disabled mode, so there is nothing to record.
    if (outcome.kind !== "PROVIDER_DISABLED") {
      await this.recordSafely(outcome.kind === "SUCCESS" ? "SUCCESS" : outcome.failureClass);
    }

    return outcome;
  }

  /**
   * An unreadable verdict is treated as clear: the budget check that follows
   * uses the same store, so a real outage still refuses the call there.
   */
  private async verdictSafely(): Promise<ProviderVerdict> {
    try {
      return await this.health.verdict();
    } catch (error) {
      logBillingEvent("health.verdict_failed", { priority: this.priority, error: describe(error) });

      return "CLEAR";
    }
  }

  /** Fails closed: no budget unit means nothing is sent. */
  private async acquireSafely(): Promise<boolean> {
    try {
      return await this.budget.acquire(this.priority);
    } catch (error) {
      logBillingEvent("budget.refused", {
        priority: this.priority,
        reason: "STORE_ERROR",
        error: describe(error),
      });

      return false;
    }
  }

  private async recordSafely(result: ProviderFailureClass | "SUCCESS"): Promise<void> {
    try {
      await this.health.record(result);
    } catch (error) {
      // Never let bookkeeping swallow a result the caller needs.
      logBillingEvent("health.record_failed", { priority: this.priority, result, error: describe(error) });
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "unknown";
}
