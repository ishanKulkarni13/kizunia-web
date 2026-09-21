# Subscription Lifecycle

> **Status:** Stable
>
> **Last Updated:** 2026-09-21

What a user experiences as their paid access changes over time. The mechanism behind each of these
(which Razorpay API call, which webhook) is described in
[`../../../architecture/subscription/lifecycle/`](../../../architecture/subscription/lifecycle/README.md); this page states the
behavior only.

---

## Trial

A trial gives a user Pro or Pro+ access for a fixed period before their first real charge. Kizunia
uses Razorpay's own native trial mechanism: the user authorizes a payment method immediately (a
small authorization transaction, auto-refunded), and billing begins on a future date chosen at
trial start. There is no separate, no-payment-method trial system.

Practically:

```text
User starts a 30-day Pro trial
  -> payment method authorized immediately
  -> full Pro access from day 1
  -> first real charge on day 30, automatically, unless the user cancels first
```

Conversion is not a separate step the user takes — it is simply what happens if they do nothing.
Cancelling during the trial (before the first charge) ends it immediately with no charge. See
[`decisions/lifecycle.md`](decisions/lifecycle.md#sb-lc-01--trial-is-razorpay-native-only).

## Upgrade

Upgrading (Free → Pro, Pro → Pro+, or extending billing scope) takes effect **immediately**. The
user is charged the prorated difference for the remainder of the current cycle, and gains the new
plan's access right away. See [`decisions/lifecycle.md`](decisions/lifecycle.md#sb-lc-02--upgrades-are-immediate).

## Downgrade

Downgrading (Pro+ → Pro, Pro → Free) takes effect **at the end of the current billing period**. The
user keeps their current plan's access — and continues being billed at the current rate — until the
period they already paid for ends, then the new (lower) plan applies. See
[`decisions/lifecycle.md`](decisions/lifecycle.md#sb-lc-03--downgrades-take-effect-at-cycle-end).

A downgrade never deletes anything the user has already created. See
[`data-preservation.md`](data-preservation.md).

## Cancellation

Cancelling a paid plan defaults to the same behavior as a downgrade to Free: the user keeps paid
access through the period they already paid for, then falls back to Free. Immediate cancellation
(losing access right away) is available as an explicit, deliberate action rather than the default —
see [`decisions/lifecycle.md`](decisions/lifecycle.md#sb-lc-04--cancellation-defaults-to-cycle-end).

## Payment failure

If a recurring payment fails, Kizunia does not immediately revoke access. Razorpay automatically
retries the charge for a short window (a few days). During that window, the user keeps their paid
access — the payment is being retried, not yet failed for good.

If every retry fails, the subscription enters a state where Razorpay has stopped trying
automatically and is waiting for the user to act (update their card, or pay the outstanding invoice
manually). At that point, paid access ends and the user falls back to Free. Crucially, **this is not
a cancellation** — if the user later fixes their payment method, their existing subscription
resumes and paid access is restored automatically, without recreating anything or losing any data.

Kizunia deliberately does not run a second, longer grace-period timer on top of Razorpay's own
retry window — see [`decisions/payment-failure-and-recovery.md`](decisions/payment-failure-and-recovery.md) for the full
reasoning, and [`../../../architecture/subscription/lifecycle/payment-failure-and-recovery.md`](../../../architecture/subscription/lifecycle/payment-failure-and-recovery.md)
for the mechanism.

## Dashboard-originated changes

A subscription does not only change because of something the user or Kizunia's own UI did. An
administrator with access to the Razorpay Dashboard can cancel a subscription, issue a refund, or
perform other supported operations directly against Razorpay. This is a **normal lifecycle path**,
handled exactly the same way as any other subscription change: Razorpay tells Kizunia via a
webhook, and the user's effective access updates accordingly — including, eventually, falling back
to Free if paid access ends.

```text
Admin cancels a subscription in the Razorpay Dashboard
  -> Razorpay's own state changes
  -> Kizunia is notified (webhook)
  -> Kizunia's internal subscription state updates
  -> effective access is recalculated
  -> user falls back to Free once paid access actually ends
```

Kizunia never assumes all subscription changes originate from its own application. See
[`../../../architecture/subscription/lifecycle/dashboard-originated-changes.md`](../../../architecture/subscription/lifecycle/dashboard-originated-changes.md).

## Related rulings

[`decisions/lifecycle.md`](decisions/lifecycle.md), [`decisions/payment-failure-and-recovery.md`](decisions/payment-failure-and-recovery.md).
