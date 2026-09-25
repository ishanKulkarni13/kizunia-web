import { HttpClient } from "@/lib/http/client";

// Type-only imports from `backend/`: they erase at compile time, so no server
// code reaches the browser bundle.
import type { BillingSummaryDTO } from "../backend/billing-summary.service";
import type { ConfirmCheckoutResult } from "../backend/commands/confirm-checkout";
import type { StartCheckoutResult } from "../backend/commands/start-checkout";

export type { BillingSummaryDTO, ConfirmCheckoutResult, StartCheckoutResult };

export interface RazorpayCheckoutResponse {
  readonly razorpay_payment_id: string;
  readonly razorpay_subscription_id?: string;
  readonly razorpay_signature: string;
}

/**
 * The signed-in user's billing. Every answer is computed on the server —
 * the effective plan, what may be bought, whether a checkout is finishing
 * up — and the UI only renders it. It never talks to Razorpay's API: only
 * Razorpay Checkout runs in the browser, opened with the `keyId` the server
 * returns (there is no `NEXT_PUBLIC_RAZORPAY_*`).
 */
export class BillingApi {
  static async getSummary(): Promise<BillingSummaryDTO> {
    const response = await HttpClient.get<BillingSummaryDTO>("/api/v1/me/billing");

    return response.data;
  }

  /**
   * Starts (or resumes) a checkout. `idempotencyKey` is one per user click:
   * retrying that click with the same key returns the same checkout rather
   * than starting another.
   */
  static async startCheckout(
    input: { plan: "PRO" | "PRO_PLUS"; cycle: "MONTHLY" | "YEARLY" },
    idempotencyKey: string,
  ): Promise<StartCheckoutResult> {
    const response = await HttpClient.post<StartCheckoutResult, typeof input>("/api/v1/me/billing/checkout", input, {
      headers: { "Idempotency-Key": idempotencyKey },
    });

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
}
