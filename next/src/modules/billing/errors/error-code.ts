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

  /** The subscription is `HALTED` or `PAUSED`: only an explicitly confirmed supersession (Phase VI) can replace it. */
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

  // -- Lifecycle commands (Phase VI) ----------------------------------------

  /** The user has no subscription this command can act on (none open, or only one being set up). */
  NO_SUBSCRIPTION: "BILLING_NO_SUBSCRIPTION",

  /**
   * The cancellation timing the customer confirmed is no longer the one that
   * applies (the subscription changed phase meanwhile; IB-26 item 2).
   * `details.timing` is the current one. Nothing was sent.
   */
  CANCELLATION_TIMING_CHANGED: "BILLING_CANCELLATION_TIMING_CHANGED",

  /** The provider refused the cancellation; nothing changed. */
  CANCELLATION_FAILED: "BILLING_CANCELLATION_FAILED",

  /** A cycle-end cancellation is requested: the subscription is ending, so its plan can no longer change. */
  CANCELLATION_REQUESTED: "BILLING_CANCELLATION_REQUESTED",

  /** Supersession: the provider refused to cancel the on-hold subscription, so nothing was created. Use recovery. */
  SUPERSESSION_CANCEL_REFUSED: "BILLING_SUPERSESSION_CANCEL_REFUSED",

  /** Supersession was asked for a subscription that is not (or no longer) on hold and replaceable. */
  SUPERSESSION_NOT_APPLICABLE: "BILLING_SUPERSESSION_NOT_APPLICABLE",

  /**
   * The plan change cannot be made for this subscription: the V1 limitation
   * for its payment method, its state, a missing price, or Razorpay's own
   * refusal (`details.reason`). Never retried, never worked around (SB-LC-07).
   */
  PLAN_CHANGE_UNAVAILABLE: "BILLING_PLAN_CHANGE_UNAVAILABLE",

  /** The requested plan and cycle are the ones the subscription is already on. */
  SAME_PLAN: "BILLING_SAME_PLAN",

  /** Recovery (a payment-method change) is offered only for a halted or paused subscription. */
  NOT_RECOVERABLE: "BILLING_NOT_RECOVERABLE",

  /** Admin cancel: the subscription is still being set up, or has already ended. */
  SUBSCRIPTION_NOT_CANCELLABLE: "BILLING_SUBSCRIPTION_NOT_CANCELLABLE",
} as const;

export type BillingErrorCode =
  (typeof BillingErrorCode)[keyof typeof BillingErrorCode];
