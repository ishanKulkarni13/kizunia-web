import { ExternalServiceError, HttpStatus } from "@/lib/errors";

import { BillingErrorCode } from "./error-code";

/**
 * Paid billing cannot be used right now because no payment provider is
 * configured (provider mode `disabled`, SB-PB-03).
 *
 * Shaped as an external-service failure on purpose: the request was well
 * formed and may well succeed once billing is enabled, so it is a 503 the
 * client may retry later, never a 4xx blaming the caller and never a generic
 * 500. The message is safe to show a customer verbatim and says nothing about
 * why: credentials, mode and provider names stay out of it.
 *
 * Checkout and every subscription command (Phase V onward) raise it through
 * `assertBillingProviderEnabled()` before doing any work, so nothing is sent
 * to the provider and no local row is written.
 */
export class BillingUnavailableError extends ExternalServiceError {
  constructor() {
    super({
      code: BillingErrorCode.BILLING_UNAVAILABLE,
      status: HttpStatus.SERVICE_UNAVAILABLE,
      message: "Paid subscriptions are temporarily unavailable.",
      retryable: true,
    });
  }
}
