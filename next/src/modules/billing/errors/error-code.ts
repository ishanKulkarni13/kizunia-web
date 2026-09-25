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

  // -- Commands and checkout (Phase V) --------------------------------------

  /** A mutating billing request arrived without a valid `Idempotency-Key` header. */
  IDEMPOTENCY_KEY_REQUIRED: "BILLING_IDEMPOTENCY_KEY_REQUIRED",

  /** Another billing change for this user is in flight (the per-user slot, IB-6). */
  OPERATION_IN_PROGRESS: "BILLING_OPERATION_IN_PROGRESS",

  /** The user's last billing change is still being confirmed (a young `OUTCOME_UNKNOWN` operation). */
  CONFIRMING: "BILLING_CONFIRMING",

  /** A checkout for another plan or cycle is being set up. */
  CHECKOUT_IN_PROGRESS: "BILLING_CHECKOUT_IN_PROGRESS",

  /**
   * A paid subscription is live (`TRIALING`, `ACTIVE`, `PAST_DUE`): a second
   * purchase is refused (SB-UQ-03). `details.planChange` says, advisorily,
   * whether a native plan change may be offered (SB-LC-07).
   */
  SUBSCRIPTION_EXISTS: "BILLING_SUBSCRIPTION_EXISTS",

  /** The subscription is `HALTED` or `PAUSED`: only supersession (Phase VI) can replace it. */
  SUPERSESSION_REQUIRED: "BILLING_SUPERSESSION_REQUIRED",

  /** An open multiple-subscriptions anomaly: self-serve billing is paused for this user. */
  CONTACT_SUPPORT: "BILLING_CONTACT_SUPPORT",

  /** The provider request budget or cooldown refused the call; nothing was sent. */
  BUSY: "BILLING_BUSY",

  /** The provider refused to create the subscription. */
  CHECKOUT_FAILED: "BILLING_CHECKOUT_FAILED",

  /** Checkout confirmation, but the caller has no checkout awaiting authentication. */
  NO_PENDING_CHECKOUT: "BILLING_NO_PENDING_CHECKOUT",

  /** A retry of a request that was refused; the recorded refusal is returned, never re-executed. */
  REQUEST_REFUSED: "BILLING_REQUEST_REFUSED",
} as const;

export type BillingErrorCode =
  (typeof BillingErrorCode)[keyof typeof BillingErrorCode];
