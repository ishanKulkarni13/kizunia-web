/**
 * Billing — ConfirmCheckout
 *
 * Razorpay Checkout's handler calls this with `razorpay_payment_id` and
 * `razorpay_signature`. It exists for latency, not correctness (SB-CM-06): a
 * paying user sees access in seconds instead of waiting for the webhook, and
 * nothing depends on it being called.
 *
 *   the caller's own PENDING_AUTHENTICATION subscription    (never one the browser names)
 *   verify HMAC(payment_id | SERVER-HELD provider id, key_secret)
 *     valid    -> mark due (CHECKOUT_CONFIRM), targeted sync at priority 2,
 *                 best-effort advisory payment method (UX only, SB-LC-07)
 *     invalid  -> a security event; the row is STILL marked due, and an
 *                 authoritative fetch decides — never the signature
 *   respond with the `/me/billing` summary
 *
 * It is a read-only trigger: no provider mutation, so no BillingOperation and
 * no Idempotency-Key (IB-25 item 8). It never changes local state from
 * client-supplied values: phase and access move only through the apply path.
 * A subscription ID the browser sends is compared for a security log, and
 * otherwise ignored.
 */
import type { StrictAuthorizationActor } from "@/authorization";
import prisma from "@/lib/prisma";

import type { PlanCatalog } from "../../config/plan-catalog";
import { BillingUnavailableError, NoPendingCheckoutError } from "../../errors";
import { logBillingEvent } from "../../observability/log";
import { getBillingProvider } from "../../provider/provider-factory";
import { assertBillingProviderEnabled, getProviderMode, type ResolvedProviderMode } from "../../provider/provider-mode";
import { ProviderPriority, type BillingProvider } from "../../provider/types";
import type { ConfirmCheckoutInput } from "../../schemas/checkout";
import { BillingSummaryService, type BillingSummaryDTO } from "../billing-summary.service";
import { SyncClaimRepository } from "../sync/claim.repository";
import { SyncService } from "../sync/sync.service";

export interface ConfirmCheckoutResult extends BillingSummaryDTO {
  /**
   * Whether the signature verified against the server-held subscription.
   * `null` when there was no pending checkout to verify against because it is
   * already paid (the webhook got there first): nothing to do.
   */
  readonly signatureValid: boolean | null;
}

export interface ConfirmCheckoutDeps {
  readonly providerFor?: (priority: ProviderPriority) => BillingProvider;
  readonly resolvedMode?: () => ResolvedProviderMode;
  readonly assertEnabled?: () => void;
  readonly now?: () => Date;
  readonly catalog?: PlanCatalog;
  readonly sync?: SyncService;
  readonly summary?: BillingSummaryService;
}

export class ConfirmCheckoutService {
  private readonly providerFor: (priority: ProviderPriority) => BillingProvider;
  private readonly resolvedMode: () => ResolvedProviderMode;
  private readonly assertEnabled: () => void;
  private readonly now: () => Date;
  private readonly sync: SyncService;
  private readonly summary: BillingSummaryService;

  constructor(deps: ConfirmCheckoutDeps = {}) {
    this.providerFor = deps.providerFor ?? getBillingProvider;
    this.resolvedMode = deps.resolvedMode ?? getProviderMode;
    this.assertEnabled = deps.assertEnabled ?? assertBillingProviderEnabled;
    this.now = deps.now ?? (() => new Date());
    this.sync =
      deps.sync ??
      new SyncService({ providerFor: this.providerFor, resolvedMode: this.resolvedMode, now: this.now, catalog: deps.catalog });
    this.summary =
      deps.summary ?? new BillingSummaryService({ resolvedMode: this.resolvedMode, now: this.now, catalog: deps.catalog });
  }

  async confirm(actor: StrictAuthorizationActor, input: ConfirmCheckoutInput): Promise<ConfirmCheckoutResult> {
    this.assertEnabled();

    const mode = this.resolvedMode();

    if (mode === "DISABLED") throw new BillingUnavailableError();

    const userId = actor.id;
    const log = { userId, mode };

    // Only the caller's own subscriptions, and never one chosen by the browser.
    const pending = await prisma.subscription.findFirst({
      where: {
        userId,
        providerMode: mode,
        phase: "PENDING_AUTHENTICATION",
        providerSubscriptionId: { not: null },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!pending?.providerSubscriptionId) {
      // The webhook may have applied the payment first: that is success, not an error.
      const paid = await prisma.subscription.count({
        where: { userId, providerMode: mode, phase: { in: ["TRIALING", "ACTIVE", "PAST_DUE"] } },
      });

      if (paid > 0) return { ...(await this.summary.getForUser(actor)), signatureValid: null };

      throw new NoPendingCheckoutError();
    }

    const serverHeldId = pending.providerSubscriptionId;
    const provider = this.providerFor(ProviderPriority.CONFIRMATION);
    const signatureValid = provider.verifyCheckoutSignature(input.razorpayPaymentId, serverHeldId, input.razorpaySignature);
    const fields = { ...log, subscriptionId: pending.id };

    if (input.razorpaySubscriptionId !== undefined && input.razorpaySubscriptionId !== serverHeldId) {
      // Signature fields and IDs are never logged; the mismatch itself is the signal.
      logBillingEvent("security.checkout_subscription_mismatch", fields);
    }

    const now = this.now();

    // Either way the row is due: an authoritative fetch decides, not the signature.
    await SyncClaimRepository.markDue(prisma, pending.id, "CHECKOUT_CONFIRM", now, { eventDriven: true, now });

    if (!signatureValid) {
      logBillingEvent("security.checkout_signature_invalid", fields);

      return { ...(await this.summary.getForUser(actor)), signatureValid: false };
    }

    logBillingEvent("checkout.confirmed", fields);

    const synced = await this.sync.syncTargeted(pending.id, ProviderPriority.CONFIRMATION, { trigger: "CHECKOUT_CONFIRM" });

    logBillingEvent("checkout.confirm_synced", { ...fields, outcome: synced.outcome, phase: synced.phase ?? null });

    await this.captureAdvisoryPaymentMethod(pending.id, input.razorpayPaymentId, fields);

    return { ...(await this.summary.getForUser(actor)), signatureValid: true };
  }

  /**
   * UX only (SB-LC-07): the method the customer authenticated with, which
   * predicts whether Razorpay will allow a native plan change. Best effort: a
   * failure leaves it unknown and never blocks the confirmation. The payment
   * ID is trustworthy here because its signature verified.
   */
  private async captureAdvisoryPaymentMethod(subscriptionId: string, paymentId: string, fields: Record<string, unknown>) {
    try {
      const outcome = await this.providerFor(ProviderPriority.CONFIRMATION).fetchAuthorizationPaymentMethod(paymentId);

      if (outcome.kind !== "SUCCESS") {
        logBillingEvent("checkout.payment_method_unavailable", {
          ...fields,
          failureClass: outcome.kind === "FAILURE" ? outcome.failureClass : null,
        });

        return;
      }

      await prisma.subscription.update({
        where: { id: subscriptionId },
        data: {
          advisoryPaymentMethod: outcome.value.method,
          advisoryInternationalCard: outcome.value.international,
        },
      });
    } catch (error) {
      logBillingEvent("checkout.payment_method_unavailable", { ...fields, error: error instanceof Error ? error.message : "unknown" });
    }
  }
}
