# State Mapping

> **Status:** Implemented in Phase IV (2026-09-25): `modules/billing/policy/state-mapping.ts`
>
> **Last Updated:** 2026-09-24

Razorpay's documented states (see
[`../provider-boundary/razorpay-facts.md`](../provider-boundary/razorpay-facts.md#lifecycle-states))
mapped to Kizunia's own `Subscription.phase`. The mapping is applied in exactly one place — the sync
apply path ([`../reconciliation/sync-mechanism.md`](../reconciliation/sync-mechanism.md#applying-an-observation)).

---

## Phases

| Kizunia phase | Open? | Contributes to effective access? | Meaning |
| --- | --- | --- | --- |
| `PROVISIONING` | Yes | No | Local record written; provider creation not yet confirmed ([SB-CM-02](../../../project/feature-specification/subscription/decisions/commands-and-idempotency.md#sb-cm-02--the-local-record-is-written-before-the-provider-call)) |
| `PENDING_AUTHENTICATION` | Yes | No | Provider subscription exists; checkout not completed |
| `TRIALING` | Yes | **Yes** — the trial's plan | A `TRIAL` subscription, authenticated, before `start_at` |
| `ACTIVE` | Yes | **Yes** | Billing normally |
| `PAST_DUE` | Yes | **Yes** ([SB-PF-02](../../../project/feature-specification/subscription/decisions/payment-failure-and-recovery.md#sb-pf-02--pending-retains-full-paid-access)) | A charge failed; Razorpay is retrying |
| `HALTED` | Yes | No ([SB-PF-03](../../../project/feature-specification/subscription/decisions/payment-failure-and-recovery.md#sb-pf-03--halted-ends-paid-access-but-never-cancels-the-subscription)) | Retries exhausted; recoverable |
| `PAUSED` | Yes | No | Paused (Dashboard or the customer's UPI app) |
| `CANCELLED` | No — terminal | No | Cancelled |
| `EXPIRED` | No — terminal | No | Never authenticated in time |
| `COMPLETED` | No — terminal | No | All cycles billed |
| `ABANDONED` | No — terminal | No | Local-only: creation never happened at Razorpay (outcome-unknown create resolved as not applied) |

## The mapping

| Razorpay status | Condition | Kizunia phase |
| --- | --- | --- |
| *(no provider ID yet)* | — | `PROVISIONING` (only ever set by creation; left by binding or `ABANDONED`) |
| `created` | — | `PENDING_AUTHENTICATION` |
| `authenticated` | `kind = TRIAL` and `start_at` in the future | `TRIALING` |
| `authenticated` | `kind = TRIAL`, `start_at` passed, within the trial-conversion grace (`now < start_at + C7`) | `TRIALING` (conversion pending; see below) |
| `authenticated` | otherwise (`STANDARD`; or a trial past `start_at + C7` with no first charge reported) | `PENDING_AUTHENTICATION`; past the grace a `TRIAL_CONVERSION_OVERDUE` anomaly is raised |
| `active` | — | `ACTIVE` |
| `pending` | — | `PAST_DUE` |
| `halted` | — | `HALTED` |
| `paused` | — | `PAUSED` |
| `cancelled` | — | `CANCELLED` |
| `expired` | — | `EXPIRED` |
| `completed` | — | `COMPLETED` |
| anything else | — | **not applied** — `MALFORMED`; last known phase kept ([failure taxonomy](../reconciliation/provider-rate-limits.md#provider-failure-taxonomy)) |

Plan and cycle come from the per-mode plan catalog; an unknown Razorpay plan ID is not applied either
([SB-PB-05](../../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-05--provider-plan-ids-map-to-kizunia-plans-through-a-per-mode-catalog-many-to-one)).

## Why `TRIALING` needs `kind`, not just `start_at`

Razorpay has no trial object — a trial is simply `authenticated` with a future `start_at`. Inferring
a trial from that shape would grant access to any future-start subscription, including one created
in the Dashboard. Only a Subscription Kizunia itself created as `TRIAL` can be `TRIALING`
([SB-LC-10](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-10--subscription-kind-is-recorded-at-creation-never-inferred)).

**Trial conversion (decided 2026-09-24, architecture decision (autonomous),
[IB-9](../implementation/open-decisions.md#ib-9--trial-conversion-gap)).** Until 2026-09-24 a trial
still `authenticated` after `start_at` mapped straight to `PENDING_AUTHENTICATION`, so a converting
user would lose access while Razorpay was slow to run the first charge. [TEST-OBSERVED] 47 minutes
after `start_at` a trial was still `authenticated` (A7). The mapping now keeps it `TRIALING` for a
bounded conversion grace (configuration C7); past it, it stops contributing and raises
`TRIAL_CONVERSION_OVERDUE`. The mapping is still a pure function of the observation, `kind` and the
clock. It is revisited when A7 (the first post-trial charge failing) is resolved.

## Why `pending` has its own phase

Earlier versions folded `pending` into `ACTIVE`, reasoning that effective access treats them
identically. That is true for access, but not for anything else: Razorpay refuses plan updates while
`pending`, and the user needs to see that their payment is failing. `PAST_DUE` contributes exactly as
`ACTIVE` does; it exists for commands and UI
([SB-PF-02, amended](../../../project/feature-specification/subscription/decisions/payment-failure-and-recovery.md#sb-pf-02--pending-retains-full-paid-access)).

## Transitions Kizunia expects

Any transition Razorpay reports is applied (Razorpay is authoritative); this table is what normally
happens, used for alerting on the unusual.

| From | To | Normally caused by |
| --- | --- | --- |
| `PROVISIONING` | `PENDING_AUTHENTICATION` / `ABANDONED` | Create bound / create resolved as not applied |
| `PENDING_AUTHENTICATION` | `TRIALING`, `ACTIVE`, `EXPIRED`, `CANCELLED` | Checkout completed / expired / abandoned-checkout cleanup |
| `TRIALING` | `ACTIVE`, `PAST_DUE`, `CANCELLED` | Conversion / first charge failed / cancelled during trial |
| `ACTIVE` | `PAST_DUE`, `CANCELLED`, `PAUSED`, `COMPLETED` | Charge failed / cancellation / Dashboard or UPI-app pause / end |
| `PAST_DUE` | `ACTIVE`, `HALTED`, `CANCELLED` | Retry succeeded / retries exhausted / cancellation |
| `HALTED` | `ACTIVE`, `CANCELLED` | Customer recovered / supersession or Dashboard |
| `PAUSED` | `ACTIVE`, `CANCELLED` | Resume / cancellation |

A transition out of a terminal phase is never applied; it is raised as an anomaly (Razorpay documents
terminal states as final, so observing one means a mapping or data error).

## Terminal Subscriptions stay visible

Reaching a terminal phase does not delete anything. The record stops contributing and stops being
synchronized; its full history remains — see
[`../history-and-audit/subscription-history.md`](../history-and-audit/subscription-history.md).
