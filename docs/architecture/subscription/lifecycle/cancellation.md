# Cancellation

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24

Rulings: [SB-LC-04](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-04--cancellation-defaults-to-end-of-cycle),
[SB-LC-05](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-05--immediate-cancellation-is-an-explicit-adminsupport-action),
[SB-LC-09](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-09--a-requested-cycle-end-cancellation-cannot-be-undone).

---

## Customer cancellation — which kind

| Phase | Provider call | Access |
| --- | --- | --- |
| `ACTIVE`, `PAST_DUE` | `cancel(cancel_at_cycle_end: true)`. **Review flag (TEST 2026-09-24, [A1](../../../project/feature-specification/subscription/open-decisions.md#a-resolved-answered-by-test-verification-2026-09-24)):** for `PAST_DUE` (Razorpay `pending`) Razorpay returns `200` but the subscription is unchanged and no scheduled cancellation can be seen — whether the request is recorded or is a silent no-op is unknown. The design is unchanged; the consequence is that a cycle-end cancel of a `PAST_DUE` subscription cannot be presumed effective, and the `CANCELLATION_NOT_EFFECTIVE` check below is its only backstop. An immediate cancel of a `pending` subscription *is* verified to work | Continues until `current_end` |
| `TRIALING` | `cancel(cancel_at_cycle_end: false)` — Razorpay refuses cycle-end cancellation before the first cycle ([FACT](../provider-boundary/razorpay-facts.md#cancellation)) | Ends immediately; trial eligibility is consumed ([SB-LC-11](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-11--one-trial-per-account)) |
| `PENDING_AUTHENTICATION` | Abandon-checkout (immediate; accepted for `created` in TEST mode — A1) | None to end |
| `HALTED`, `PAUSED` | Immediate (no cycle is running; accepted in TEST mode for both — A1). **Never cycle-end:** Razorpay returns `200` for it on these states but leaves them unchanged | None to end |
| Terminal | Refused | — |

A pending scheduled plan change is cancelled first
([SB-LC-08](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-08--at-most-one-scheduled-change-and-cancellation-always-wins)).

## Cycle-end cancellation

```text
command CANCEL_AT_CYCLE_END  (BillingOperation, one in flight per user)
  cancel(sub, { cancel_at_cycle_end: true })
    -> SUCCEEDED: Subscription.cancelAtPeriodEnd = true, requested by this operation
       (Razorpay documents no field or webhook for a pending cycle-end cancellation, and TEST mode
        confirmed the entity shows none — A2, 2026-09-24 — so Kizunia's own record is the source of
        "ends on <date>")
  user keeps access through current_end
  at current_end Razorpay moves the subscription to cancelled; subscription.cancelled fires
  the webhook sync (or the current_end checkpoint sync if the webhook is missed) sets CANCELLED
  effective access falls to the next-highest source, or FREE
```

**No undo.** Razorpay documents no way to revoke a requested cycle-end cancellation; the UI says so
before the user confirms ([SB-LC-09](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-09--a-requested-cycle-end-cancellation-cannot-be-undone)).

## Immediate cancellation — admin/support

```text
command CANCEL_IMMEDIATELY (actor = admin, reason required)
  cancel(sub, { cancel_at_cycle_end: false })
  response applied through the guarded apply path -> CANCELLED -> access ends
```

Used for support cases, account removal ([SB-DP-04](../../../project/feature-specification/subscription/decisions/data-preservation.md#sb-dp-04--billing-records-survive-account-removal)),
anomaly resolution and supersession. Refunds, if any, are issued in the Razorpay Dashboard; Kizunia
records the resulting refund fact but never computes or issues one in V1.

## Failures and races

| Situation | Behavior |
| --- | --- |
| Cancel response lost (timeout) | `OUTCOME_UNKNOWN`. Immediate: the next sync shows `cancelled` or not. Cycle-end: not observable until `current_end`; the user may re-issue it — verified harmless in TEST mode: a repeat returns `200` and changes nothing observable ([A14](../../../project/feature-specification/subscription/open-decisions.md#a-resolved-answered-by-test-verification-2026-09-24)) |
| Repeated cancel requests | Same idempotency key → same result; a new key while one is in flight → refused; after success → "already cancelling" from local state, no provider call |
| Cancel while an upgrade is in flight | Refused until the upgrade operation resolves (one in flight per user) |
| Dashboard or UPI-app cancellation | Observed through `subscription.cancelled` / sync; applied identically; history cause `provider_observed` ([`dashboard-originated-changes.md`](dashboard-originated-changes.md)) |
| Local says cancelling at period end, Razorpay still `active` after `current_end` + margin | The checkpoint sync shows the truth (still active); `cancelAtPeriodEnd` is cleared and a `CANCELLATION_NOT_EFFECTIVE` anomaly is raised — the user is still being billed and must be told |
| Resubscribing after cancellation | Ordinary purchase once the old Subscription is `CANCELLED` ([`multiple-subscriptions.md`](multiple-subscriptions.md)) |

## Cancellation never deletes data

Reaching `CANCELLED` is a phase transition on the existing record, never a deletion — see
[`../../../project/feature-specification/subscription/data-preservation.md`](../../../project/feature-specification/subscription/data-preservation.md).
