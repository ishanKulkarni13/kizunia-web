# Glossary

> **Status:** Stable
>
> **Last Updated:** 2026-09-24

Canonical terminology for Subscription & Billing. These meanings are binding: if a document, a
ticket, a schema field or a function name uses one of these words, it means what this page says it
means.

---

## The distinctions that matter most

### 1. Plan vs Subscription

| | Answers | Lives |
| --- | --- | --- |
| **Plan** | "Which product tier — Free, Pro, Pro+ — and which billing cycle?" | A fixed, small catalog Kizunia defines |
| **Subscription** | "What is the state of this one billing relationship with Razorpay?" | One record per Razorpay subscription; a user accumulates several over time |

A Plan is a catalog entry. A Subscription is a user's relationship to one, with its own lifecycle,
history, and (at the provider boundary) a Razorpay reference. See
[`plans.md`](plans.md) and [`../../../architecture/domain/subscription/entities.md`](../../../architecture/domain/subscription/entities.md).

### 2. Entitlement vs Preference

Borrowed directly from the notification subsystem's distinction, because it is exactly the same
shape here:

| | Preference | Entitlement |
| --- | --- | --- |
| Answers | Does the user **want** this? | Is the user **allowed** this? |
| Set by | The user | Their effective access |
| Changes when | The user decides | Their plan, grant, or trial changes |

A user's notification preferences are never touched by a plan change. Losing Pro does not turn off
a preference toggle — it makes the preference unable to produce a delivery until the entitlement
returns. See [`entitlements-and-effective-access.md`](entitlements-and-effective-access.md).

### 3. Entitlement vs Authorization

| | Answers |
| --- | --- |
| **Entitlement** | "Is this *feature* available to this user at all?" |
| **Authorization** | "May this user act on *this specific resource*?" |

