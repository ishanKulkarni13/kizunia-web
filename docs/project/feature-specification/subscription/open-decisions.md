# Open Decisions

> **Status:** Live
>
> **Last Updated:** 2026-09-21

Questions that are **deliberately not answered yet** — either because they are genuinely open
product questions, or because they require observing Razorpay's actual behavior in TEST mode rather
than reading documentation. This is not a backlog; it is a register of what an implementation phase
must resolve before the area it blocks can proceed.

**How to use this document.** Answering an item means writing a ruling in
[`decisions/`](decisions/README.md), updating the document that explains the behavior, and
**deleting the item from here**.

---

## A. Needs Razorpay TEST-mode verification, not further reading

These could not be conclusively established from current official Razorpay documentation. They are
engineering/operational verification tasks, not product decisions.

| Item | Why it matters | Blocks |
| --- | --- | --- |
| Whether a Razorpay Offer can be attached to an **already-active** subscription, or only at subscription creation | Determines whether a mid-cycle promotional discount is possible without a plan change | [`coupons-and-promotions.md`](coupons-and-promotions.md) mid-cycle Offer application |
| The exact minimum chargeable proration difference Razorpay enforces on a subscription update, in INR | An upgrade/downgrade below this threshold is rejected by Razorpay's API and needs a defined user-facing response | [`../../../architecture/subscription/lifecycle/upgrade-downgrade.md`](../../../architecture/subscription/lifecycle/upgrade-downgrade.md) |
| Real-world e-mandate retry timing under Indian banking holidays | Confirms whether the [payment-failure behavior](decisions/payment-failure-and-recovery.md) is well-bounded across all supported payment rails, not just cards/UPI | [`decisions/payment-failure-and-recovery.md`](decisions/payment-failure-and-recovery.md) |
| What Razorpay's TEST-mode webhook tooling actually provides for pre-production signature/payload verification | Determines how thoroughly the webhook pipeline can be exercised before going live | [`../../../architecture/subscription/webhooks/README.md`](../../../architecture/subscription/webhooks/README.md) |

## B. Genuinely open product questions

| Open decision | Blocks |
| --- | --- |
| Exact pricing (₹ amounts) per plan/cycle | Nothing architectural — a commercial decision, not a technical one |
| Whether a user may receive more than one trial, and any cooldown between them | Trial abuse prevention — see [`future.md`](future.md) |
| Whether MCP access grows beyond a single boolean before other entitlements do | [`future.md`](future.md)'s finer-grained MCP entitlement |
| The purchase/ownership model for future one-time purchases (e.g. paid themes) | [`future.md`](future.md) |
| Coupon stacking policy, if ever built | [`future.md`](future.md) |

---

## What is *not* open

For clarity, since "not yet decided" and "deliberately decided to be minimal" are easy to confuse:

| Sometimes mistaken for open | Actually decided |
| --- | --- |
| Whether Free requires a Razorpay subscription record | Decided: no — see [SB-EA-01](decisions/effective-access-and-grants.md#sb-ea-01--free-has-no-subscription-record) |
| Whether Kizunia runs its own payment-retry/grace-period engine | Decided: no — see [SB-PF-01](decisions/payment-failure-and-recovery.md#sb-pf-01--no-second-retry-engine) |
| Whether cancellation is immediate by default | Decided: no, cycle-end by default — see [SB-LC-04](decisions/lifecycle.md#sb-lc-04--cancellation-defaults-to-cycle-end) |
| Whether downgrading deletes any user data | Decided: never — see [`data-preservation.md`](data-preservation.md) |
| Whether webhook events are trusted to arrive in order | Decided: they are not, and the design does not assume it — see [SB-WH-03](decisions/webhooks-and-reliability.md#sb-wh-03--state-changing-events-trigger-an-authoritative-refetch) |
| Whether a Razorpay Dashboard-initiated change is an edge case | Decided: it is a normal lifecycle path — see [`subscription-lifecycle.md`](subscription-lifecycle.md#dashboard-originated-changes) |
| Whether Kizunia builds a generic multi-provider payment framework | Decided: no — see [SB-PB-01](decisions/provider-boundary-and-environments.md#sb-pb-01--the-provider-boundary-is-sized-not-generic) |
