# Identifiers

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24

Kizunia owns its own domain identifiers. Razorpay identifiers are stored only as provider-reference
metadata on billing-module records, never as the backbone of any domain relationship outside the
billing module. See
[SB-PB-04](../../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-04--razorpay-identifiers-never-leak-past-the-provider-boundary).

---

## The rule

No code outside the billing module ever writes:

```text
if (razorpaySubscription.status === "active") { ... }
if (razorpayPlanId === "...") { ... }
```

Provider state is translated into Kizunia's vocabulary (a `Subscription` phase, from
[`../lifecycle/state-mapping.md`](../lifecycle/state-mapping.md), and a Kizunia plan from the plan
catalog) in one place — the sync apply path — and everything downstream consumes that translation.

## One Kizunia Subscription per Razorpay subscription

**FACT.** A cancelled Razorpay subscription cannot be reactivated; resubscribing produces a new
Razorpay subscription ID ([razorpay-facts](razorpay-facts.md#lifecycle-states)).

The earlier version of this document concluded that Kizunia should keep one long-lived Subscription
per user and *swap* its Razorpay reference on resubscribe. That breaks as soon as the old provider
subscription does anything after being "replaced" — a late webhook has nowhere to land, and a halted
subscription that recovers would overwrite the newer relationship. Instead
([SB-UQ-01](../../../project/feature-specification/subscription/decisions/uniqueness-and-resubscription.md#sb-uq-01--a-subscription-is-one-razorpay-subscription-bound-once)):

- each Razorpay subscription has exactly one Kizunia Subscription, and its provider ID is **bound
  once and never changed**;
- a user's continuity across cancel → resubscribe is the set of their Subscriptions plus their
  history — keyed on the Kizunia user, never on a Razorpay ID;
- Kizunia's own Subscription ID is the primary key and the only identifier other modules may hold.

## What is stored, and where

| Field | Lives on | Read by |
| --- | --- | --- |
| Razorpay subscription ID | `Subscription` (unique per provider mode; bound once) | Billing module only |
| Razorpay plan ID | `Subscription` (current, and the pending scheduled one if any) | Billing module only — mapped to a Kizunia plan by the catalog |
| Razorpay Offer ID and the marketing code used | `Subscription` | Billing module only |
| Last fetched raw status and normalized provider snapshot | `Subscription` | Billing module only — diagnostics, command preconditions, anomaly detection |
| Authorization payment method (advisory) | `Subscription` | Billing module; the UI receives only "plan change likely available: yes/no" |
| Razorpay event ID, payment IDs, refund IDs | `BillingEvent`, charge/refund facts | Billing module only |
| Kizunia identifiers sent to Razorpay | Razorpay `notes`: `kz_sub`, `kz_op`, `kz_env` | Orphan discovery and unmatched-event resolution |

The earlier rule "the raw status is never persisted outside the `BillingEvent` payload" is replaced:
persisting the last observed provider state *inside* the billing module is what lets support answer
"what did Razorpay last say?" and lets commands check preconditions, without replaying events.
Nothing outside the module reads it.

## Identifiers Kizunia sends to Razorpay

`notes` carry only opaque Kizunia identifiers — the Subscription ID, the operation ID and the
provider mode. Never an email, name, phone number or user ID that another system could correlate.
