/**
 * Billing — Command and Checkout Errors (Phase V)
 *
 * Every message is safe to show a customer verbatim: no provider name, status,
 * identifier or raw provider error ever appears in one (SB-PB-04). The
 * provider's own code is stored on the operation for diagnosis only.
 */
import { ConflictError, ExternalServiceError, HttpStatus, ValidationError } from "@/lib/errors";

import type { CancelTiming, PlanChangeAdvisory } from "../policy/command-preconditions";
import type { PlanChangeUnavailableReason } from "../policy/plan-change-strategy";

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
      message: "Your subscription is on hold. Update your payment method to resume it, or confirm replacing it with a new subscription.",
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

// -- Lifecycle commands (Phase VI) ------------------------------------------

export class NoSubscriptionError extends ConflictError {
  constructor() {
    super({
      code: BillingErrorCode.NO_SUBSCRIPTION,
      status: HttpStatus.CONFLICT,
      message: "You don't have a paid subscription this change applies to.",
    });
  }
}

export class CancellationTimingChangedError extends ConflictError {
  constructor(timing: CancelTiming) {
    super({
      code: BillingErrorCode.CANCELLATION_TIMING_CHANGED,
      status: HttpStatus.CONFLICT,
      message: "Your subscription changed since this page loaded. Review the cancellation again before confirming.",
      details: { timing },
    });
  }
}

export class CancellationFailedError extends ExternalServiceError {
  constructor() {
    super({
      code: BillingErrorCode.CANCELLATION_FAILED,
      status: HttpStatus.BAD_GATEWAY,
      message: "We couldn't cancel your subscription right now. Nothing changed. Please try again later or contact support.",
      retryable: false,
    });
  }
}

export class CancellationRequestedError extends ConflictError {
  constructor() {
    super({
      code: BillingErrorCode.CANCELLATION_REQUESTED,
      status: HttpStatus.CONFLICT,
      message: "Your subscription is set to end. You can choose a new plan once it has ended.",
    });
  }
}

export class SupersessionCancelRefusedError extends ConflictError {
  constructor() {
    super({
      code: BillingErrorCode.SUPERSESSION_CANCEL_REFUSED,
      status: HttpStatus.CONFLICT,
      message: "We couldn't end your on-hold subscription, so no new one was started. Update your payment method to resume it instead.",
      details: { recovery: true },
    });
  }
}

export class SupersessionNotApplicableError extends ConflictError {
  constructor() {
    super({
      code: BillingErrorCode.SUPERSESSION_NOT_APPLICABLE,
      status: HttpStatus.CONFLICT,
      message: "That subscription is no longer on hold. Refresh the page to see your current plan.",
    });
  }
}

export class PlanChangeUnavailableError extends ConflictError {
  constructor(reason: PlanChangeUnavailableReason | "PROVIDER_REFUSED") {
    super({
      code: BillingErrorCode.PLAN_CHANGE_UNAVAILABLE,
      status: HttpStatus.CONFLICT,
      message: "This plan change isn't available for your subscription.",
      details: { reason },
    });
  }
}

export class SamePlanError extends ConflictError {
  constructor() {
    super({
      code: BillingErrorCode.SAME_PLAN,
      status: HttpStatus.CONFLICT,
      message: "You're already on this plan.",
    });
  }
}

export class NotRecoverableError extends ConflictError {
  constructor() {
    super({
      code: BillingErrorCode.NOT_RECOVERABLE,
      status: HttpStatus.CONFLICT,
      message: "Your subscription doesn't need a payment update.",
    });
  }
}

export class SubscriptionNotCancellableError extends ConflictError {
  constructor() {
    super({
      code: BillingErrorCode.SUBSCRIPTION_NOT_CANCELLABLE,
      status: HttpStatus.CONFLICT,
      message: "This subscription can't be cancelled: it is still being set up, or it has already ended.",
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
