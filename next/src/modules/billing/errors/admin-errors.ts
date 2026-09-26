import { ConflictError, HttpStatus, NotFoundError } from "@/lib/errors";

import { BillingErrorCode } from "./error-code";

export class BillingUserNotFoundError extends NotFoundError {
  constructor() {
    super({ code: BillingErrorCode.BILLING_USER_NOT_FOUND, message: "No user matches that id or e-mail address." });
  }
}

export class BillingEventNotFoundError extends NotFoundError {
  constructor() {
    super({ code: BillingErrorCode.BILLING_EVENT_NOT_FOUND, message: "Billing event not found." });
  }
}

export class BillingAnomalyNotFoundError extends NotFoundError {
  constructor() {
    super({ code: BillingErrorCode.ANOMALY_NOT_FOUND, message: "Anomaly not found." });
  }
}

/** The conditional update found the anomaly already resolved: someone (or an observation) got there first. */
export class BillingAnomalyAlreadyResolvedError extends ConflictError {
  constructor() {
    super({
      code: BillingErrorCode.ANOMALY_ALREADY_RESOLVED,
      status: HttpStatus.CONFLICT,
      message: "This anomaly is already resolved.",
    });
  }
}
