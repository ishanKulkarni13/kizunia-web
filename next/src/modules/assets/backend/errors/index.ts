import {
  ConflictError,
  ForbiddenError,
  HttpStatus,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";

export const AssetErrorCode = {
  NOT_FOUND: "ASSET_NOT_FOUND",
  NOT_ACTIVE: "ASSET_NOT_ACTIVE",
  CATEGORY_MISMATCH: "ASSET_CATEGORY_MISMATCH",
  INTENT_NOT_FOUND: "UPLOAD_INTENT_NOT_FOUND",
  INTENT_ACTOR_MISMATCH: "UPLOAD_INTENT_ACTOR_MISMATCH",
  INTENT_EXPIRED: "UPLOAD_INTENT_EXPIRED",
  INTENT_ALREADY_CONSUMED: "UPLOAD_INTENT_ALREADY_CONSUMED",
  POLICY_VIOLATION: "ASSET_POLICY_VIOLATION",
  PROVIDER_OBJECT_NOT_FOUND: "PROVIDER_OBJECT_NOT_FOUND",
  NOT_DOWNLOADABLE: "ASSET_NOT_DOWNLOADABLE",
} as const;

export class AssetNotFoundError extends NotFoundError {
  constructor(message = "Asset not found.") {
    super({ code: AssetErrorCode.NOT_FOUND, message });
  }
}

/**
 * The storage provider has confirmed there is no object for a given
 * reference (e.g. an UploadIntent's correlation id) — distinct from
 * `ExternalServiceError`, which means the provider could not be asked at
 * all. Callers that only catch this specific error (rather than any
 * thrown error) can safely tell "confirmed absent" apart from "transient
 * provider failure" — see AssetReconciliationService.sweepAbandonedIntents.
 */
export class ProviderObjectNotFoundError extends NotFoundError {
  constructor(
    message = "The storage provider has no object for this reference.",
  ) {
    super({ code: AssetErrorCode.PROVIDER_OBJECT_NOT_FOUND, message });
  }
}

/**
 * The admin download route refuses to mint a delivery URL for a `DELETED`
 * Asset — the provider object is gone (or on its way out), so there is
 * nothing left to fetch. See AssetAdminService.getDownloadTarget.
 */
export class AssetNotDownloadableError extends ConflictError {
  constructor(message = "This asset has been deleted and can no longer be downloaded.") {
    super({
      code: AssetErrorCode.NOT_DOWNLOADABLE,
      status: HttpStatus.CONFLICT,
      message,
    });
  }
}

export class AssetNotActiveError extends ValidationError {
  constructor(message = "This asset is no longer active.") {
    super({
      code: AssetErrorCode.NOT_ACTIVE,
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      message,
    });
  }
}

export class AssetCategoryMismatchError extends ValidationError {
  constructor(message = "This asset's category does not match the requested purpose.") {
    super({
      code: AssetErrorCode.CATEGORY_MISMATCH,
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      message,
    });
  }
}

export class UploadIntentNotFoundError extends NotFoundError {
  constructor(message = "Upload intent not found.") {
    super({ code: AssetErrorCode.INTENT_NOT_FOUND, message });
  }
}

export class UploadIntentActorMismatchError extends ForbiddenError {
  constructor(message = "This upload intent does not belong to the current actor.") {
    super({ code: AssetErrorCode.INTENT_ACTOR_MISMATCH, message });
  }
}

export class UploadIntentExpiredError extends ConflictError {
  constructor(message = "This upload intent has expired.") {
    super({
      code: AssetErrorCode.INTENT_EXPIRED,
      status: HttpStatus.CONFLICT,
      message,
    });
  }
}

export class UploadIntentAlreadyConsumedError extends ConflictError {
  constructor(message = "This upload intent has already been used.") {
    super({
      code: AssetErrorCode.INTENT_ALREADY_CONSUMED,
      status: HttpStatus.CONFLICT,
      message,
    });
  }
}

export class UploadPolicyViolationError extends ValidationError {
  constructor(message: string) {
    super({
      code: AssetErrorCode.POLICY_VIOLATION,
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      message,
    });
  }
}
