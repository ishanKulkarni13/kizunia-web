# Checkout and Creation

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24

How a user goes from Free to a paid or trial Subscription, and what happens at every point where
that can fail. Rulings: [SB-UQ-01–03](../../../project/feature-specification/subscription/decisions/uniqueness-and-resubscription.md),
[SB-CM-02–06](../../../project/feature-specification/subscription/decisions/commands-and-idempotency.md),
[SB-LC-10–11](../../../project/feature-specification/subscription/decisions/lifecycle.md).

---

## Happy path

```text
Browser                         Kizunia                                   Razorpay
  | POST /billing/checkout        |                                           |
  |  { plan, cycle, code?,        |                                           |
  |    Idempotency-Key }  ------> | 1. idempotency lookup (userId, key)       |
  |                               | 2. tx: BillingOperation(IN_FLIGHT)        |
  |                               |        preconditions (open subs, trial    |
  |                               |        eligibility, code eligibility)     |
  |                               |        Subscription(PROVISIONING,         |
  |                               |          kind, mode, plan, cycle)         |
  |                               | 3. budget slot (priority 1)               |
  |                               | 4. create(plan_id, total_count,           |
  |                               |      start_at?, expire_by, offer_id?,     |
  |                               |      notes{kz_sub, kz_op, kz_env}) -----> |
  |                               |                           <-- sub_xxx, created, short_url
  |                               | 5. tx: bind providerSubscriptionId,       |
  |                               |        apply entity -> PENDING_AUTHENTICATION,
  |                               |        operation SUCCEEDED                |
  | <------ checkout params ------|                                           |
  | Razorpay Checkout (mandate / UPI / card authentication) ----------------> |
  | <-- payment_id, subscription_id, signature                                |
  | POST /billing/checkout/confirm|                                           |
  |  { payment_id, signature } -> | 6. verify signature against the           |
  |                               |    server-held subscription id            |
  |                               | 7. mark sync-due, immediate sync -------> | fetch
  |                               |                          <-- authenticated / active
  |                               | 8. apply: TRIALING / ACTIVE               |
  | <------ new access ---------- |                                           |
  |                               |          (in parallel) subscription.authenticated /
  |                               | <------- activated / charged webhooks --- |
  |                               | 9. dedupe, mark sync-due, after(): sync   |
  |                               |    (stale-apply guard makes 8/9 order-free)
```

