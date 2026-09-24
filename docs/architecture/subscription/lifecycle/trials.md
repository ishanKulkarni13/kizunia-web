# Trials

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24

Trials use Razorpay's native mechanism only — see
[SB-LC-01](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-01--trial-is-razorpay-native-only),
[SB-LC-10](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-10--subscription-kind-is-recorded-at-creation-never-inferred),
[SB-LC-11](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-11--one-trial-per-account).

---

## Mechanism

Starting a trial is the ordinary checkout command
([`../commands/checkout-and-creation.md`](../commands/checkout-and-creation.md)) with
`kind = TRIAL` and `start_at` = trial end. **FACT:** the customer completes the authentication
transaction immediately; with a future start and no upfront amount Razorpay charges ₹5 and refunds it
automatically ([razorpay-facts](../provider-boundary/razorpay-facts.md#trials)).

```text
checkout(kind = TRIAL, plan = PRO, start_at = now + 30d)
  -> eligibility check under the user's in-flight operation (SB-LC-11)
  -> Razorpay: created -> authenticated (start_at = T+30d)
  -> sync: kind TRIAL + authenticated + future start_at -> TRIALING
  -> effective access includes PRO from authentication, through T+30d
```

## Eligibility

A user may start a trial only if none of their Subscriptions of kind `TRIAL` has ever reached
`TRIALING` — derived from existing Subscription records (history entries record the transition), no
separate table. Checked inside the per-user command serialization, so two tabs cannot both start one.
An abandoned trial checkout (never authenticated) does not consume eligibility; a cancelled,
converted or failed trial does.

## Conversion is not a separate code path

At `start_at`, Razorpay attempts the first real charge. The resulting `subscription.activated` /
`subscription.charged` produce a sync that shows `active` → `ACTIVE`; the `start_at` checkpoint sync
observes it even if the webhooks are missed. No dedicated conversion handler exists.

Between `start_at` and the first observed non-`authenticated` status, the subscription stays
`TRIALING` for at most the trial-conversion grace (C7). This covers Razorpay running the first charge
late. If the grace passes with no change, the subscription stops contributing and a
`TRIAL_CONVERSION_OVERDUE` anomaly is raised for an operator to investigate (decided 2026-09-24,
[IB-9](../implementation/open-decisions.md#ib-9--trial-conversion-gap); see
[state mapping](state-mapping.md#the-mapping)).

If the first charge fails, the expected path is the ordinary `pending → halted` sequence:
`PAST_DUE` (still contributes) then `HALTED` (does not). A trial user whose card fails therefore
keeps access through Razorpay's retry window — an accepted consequence of
[SB-PF-02](../../../project/feature-specification/subscription/decisions/payment-failure-and-recovery.md#sb-pf-02--pending-retains-full-paid-access).
The pre-`start_at` state is verified: `authenticated`, `paid_count 0`, `charge_at == start_at`
(TEST mode, 2026-09-24). This first-charge failure path is **not** verified — TEST mode never ran the
first scheduled charge (still `authenticated` 47 minutes after `start_at`) — and remains open
([A7](../../../project/feature-specification/subscription/open-decisions.md#a-razorpay-behavior-requiring-test-mode-verification-or-support)).

## Cancelling during a trial

**FACT:** Razorpay refuses a cycle-end cancellation before the first billing cycle. A customer
cancelling a trial is therefore an **immediate** cancellation: trial access ends at once and nothing
is charged ([SB-LC-04, amended](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-04--cancellation-defaults-to-end-of-cycle)).
Eligibility stays consumed.

## Trials and other sources

| Situation | Behavior |
| --- | --- |
| User already has an open Subscription | Trial refused ([SB-UQ-03](../../../project/feature-specification/subscription/decisions/uniqueness-and-resubscription.md#sb-uq-03--a-new-purchase-while-a-paid-subscription-is-live-is-refused-not-duplicated)) |
| Admin grant during a trial | Both contribute; highest wins; neither modifies the other |
| Plan change during a trial | Allowed only where Razorpay accepts an update for an `authenticated` subscription of that payment method ([`upgrade-downgrade.md`](upgrade-downgrade.md)); otherwise refused |
| Two trial checkouts at once | One in-flight operation per user; the second is refused or returns the first |

## UPI trials — provider-dependent

A trial is a future-`start_at` subscription authorized now. Whether UPI AutoPay can authorize such a
subscription has **not been verified**: UPI is disabled for Subscriptions on the TEST account
([A16](../../../project/feature-specification/subscription/open-decisions.md#a-razorpay-behavior-requiring-test-mode-verification-or-support),
[IB-18](../implementation/open-decisions.md#ib-18--upi-disabled-on-the-razorpay-test-account)). The
design does not depend on the answer: an unsupported method surfaces as a provider refusal of the
create or the authorization. But if UPI trials turn out to be unsupported, the product must decide
whether trials are offered only to other methods. That decision is made in implementation-plan
[Phase VII](../implementation-plan/phase-VII/README.md), not assumed here.

## What is not built

- A no-payment-method trial. Free access without a payment method is a
  [Promotion](../entitlements/coupons-and-offers.md#promotion-redemption-free-access-grant), not a
  trial.
- Trial cooldowns or repeat trials ([B7](../../../project/feature-specification/subscription/open-decisions.md#b-genuinely-open-product-questions)).
