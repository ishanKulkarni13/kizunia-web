# Glossary

> **Status:** Stable
>
> **Last Updated:** 2026-09-21

Canonical terminology for Subscription & Billing. These meanings are binding: if a document, a
ticket, a schema field or a function name uses one of these words, it means what this page says it
means.

---

## The distinctions that matter most

### 1. Plan vs Subscription

| | Answers | Lives |
| --- | --- | --- |
| **Plan** | "Which product tier — Free, Pro, Pro+ — and which billing cycle?" | A fixed, small catalog Kizunia defines |
| **Subscription** | "What is this particular user's current billing relationship, and what state is it in?" | One record's lineage per user's paid history |

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
| **Grant** | An administrator, a trial, or a promotion — a Kizunia-only decision | No |

Both are **entitlement sources**; neither is privileged over the other except by the highest-wins
rule. See [`entitlements-and-effective-access.md`](entitlements-and-effective-access.md).

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
Kizunia's own record of a user's paid billing relationship and its lifecycle phase, mirrored from
Razorpay's subscription state but expressed in Kizunia's own vocabulary (see
[`../../../architecture/subscription/lifecycle/state-mapping.md`](../../../architecture/subscription/lifecycle/state-mapping.md)). Not the same object as
Razorpay's `Subscription` entity, which is a provider reference this record points to.

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
refund, other supported operations) rather than through the Kizunia application. A normal lifecycle
path, not an edge case. See [`subscription-lifecycle.md`](subscription-lifecycle.md#dashboard-originated-changes).

**Reconciliation**
Kizunia periodically re-fetching the authoritative state of a subscription from Razorpay to correct
any drift, independent of whether a webhook already reported it. See
[`../../../architecture/subscription/reconciliation/README.md`](../../../architecture/subscription/reconciliation/README.md).

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
| "Subscription" for a Free user | *(no record at all)* | Free users have no Subscription row — see [`decisions/effective-access-and-grants.md`](decisions/effective-access-and-grants.md) |
| "Grace period" as a Kizunia-owned timer | **Grace** only in the sense of "Razorpay is still retrying" | Kizunia does not run a second retry/grace engine — see [`decisions/payment-failure-and-recovery.md`](decisions/payment-failure-and-recovery.md) |
| "Coupon engine" | **Offer** (billing discount) or **Promotion** (free-access grant) | V1 deliberately has no generic coupon system |
| "Feature flag" for plan gating | **Entitlement** | A feature flag is a rollout mechanism; an entitlement is a product access right — they are not interchangeable |