- `total_count` is a large configured value per interval (Razorpay requires one; the upper limit
  Razorpay accepts is to be confirmed in TEST mode), so reaching `completed` is rare. If a
  subscription does complete, it is terminal like any other and is observed by the due sync at its
  final `current_end`. `expire_by` is set to a short checkout horizon
  ([C5](../../../project/feature-specification/subscription/open-decisions.md#c-implementation-time-configuration)).
- `notes` carry only `kz_sub` (Kizunia Subscription ID), `kz_op` (operation ID) and `kz_env`
  (provider mode) — opaque identifiers, no personal data.
- `start_at` is sent only for `kind = TRIAL` (trial end). Kizunia never sends a future `start_at` for
  a `STANDARD` subscription.
- `customer_notify` stays at Razorpay's default (`true`): Razorpay sends payment and failure
  communications, including the halted-recovery link. Kizunia does not duplicate them.
- Steps 6–8 exist only for latency. If the browser never calls confirm (tab closed, network lost),
  step 9 or a due sync produces the same result.

## Reuse and uniqueness at step 2

Preconditions run inside the transaction that holds the user's in-flight operation, so two tabs cannot
both pass them:

| User's open Subscriptions | Result of a checkout request |
| --- | --- |
| None | Proceed |
| `PROVISIONING`, same plan/cycle | Return the existing operation ("still being set up") |
| `PENDING_AUTHENTICATION`, same plan/cycle, `expire_by` not passed | Return the existing checkout parameters — no new provider object |
| `PENDING_AUTHENTICATION`, other plan/cycle or expired | Composed command: cancel it (confirmed by sync), then proceed. Razorpay accepted an immediate cancel of a `created` subscription in TEST mode ([A1, verified 2026-09-24](../../../project/feature-specification/subscription/open-decisions.md#a-resolved-answered-by-test-verification-2026-09-24)); if it ever refuses, the new checkout waits until the old one's `expire_by` has passed **and been observed** (a `created` subscription can read `created` for up to ~3 minutes after `expire_by`, [A8](../../../project/feature-specification/subscription/open-decisions.md#a-resolved-answered-by-test-verification-2026-09-24)); the user may continue the old checkout meanwhile |
| `TRIALING`, `ACTIVE`, `PAST_DUE` | Refused — see [SB-UQ-03](../../../project/feature-specification/subscription/decisions/uniqueness-and-resubscription.md#sb-uq-03--a-new-purchase-while-a-paid-subscription-is-live-is-refused-not-duplicated) |
| `HALTED`, `PAUSED` | Refused unless the request carries the user's supersession confirmation — see [`../lifecycle/multiple-subscriptions.md`](../lifecycle/multiple-subscriptions.md#supersession) |

## Failure matrix

Every row states what the user sees, what Kizunia's records say, and how the situation resolves.
"Sync-due" means the Subscription is picked up by [the sync mechanism](../reconciliation/sync-mechanism.md).

| # | Failure | Local state afterwards | User sees | Resolution |
| --- | --- | --- | --- | --- |
| 1 | Double click / client retry (same idempotency key) | One operation, one Subscription | The same checkout | Idempotency lookup |
| 2 | Two tabs / two devices (different keys) | One operation wins the in-flight constraint; the other is refused or given the existing checkout | Same checkout, or "already in progress" | In-flight constraint + natural-key reuse |
| 3 | Budget unavailable or global cooldown at step 3 | Operation `REJECTED(BUDGET_EXHAUSTED)`; Subscription `ABANDONED` | "Billing is temporarily busy, try again shortly" | Nothing sent; user retries |
| 4 | Razorpay rejects the create (4xx: bad plan, expired offer…) | Operation `REJECTED`; Subscription `ABANDONED` | Specific, non-raw error | None needed; alert on unexpected codes (e.g. unknown plan = catalog misconfiguration) |
| 5 | Timeout / 5xx / connection reset at step 4 | Operation `OUTCOME_UNKNOWN`; Subscription `PROVISIONING` without provider ID | "We're confirming your checkout" | Orphan discovery or a webhook matches `notes.kz_sub` and binds it; else `ABANDONED` after the window. **Never re-sent** |
| 6 | Razorpay created it, Kizunia crashed before step 5 | As #5 (operation `IN_FLIGHT` until lease expiry, then `OUTCOME_UNKNOWN`) | Same as #5 on reload | Same as #5 |
| 7 | Step 5 transaction fails (DB error) after a successful create | As #5 | Same as #5 | Same as #5 — the provider ID is recoverable from `notes` |
| 8 | Response to the browser lost after step 5 | Correct (`PENDING_AUTHENTICATION`) | Retry returns the same checkout (#1/#2) | Idempotency/natural key |
| 9 | User abandons Razorpay Checkout | `PENDING_AUTHENTICATION` | Can resume the same checkout until `expire_by` | Due sync at `expire_by` + margin observes `expired`/`created`; an unexpired stale checkout is cancelled when the user next starts a different one |
| 10 | Checkout succeeds but confirm call never arrives | `PENDING_AUTHENTICATION` until a sync | Access within seconds of the webhook's `after()` sync, or at the next tick | Webhook / due sync |
| 11 | Confirm arrives with a bad signature | Unchanged | "We couldn't verify the payment yet" | The subscription is still marked sync-due (the signature failure is logged as a security event); an authoritative fetch decides, not the signature |
| 12 | Confirm arrives before Razorpay reports `authenticated` | Unchanged (`PENDING_AUTHENTICATION`) | "Finishing up…" with a short client poll of Kizunia (never of Razorpay) | Next webhook/sync |
| 13 | Webhook arrives before step 5 (fast authentication) | Event persisted; no local row has the provider ID yet → matched through `notes.kz_sub` to the `PROVISIONING` record, bound, marked sync-due | No effect | [SB-WH-06](../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md#sb-wh-06--events-for-unknown-subscriptions-are-persisted-and-matched-never-dropped) |
| 14 | Webhooks disabled at Razorpay (24 h of failures) | Stays `PENDING_AUTHENTICATION` if confirm also failed | Delayed access | Due sync at the checkpoint; `WEBHOOK_SILENCE` alert (see [`../cross-cutting/observability.md`](../cross-cutting/observability.md)) |
| 15 | Provider mode changed between steps (redeploy with other keys) | Record carries the old mode | Checkout fails at Razorpay | Mode mismatch → not synced; `PROVIDER_MODE_MISMATCH` anomaly |
| 16 | First real charge fails after a trial | `PAST_DUE` (still contributes), then `HALTED` | Payment-failing notice | Razorpay's retry lifecycle ([SB-PF-02](../../../project/feature-specification/subscription/decisions/payment-failure-and-recovery.md#sb-pf-02--pending-retains-full-paid-access)); [open item A7](../../../project/feature-specification/subscription/open-decisions.md#a-razorpay-behavior-requiring-test-mode-verification-or-support) |

## Trials

A trial checkout is the same flow with `kind = TRIAL` and `start_at` = trial end, after the eligibility
check of [SB-LC-11](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-11--one-trial-per-account).
Razorpay charges ₹5 at authentication and refunds it automatically. See
[`../lifecycle/trials.md`](../lifecycle/trials.md).

## Offers and codes

A code is resolved and its eligibility rule evaluated at step 2
([SB-CP-04](../../../project/feature-specification/subscription/decisions/coupons-and-promotions.md#sb-cp-04--code-eligibility-is-checked-against-the-users-own-history-and-redemption-is-atomic));
the resulting `offer_id` is sent at step 4 and the code is stored on the Subscription. See
[`../entitlements/coupons-and-offers.md`](../entitlements/coupons-and-offers.md).
