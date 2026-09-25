import { ConflictError, HttpStatus, NotFoundError } from "@/lib/errors";

import { BillingErrorCode } from "./error-code";

export class SubscriptionNotFoundError extends NotFoundError {
  constructor() {
    super({ code: BillingErrorCode.SUBSCRIPTION_NOT_FOUND, message: "Subscription not found." });
  }
}

/** Another worker is syncing this subscription right now; its result will apply. */
export class BillingSyncInProgressError extends ConflictError {
  constructor() {
    super({
      code: BillingErrorCode.BILLING_SYNC_IN_PROGRESS,
      status: HttpStatus.CONFLICT,
      message: "This subscription is being synchronized already. Try again shortly.",
      retryable: true,
    });
  }
}

/** The subscription has no provider subscription yet (it is still being created), so there is nothing to fetch. */
export class SubscriptionNotSyncableError extends ConflictError {
  constructor() {
    super({
      code: BillingErrorCode.SUBSCRIPTION_NOT_SYNCABLE,
      status: HttpStatus.CONFLICT,
      message: "This subscription has no provider subscription to synchronize yet.",
    });
  }
}
