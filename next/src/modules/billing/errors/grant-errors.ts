import {
  ConflictError,
  ForbiddenError,
  HttpStatus,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";

import { BillingErrorCode } from "./error-code";

export class GrantNotFoundError extends NotFoundError {
  constructor() {
    super({
      code: BillingErrorCode.GRANT_NOT_FOUND,
      message: "Entitlement grant not found.",
    });
  }
}

export class GrantRecipientNotFoundError extends NotFoundError {
  constructor() {
    super({
      code: BillingErrorCode.GRANT_RECIPIENT_NOT_FOUND,
      message: "No user matches that recipient.",
    });
  }
}

/** SB-EA-08: administrators can never grant access to themselves. */
export class SelfGrantForbiddenError extends ForbiddenError {
  constructor() {
    super({
      code: BillingErrorCode.SELF_GRANT_FORBIDDEN,
      message:
        "You cannot grant or extend access for yourself. Ask another administrator.",
    });
  }
}

export class GrantRevokedError extends ConflictError {
  constructor() {
    super({
      code: BillingErrorCode.GRANT_REVOKED,
      status: HttpStatus.CONFLICT,
      message:
        "This grant has been revoked. Revocation is final — create a new grant instead.",
    });
  }
}

export class GrantExtensionInvalidError extends ValidationError {
  constructor(message: string) {
    super({
      code: BillingErrorCode.GRANT_EXTENSION_INVALID,
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      message,
    });
  }
}
