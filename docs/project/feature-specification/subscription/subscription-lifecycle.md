# Subscription Lifecycle

> **Status:** Stable
>
> **Last Updated:** 2026-09-24

What a user experiences as their paid access changes over time. The mechanism behind each of these
(which Razorpay API call, which webhook) is described in
[`../../../architecture/subscription/lifecycle/`](../../../architecture/subscription/lifecycle/README.md); this page states the
behavior only.

---

## Subscribing

A Free user chooses a plan and cycle and completes Razorpay's checkout (card, UPI AutoPay or
e-mandate). Paid access begins as soon as Razorpay confirms the payment — normally within seconds of
the checkout closing. Retrying, double-clicking or opening checkout in two tabs never creates two
subscriptions: the user gets back the same checkout. See
[`decisions/commands-and-idempotency.md`](decisions/commands-and-idempotency.md).

A user has at most one live subscription. Someone who already has one cannot buy a second; see
[plan changes](#changing-plan) below. See
[`decisions/uniqueness-and-resubscription.md`](decisions/uniqueness-and-resubscription.md).

## Trial

A trial gives a user Pro or Pro+ access for a fixed period before their first real charge. Kizunia
uses Razorpay's own native trial mechanism: the user authorizes a payment method immediately (a
small authorization transaction, auto-refunded), and billing begins on a future date chosen at
trial start. There is no separate, no-payment-method trial system.

```text
User starts a 30-day Pro trial
  -> payment method authorized immediately
  -> full Pro access from day 1
  -> first real charge on day 30, automatically, unless the user cancels first
```

Conversion is not a separate step the user takes — it is simply what happens if they do nothing.
Cancelling during the trial (before the first charge) ends it immediately with no charge.

**One trial per account.** A user who has already had a trial — whether it converted, was cancelled,
or failed — cannot start another. See
[`decisions/lifecycle.md`](decisions/lifecycle.md#sb-lc-11--one-trial-per-account).

## Changing plan

Moving between Pro and Pro+, or between monthly and yearly, uses Razorpay's own plan-change
capability — when Razorpay can perform it for that subscription.

| Change | When Razorpay supports it | Otherwise |
| --- | --- | --- |
| Upgrade (e.g. Pro → Pro+) | Takes effect **immediately**; Razorpay charges the prorated difference, and the higher plan's access starts once that charge succeeds | Not available in V1 |
| Downgrade (e.g. Pro+ → Pro) | Takes effect **at the end of the current billing period**; the user keeps the current plan until then | Not available in V1 |

**Razorpay cannot change the plan of subscriptions paid by UPI AutoPay or e-mandate, and for domestic
cards it can only change a discount, not the plan.** For those subscriptions — which is most Indian
customers — changing plan is not available in V1. Such a user can cancel (keeping access until the
period they paid for ends) and subscribe to the new plan once it has ended. Kizunia shows this
clearly rather than offering a change that will fail. This limitation is deliberate and recorded as
future scope — see [`decisions/lifecycle.md`](decisions/lifecycle.md#sb-lc-07--razorpay-decides-whether-a-plan-change-is-possible)
and [`future.md`](future.md#plan-changes-razorpay-cannot-perform-natively).

Plan changes are also unavailable while a payment is failing or the subscription is on hold.

## Going back to Free

Leaving a paid plan is a cancellation (below), available for every payment method. A downgrade never
deletes anything the user has already created. See [`data-preservation.md`](data-preservation.md).

## Cancellation

Cancelling a paid plan keeps paid access through the period the user already paid for, then falls
back to Free. Once requested, a cancellation cannot be undone in V1; to continue after it takes
effect, the user subscribes again. During a trial, cancellation is immediate. Cancelling while a
renewal payment is failing is also immediate: the period being retried was never paid, so paid access
ends at once and no further charge is attempted. Immediate cancellation of a paid period (losing
access right away) is a support action, not the self-serve default — see
[`decisions/lifecycle.md`](decisions/lifecycle.md#sb-lc-04--cancellation-defaults-to-end-of-cycle).

## Payment failure

If a recurring payment fails, Kizunia does not immediately revoke access. Razorpay automatically
retries the charge for a short window (a few days). During that window the user keeps their paid
access and sees that their payment is failing.

If every retry fails, the subscription goes **on hold**: Razorpay has stopped trying and is waiting
for the user to act. At that point paid access ends and the user falls back to Free. Crucially,
**this is not a cancellation** — if the user later fixes their payment method, their existing
subscription resumes and paid access is restored automatically, without recreating anything or
losing any data.

Kizunia deliberately does not run a second, longer grace-period timer on top of Razorpay's own
retry window — see [`decisions/payment-failure-and-recovery.md`](decisions/payment-failure-and-recovery.md).

## Subscribing again after a subscription went on hold

A user whose subscription is on hold may fix the payment method (restoring it) **or** start a new
subscription. Starting a new one first cancels the on-hold subscription permanently — the user is
told this and must confirm it — so the two can never both bill. If Razorpay does not allow the
on-hold subscription to be cancelled, the user is asked to restore it instead. Which of these options Kizunia offers a subscriber who
pays by **UPI**, and in what order, is settled only once UPI behavior has been verified with
Razorpay: Razorpay documents that a UPI subscription can be restored only by switching to a card, and
that has not been observed yet
([IB-22](../../../architecture/subscription/implementation/open-decisions.md#ib-22--upi-recovery-ux)). See
[`decisions/uniqueness-and-resubscription.md`](decisions/uniqueness-and-resubscription.md#sb-uq-04--a-halted-or-paused-subscription-is-superseded-only-by-a-confirmed-cancellation).

## Changes made outside Kizunia

A subscription does not only change because of something the user did in Kizunia. An operator with
Razorpay Dashboard access can cancel, pause or refund; a UPI AutoPay customer can cancel or pause
their mandate from their own UPI app. These are **normal lifecycle paths**: Razorpay tells Kizunia,
and the user's access updates accordingly — including falling back to Free once paid access actually
ends.

```text
Admin cancels a subscription in the Razorpay Dashboard  (or the customer revokes the UPI mandate)
  -> Razorpay's own state changes
  -> Kizunia is notified and checks Razorpay's current state
  -> Kizunia's internal subscription state updates
  -> effective access changes
  -> user falls back to Free once paid access actually ends
```

Kizunia never assumes all subscription changes originate from its own application. See
[`../../../architecture/subscription/lifecycle/dashboard-originated-changes.md`](../../../architecture/subscription/lifecycle/dashboard-originated-changes.md).

## When Razorpay is unavailable

Existing paid users keep their access during a Razorpay outage — access is decided from Kizunia's own
records, never by asking Razorpay. Starting, changing or cancelling a subscription shows "billing is
temporarily unavailable, try again shortly". See
[`../../../architecture/subscription/provider-availability/outage-and-stale-state.md`](../../../architecture/subscription/provider-availability/outage-and-stale-state.md).

## Related rulings

[`decisions/lifecycle.md`](decisions/lifecycle.md), [`decisions/payment-failure-and-recovery.md`](decisions/payment-failure-and-recovery.md),
[`decisions/uniqueness-and-resubscription.md`](decisions/uniqueness-and-resubscription.md),
[`decisions/commands-and-idempotency.md`](decisions/commands-and-idempotency.md).
