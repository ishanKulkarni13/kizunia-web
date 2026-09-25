/**
 * Billing — Command and Checkout Errors (Phase V)
 *
 * Every message is safe to show a customer verbatim: no provider name, status,
 * identifier or raw provider error ever appears in one (SB-PB-04). The
 * provider's own code is stored on the operation for diagnosis only.
 */
import { ConflictError, ExternalServiceError, HttpStatus, ValidationError } from "@/lib/errors";

import type { PlanChangeAdvisory } from "../policy/command-preconditions";

import { BillingErrorCode } from "./error-code";

export class IdempotencyKeyRequiredError extends ValidationError {
  constructor() {
    super({
      code: BillingErrorCode.IDEMPOTENCY_KEY_REQUIRED,
      status: HttpStatus.BAD_REQUEST,
      message: "This request needs an Idempotency-Key header (8–128 letters, digits, '-' or '_').",
    });
  }
}

export class BillingOperationInProgressError extends ConflictError {
  constructor(details?: { operationId: string }) {
    super({
      code: BillingErrorCode.OPERATION_IN_PROGRESS,
      status: HttpStatus.CONFLICT,
      message: "A billing change is already in progress. Try again in a moment.",
      retryable: true,
      details,
    });
  }
}

export class BillingConfirmingError extends ConflictError {
  constructor() {
    super({
      code: BillingErrorCode.CONFIRMING,
      status: HttpStatus.CONFLICT,
      message: "Your last billing change is still being confirmed. Try again shortly.",
      retryable: true,
    });
  }
}

export class CheckoutInProgressError extends ConflictError {
  constructor() {
    super({
      code: BillingErrorCode.CHECKOUT_IN_PROGRESS,
      status: HttpStatus.CONFLICT,
      message: "A checkout for another plan is being set up. Try again in a moment.",
      retryable: true,
    });
  }
}

export class SubscriptionExistsError extends ConflictError {
  constructor(planChange: PlanChangeAdvisory) {
    super({
      code: BillingErrorCode.SUBSCRIPTION_EXISTS,
      status: HttpStatus.CONFLICT,
      message: "You already have an active paid subscription.",
      details: { planChange },
    });
  }
}

export class SupersessionRequiredError extends ConflictError {
  constructor() {
    super({
      code: BillingErrorCode.SUPERSESSION_REQUIRED,
      status: HttpStatus.CONFLICT,
      message: "Your subscription is on hold. Resolve it before starting a new one.",
    });
  }
}

export class BillingContactSupportError extends ConflictError {
  constructor() {
    super({
      code: BillingErrorCode.CONTACT_SUPPORT,
      status: HttpStatus.CONFLICT,
      message: "Your billing needs a quick review. Please contact support.",
    });
  }
}

export class BillingBusyError extends ExternalServiceError {
  constructor() {
    super({
      code: BillingErrorCode.BUSY,
      status: HttpStatus.SERVICE_UNAVAILABLE,
      message: "Billing is temporarily busy. Try again shortly.",
      retryable: true,
    });
  }
}

export class CheckoutFailedError extends ExternalServiceError {
  constructor() {
    super({
      code: BillingErrorCode.CHECKOUT_FAILED,
      status: HttpStatus.BAD_GATEWAY,
      message: "We couldn't start your checkout. Please try again later.",
      retryable: false,
    });
  }
}

export class NoPendingCheckoutError extends ConflictError {
  constructor() {
    super({
      code: BillingErrorCode.NO_PENDING_CHECKOUT,
      status: HttpStatus.CONFLICT,
      message: "There is no checkout waiting to be confirmed.",
    });
  }
}

export class BillingRequestRefusedError extends ConflictError {
  constructor() {
    super({
      code: BillingErrorCode.REQUEST_REFUSED,
      status: HttpStatus.CONFLICT,
      message: "This request was already refused. Start a new one.",
    });
  }
}