Having Pro+ does not authorize editing another user's project. `Entitlement + Authorization =
Allowed operation`. Entitlement never replaces the existing `AuthorizationEvaluator` chain — it is
consumed by it. See [`../../../architecture/subscription/entitlements/authorization-integration.md`](../../../architecture/subscription/entitlements/authorization-integration.md).

### 4. Quota vs Rate limit

| | Answers |
| --- | --- |
| **Quota** | "How many of this thing may this plan own?" (e.g. 10 owned projects) |
| **Rate limit** | "How fast may any subject act, regardless of plan?" (abuse protection) |

A Pro+ user gets a higher project quota, not a higher request rate by default. The two systems
share one input (effective access) but answer unrelated questions. See
[`../../../architecture/subscription/entitlements/quotas-vs-rate-limits.md`](../../../architecture/subscription/entitlements/quotas-vs-rate-limits.md).

### 5. Grant vs Subscription

| | Source of truth | Requires Razorpay |
| --- | --- | --- |
| **Subscription** | Razorpay's billing lifecycle, mirrored into Kizunia | Yes |
| **Grant** | An administrator or a promotion — a Kizunia-only decision | No |

Both are **entitlement sources**; neither is privileged over the other except by the highest-wins
rule. A **trial** is not a grant: it is a Subscription (of kind `TRIAL`) in its trial period. See [`entitlements-and-effective-access.md`](entitlements-and-effective-access.md).

---

## Core terms

**Plan**
One of `FREE`, `PRO`, `PRO_PLUS`. Paid plans additionally specify a billing cycle, `MONTHLY` or
`YEARLY`. A starting catalog, not a permanent one — see [`plans.md`](plans.md).

**Entitlement**
The set of capabilities and quotas a user currently has, derived from their **effective access**.
Never checked as `if (user.plan === "PRO")`; always checked as a capability or quota question.

**Effective access**
The single answer to "what plan-level access does this user currently have," computed as the
highest currently valid tier among all of the user's currently valid entitlement sources. See
[`entitlements-and-effective-access.md`](entitlements-and-effective-access.md).

**Entitlement source**
Anything that can contribute to effective access: the default Free tier, a paid **Subscription**, a
**trial**, an **admin grant**, or a **promotion**. Feature code never needs to know which source is
active — only the resolved effective access.

**Subscription**
Kizunia's own record of one Razorpay subscription and its lifecycle phase, mirrored from Razorpay's
state but expressed in Kizunia's own vocabulary (see
[`../../../architecture/subscription/lifecycle/state-mapping.md`](../../../architecture/subscription/lifecycle/state-mapping.md)).
One Kizunia Subscription per Razorpay subscription, for its whole life; subscribing again creates a
new one. Not the same object as Razorpay's `Subscription` entity, which it references.

**Open subscription**
A Subscription that can still bill, or can still come to grant access, without any Kizunia action:
provisioning, awaiting checkout, trialing, active, past due, paused, or halted. Kizunia never creates
a second open subscription for a user. See
[`decisions/uniqueness-and-resubscription.md`](decisions/uniqueness-and-resubscription.md).

**Contributing subscription**
An open subscription that grants its plan's access right now: trialing, active, or past due.

**Past due** *(Kizunia phase `PAST_DUE`)*
Razorpay's `pending`: a charge failed and Razorpay is retrying. Paid access continues.

**Supersession**
Replacing a halted or paused subscription with a new one: the old one is cancelled at Razorpay, and
the cancellation confirmed, before the new one is created — only with the user's explicit
confirmation. See [`decisions/uniqueness-and-resubscription.md`](decisions/uniqueness-and-resubscription.md#sb-uq-04--a-halted-or-paused-subscription-is-superseded-only-by-a-confirmed-cancellation).

**Grant** *(also: admin grant)*
A plan-level entitlement given directly by an administrator, independent of any payment. See
[`admin-grants.md`](admin-grants.md).

**Trial**
A time-boxed period of paid-tier access, using Razorpay's own native trial mechanism (a future
billing start date on an already-authorized subscription). Not a separate, no-payment-method trial
system. See [`subscription-lifecycle.md`](subscription-lifecycle.md#trial).

**Promotion**
A Kizunia-granted period of free paid-tier access, redeemed through a code but represented
identically to an admin grant (`source: PROMOTION`) — never as a Razorpay billing discount. See
[`coupons-and-promotions.md`](coupons-and-promotions.md).

**Offer** *(Razorpay term — kept as-is, never renamed)*
A Razorpay-side, Dashboard-created discount definition (percentage or flat, applied for a limited
number of cycles or forever) attached to a subscription via `offer_id`. This is how Kizunia
represents a genuine **billing discount** — never a free-access grant. See
[`coupons-and-promotions.md`](coupons-and-promotions.md).

**Billing provider**
The external system that performs actual money movement — today, exclusively Razorpay. See
[`../../../architecture/subscription/provider-boundary/README.md`](../../../architecture/subscription/provider-boundary/README.md).

**Provider mode**
Whether the billing provider boundary is `disabled`, `test`, or `live` in the current environment.
`disabled` is a fully supported state, including in production. See
[`../../../architecture/subscription/provider-availability/environments.md`](../../../architecture/subscription/provider-availability/environments.md).

**Halted** *(Razorpay term, kept as-is)*
The Razorpay subscription state reached after all automatic payment retries are exhausted. See
[`subscription-lifecycle.md`](subscription-lifecycle.md#payment-failure).

**Grace** *(as used here)*
The period during which a payment is failing but paid access is still retained, because Razorpay is
still actively retrying. Not a separate Kizunia-owned timer — see
[`decisions/payment-failure-and-recovery.md`](decisions/payment-failure-and-recovery.md).

**Dashboard-originated change**
A subscription mutation an administrator performed directly in the Razorpay Dashboard (cancel,
refund, other supported operations) rather than through the Kizunia application — or, equally, one a
customer made from their UPI app. A normal lifecycle path, not an edge case. See [`subscription-lifecycle.md`](subscription-lifecycle.md#changes-made-outside-kizunia).

**Synchronization** *(sync)*
Fetching a subscription's current state from Razorpay and applying it to Kizunia's record. Webhooks,
checkout confirmation, command confirmation and reconciliation all *trigger* a sync; there is one sync
mechanism. See [`../../../architecture/subscription/reconciliation/sync-mechanism.md`](../../../architecture/subscription/reconciliation/sync-mechanism.md).

**Reconciliation**
Syncs Kizunia schedules itself — at lifecycle checkpoints (renewal, period end, trial end) and on a
per-phase heartbeat — so that correctness never depends on a webhook arriving. Due-based, never a
sweep of every subscription. See
[`../../../architecture/subscription/reconciliation/README.md`](../../../architecture/subscription/reconciliation/README.md).

**Billing operation** *(command)*
A change Kizunia asks Razorpay to make (create, change plan, cancel), recorded before it is sent. See
[`decisions/commands-and-idempotency.md`](decisions/commands-and-idempotency.md).

**Outcome unknown**
A billing operation whose request was sent but whose result Kizunia never learned (a timeout, a
crash). Resolved by observing Razorpay, never by sending it again.

**Provider request budget**
The global bound on how many requests Kizunia sends Razorpay, shared by every caller, with
priorities. Unrelated to user-facing rate limits and to plan quotas. See
[`../../../architecture/subscription/reconciliation/provider-rate-limits.md`](../../../architecture/subscription/reconciliation/provider-rate-limits.md).

**Anomaly**
A billing situation Kizunia detects but deliberately does not resolve automatically — for example two
open subscriptions for one user, or a Razorpay subscription Kizunia cannot match to any user. Always
resolved by a person.

**Owned project vs member project**
Kizunia already distinguishes a project a user **owns** (`ProjectMember.role = OWNER`) from one
they are merely a **member** of. Plan quotas apply only to owned projects. See
[`plans.md`](plans.md).

**Publicly displayable** *(portfolio)*
Whether a portfolio may be shown at its public URL at all, independent of the owner's own
`visibility` preference. Both must hold for a portfolio to actually be public. See
[`portfolio-and-entitlements.md`](portfolio-and-entitlements.md).

---

## Terms deliberately not used

| Do not use | Use instead | Why |
| --- | --- | --- |
| "Tier" as a synonym for plan capability set at the code level | **Effective access** | "Tier" alone doesn't say whether it is billing-derived, granted, or default |
| "Free subscription" | **Free** (effective access with no contributing source) | Free is never stored; a Free user may have old or inactive Subscriptions, but none of them *is* Free — see [`decisions/effective-access-and-grants.md`](decisions/effective-access-and-grants.md#sb-ea-01--free-has-no-subscription-record) |
| "Upgrade" for Free → paid | **Subscribing** | There is no subscription to upgrade; buying a plan creates one |
| "Downgrade" for paid → Free | **Cancellation** | Leaving a paid plan is a cancellation, not a plan change |
| "Grace period" as a Kizunia-owned timer | **Grace** only in the sense of "Razorpay is still retrying" | Kizunia does not run a second retry/grace engine — see [`decisions/payment-failure-and-recovery.md`](decisions/payment-failure-and-recovery.md) |
| "Coupon engine" | **Offer** (billing discount) or **Promotion** (free-access grant) | V1 deliberately has no generic coupon system |
| "Feature flag" for plan gating | **Entitlement** | A feature flag is a rollout mechanism; an entitlement is a product access right — they are not interchangeable |
