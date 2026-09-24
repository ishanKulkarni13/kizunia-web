export const BillingErrorCode = {
  /** No grant with that id exists. */
  GRANT_NOT_FOUND: "ENTITLEMENT_GRANT_NOT_FOUND",

  /** The grant's recipient (by id or email) does not exist. */
  GRANT_RECIPIENT_NOT_FOUND: "ENTITLEMENT_GRANT_RECIPIENT_NOT_FOUND",

  /**
   * An administrator tried to create or extend a grant for themselves
   * (SB-EA-08). Also enforced by a CHECK constraint on `entitlement_grant`:
   * this code is what the caller sees, the constraint is what stops a future
   * write path that forgets.
   */
  SELF_GRANT_FORBIDDEN: "ENTITLEMENT_SELF_GRANT_FORBIDDEN",

  /**
   * The grant has been revoked. Revocation is final: a revoked grant is never
   * extended or revoked again — grant a new one instead.
   */
  GRANT_REVOKED: "ENTITLEMENT_GRANT_REVOKED",

  /** An extension that does not lengthen the grant, or ends in the past. */
  GRANT_EXTENSION_INVALID: "ENTITLEMENT_GRANT_EXTENSION_INVALID",
} as const;

export type BillingErrorCode =
  (typeof BillingErrorCode)[keyof typeof BillingErrorCode];
