import { HttpClient } from "@/lib/http/client";

// Type-only imports from `backend/`: they erase at compile time, so no server
// code reaches the browser bundle.
import type { BillingSummaryDTO } from "../backend/billing-summary.service";
import type { CancelResult } from "../backend/commands/cancel";
import type { ChangePlanResult } from "../backend/commands/change-plan";
import type { ConfirmCheckoutResult } from "../backend/commands/confirm-checkout";
import type { StartCheckoutResult } from "../backend/commands/start-checkout";
import type { RedeemedPromotionDTO } from "../backend/grants/promotion.dto";
import type { CheckNowResult, RecoveryParams } from "../backend/recovery.service";

export type {
  BillingSummaryDTO,
  CancelResult,
  ChangePlanResult,
  CheckNowResult,
  ConfirmCheckoutResult,
  RecoveryParams,
  RedeemedPromotionDTO,
  StartCheckoutResult,
};

export interface RazorpayCheckoutResponse {
  readonly razorpay_payment_id: string;
  readonly razorpay_subscription_id?: string;
  readonly razorpay_signature: string;
}

type PaidPlan = "PRO" | "PRO_PLUS";
type Cycle = "MONTHLY" | "YEARLY";

/**
 * The signed-in user's billing. Every answer is computed on the server —
 * the effective plan, what may be bought, cancelled or changed, whether a
 * checkout is finishing up — and the UI only renders it. It never talks to
 * Razorpay's API: only Razorpay Checkout runs in the browser, opened with the
 * `keyId` the server returns (there is no `NEXT_PUBLIC_RAZORPAY_*`).
 *
 * Every mutating call takes an `idempotencyKey`: one per user click, reused
 * when that click is retried, so a retry returns the same answer.
 */
export class BillingApi {
  static async getSummary(): Promise<BillingSummaryDTO> {
    const response = await HttpClient.get<BillingSummaryDTO>("/api/v1/me/billing");

    return response.data;
  }

  /**
   * Starts (or resumes) a checkout. `trial` and `code` are the only extra
   * intents a client can state; the server decides eligibility, the terms and
   * every provider detail (a code with a trial is refused there, with a reason).
   */
  static async startCheckout(
    input: { plan: PaidPlan; cycle: Cycle; trial?: boolean; code?: string },
    idempotencyKey: string,
  ): Promise<StartCheckoutResult> {
    const response = await HttpClient.post<StartCheckoutResult, typeof input>("/api/v1/me/billing/checkout", input, {
      headers: { "Idempotency-Key": idempotencyKey },
    });

    return response.data;
  }

  /**
   * Starts a new subscription that replaces an on-hold one. Only after the
   * customer confirmed that the old one is cancelled permanently.
   */
  static async supersede(
    input: { plan: PaidPlan; cycle: Cycle; supersedesSubscriptionId: string },
    idempotencyKey: string,
  ): Promise<StartCheckoutResult> {
    const body = { ...input, confirmSupersession: true as const };
    const response = await HttpClient.post<StartCheckoutResult, typeof body>("/api/v1/me/billing/checkout", body, {
      headers: { "Idempotency-Key": idempotencyKey },
    });

    return response.data;
  }

  /** Redeems a promotion code: free access to its plan, decided entirely by the server. No Idempotency-Key: a repeat is a 409. */
  static async redeemPromotion(code: string): Promise<RedeemedPromotionDTO> {
    const response = await HttpClient.post<RedeemedPromotionDTO, { code: string }>("/api/v1/me/billing/promotions/redeem", { code });

    return response.data;
  }

  /** Tells the server Checkout finished. The server verifies it against its own record. */
  static async confirmCheckout(response: RazorpayCheckoutResponse): Promise<ConfirmCheckoutResult> {
    const result = await HttpClient.post<ConfirmCheckoutResult, Record<string, string>>(
      "/api/v1/me/billing/checkout/confirm",
      {
        razorpayPaymentId: response.razorpay_payment_id,
        razorpaySignature: response.razorpay_signature,
        ...(response.razorpay_subscription_id && { razorpaySubscriptionId: response.razorpay_subscription_id }),
      },
    );

    return result.data;
  }

  /** Cancels with the timing the customer was shown and confirmed. */
  static async cancel(timing: "CYCLE_END" | "IMMEDIATE", idempotencyKey: string): Promise<CancelResult> {
    const response = await HttpClient.post<CancelResult, { timing: string }>(
      "/api/v1/me/billing/cancel",
      { timing },
      { headers: { "Idempotency-Key": idempotencyKey } },
    );

    return response.data;
  }

  static async changePlan(input: { plan: PaidPlan; cycle: Cycle }, idempotencyKey: string): Promise<ChangePlanResult> {
    const response = await HttpClient.post<ChangePlanResult, typeof input>("/api/v1/me/billing/change-plan", input, {
      headers: { "Idempotency-Key": idempotencyKey },
    });

    return response.data;
  }

  /** What Razorpay's payment-method change needs, for the caller's on-hold subscription. */
  static async recovery(): Promise<RecoveryParams> {
    const response = await HttpClient.post<RecoveryParams, Record<string, never>>("/api/v1/me/billing/recovery", {});

    return response.data;
  }

  /** "Check now": the server re-reads the subscription from Razorpay and answers with the summary. */
  static async checkNow(): Promise<CheckNowResult> {
    const response = await HttpClient.post<CheckNowResult, Record<string, never>>("/api/v1/me/billing/sync", {});

    return response.data;
  }
}
