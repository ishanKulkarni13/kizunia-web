# Payment Failure and Recovery

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24

This is the mechanism behind
[SB-PF-01 through SB-PF-05](../../../project/feature-specification/subscription/decisions/payment-failure-and-recovery.md) —
read those rulings for the reasoning; this page states the resulting behavior precisely.

---

## The full path

```text
ACTIVE
  |  charge fails                                    (subscription.pending)
  v
PAST_DUE  — access unchanged (SB-PF-02); UI: "payment failing, update your payment method"
  |  Razorpay retries: cards/UPI daily for 3 days; e-mandate bank-dependent
  |
  +-- retry succeeds  --> ACTIVE                     (subscription.activated / charged)
  |
  +-- retries exhausted                              (subscription.halted)
      v
    HALTED — access ends (SB-PF-03); UI: "subscription on hold — fix payment or start new"
      |
      +-- customer updates payment method (Razorpay email link or checkout card-change)
      |     and a charge succeeds  --> ACTIVE, access restored (SB-PF-04)
      |     (missed invoices are NOT collected — FACT)
      |
      +-- customer chooses to buy again --> supersession: HALTED -> CANCELLED, new Subscription
      |     (multiple-subscriptions.md#supersession)
      |
      +-- nothing happens --> stays HALTED indefinitely; sync heartbeat decays (SB-PF-05)
```

## What Kizunia does at each step

| Razorpay event / observation | Kizunia action |
| --- | --- |
| `subscription.pending` | Mark sync-due → sync → `PAST_DUE`; history entry; access unchanged |
| `subscription.activated` from `pending` | Sync → `ACTIVE`; history entry |
| `subscription.halted` | Sync → `HALTED`; history entry; access falls to the next-highest source or Free |
| `subscription.activated` from `halted` | Sync → `ACTIVE`; history entry; access restored; the advisory payment method is refreshed |
| Any of these missed | Observed at the next checkpoint (`PAST_DUE`: daily) or heartbeat (`HALTED`: decaying) ([`../reconciliation/reconciliation-job.md`](../reconciliation/reconciliation-job.md)) |

No Kizunia-owned timer, grace period or retry engine sits between these rows. Every transition is an
observation of Razorpay's own lifecycle — the literal implementation of
[SB-PF-01](../../../project/feature-specification/subscription/decisions/payment-failure-and-recovery.md#sb-pf-01--no-second-retry-engine).
Customer-facing payment-failure emails are Razorpay's (`customer_notify` left at its default);
Kizunia shows in-app state only.

## Recovery paths the customer may use

**FACT.** A halted subscription recovers when the customer changes their payment method (the link in
Razorpay's failure email, or Checkout with `subscription_card_change`) and a charge succeeds; a UPI or
e-mandate subscription can switch only to a card ([razorpay-facts](../provider-boundary/razorpay-facts.md#payment-retries)).
Kizunia's "fix payment" action opens that Razorpay flow; it does not collect payment details itself.
Because recovery can also happen entirely outside Kizunia (the email link), Kizunia must — and does —
treat `HALTED → ACTIVE` as something it observes, not something it initiates.

## Why this is safe to leave indefinite

A `HALTED` subscription that never recovers costs nothing: Razorpay is not attempting further
charges, and Kizunia has already fallen back to Free. The only cost is a decaying heartbeat sync
([SB-PF-05](../../../project/feature-specification/subscription/decisions/payment-failure-and-recovery.md#sb-pf-05--synchronization-of-a-halted-subscription-decays-it-never-stops)).
Whether Kizunia should ever cancel long-halted subscriptions is open product question
[B2](../../../project/feature-specification/subscription/open-decisions.md#b-genuinely-open-product-questions).

## Interaction with a new purchase

A user in `HALTED` who tries to subscribe again goes through supersession
([`multiple-subscriptions.md`](multiple-subscriptions.md#supersession)): the halted subscription is
cancelled at Razorpay, confirmed, and only then is the new one created. This is the one exception to
"Kizunia never cancels a halted subscription", and it requires the user's explicit confirmation.
