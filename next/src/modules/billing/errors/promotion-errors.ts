/**
 * Billing — Promotion Errors (Phase VII)
 *
 * Messages are safe to show verbatim. A code that is unknown, not yet valid or
 * expired is one error, so a probe learns nothing about codes that are not
 * usable now (IB-27 item 12).
 */
import { ConflictError, HttpStatus, ValidationError } from "@/lib/errors";

import { BillingErrorCode } from "./error-code";

export class PromotionCodeInvalidError extends ValidationError {
  constructor() {
    super({
      code: BillingErrorCode.PROMOTION_CODE_INVALID,
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      message: "That code isn't valid.",
    });
  }
}

export class PromotionNotEligibleError extends ValidationError {
  constructor() {
    super({
      code: BillingErrorCode.PROMOTION_NOT_ELIGIBLE,
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      message: "That code isn't available for your account.",
    });
  }
}

export class PromotionAlreadyRedeemedError extends ConflictError {
  constructor() {
    super({
      code: BillingErrorCode.PROMOTION_ALREADY_REDEEMED,
      status: HttpStatus.CONFLICT,
      message: "You've already redeemed that code.",
    });
  }
}

export class PromotionSoldOutError extends ConflictError {
  constructor() {
    super({
      code: BillingErrorCode.PROMOTION_SOLD_OUT,
      status: HttpStatus.CONFLICT,
      message: "That code has been fully redeemed.",
    });
  }
}

export class PromotionCodeTakenError extends ConflictError {
  constructor() {
    super({
      code: BillingErrorCode.PROMOTION_CODE_TAKEN,
      status: HttpStatus.CONFLICT,
      message: "That code is already in use. Choose a different code.",
    });
  }
}
