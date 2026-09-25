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

  /**
   * Paid billing is unavailable because no payment provider is configured
   * (provider mode `disabled`, SB-PB-03). Free, grants and every entitlement
   * gate keep working; only starting or changing a paid subscription is
   * refused. Returned as HTTP 503.
   */
  BILLING_UNAVAILABLE: "BILLING_UNAVAILABLE",

  /** No subscription with that id exists. */
  SUBSCRIPTION_NOT_FOUND: "BILLING_SUBSCRIPTION_NOT_FOUND",

  /** Another worker is synchronizing the subscription right now; its result will apply. */
  BILLING_SYNC_IN_PROGRESS: "BILLING_SYNC_IN_PROGRESS",

  /** The subscription has no provider subscription to fetch yet (still being created). */
  SUBSCRIPTION_NOT_SYNCABLE: "BILLING_SUBSCRIPTION_NOT_SYNCABLE",
} as const;

export type BillingErrorCode =
  (typeof BillingErrorCode)[keyof typeof BillingErrorCode];
