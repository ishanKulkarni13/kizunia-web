# Subscription Domain — Entities

> **Status:** Design — conceptual, not a schema
>
> **Last Updated:** 2026-09-21

---

## Plan

A fixed catalog entry, not a per-user record.

| Property | Contract |
| --- | --- |
| Identity | `FREE`, `PRO`, `PRO_PLUS` — stable, referenced everywhere else, never renamed |
| Cycle | Paid plans additionally carry `MONTHLY` \| `YEARLY` |
| Capabilities | A static mapping from plan to quotas/capabilities (owned-project limit, portfolio, deadline notifications, recommendations, MCP) — see [`../../../project/feature-specification/subscription/plans.md`](../../../project/feature-specification/subscription/plans.md) |

**Invariant.** Nothing outside the capability-resolution layer reads this mapping directly. Feature
code asks for a resolved capability, never "what plan is this."

---

## Subscription

One user's paid billing relationship and its lifecycle.

| Property | Contract |
| --- | --- |
| Owner | One user |
| Plan | The Plan this Subscription bills |
| Phase | Kizunia's own lifecycle vocabulary, mapped from Razorpay's state — see [`../../subscription/lifecycle/state-mapping.md`](../../subscription/lifecycle/state-mapping.md) |
| Current period | Start/end of the billing period currently in force |
| Provider reference | Opaque Razorpay identifiers (subscription ID, plan ID, offer ID if any) — see [`ProviderReference`](#providerreference) |
| Scheduled change | Whether a downgrade or cancellation is pending for cycle end, and to what |

### Invariants

**Exists only for a non-Free relationship.** No Subscription row is created for a user until they
begin a real (or trial) paid relationship — see
[SB-EA-01](../../../project/feature-specification/subscription/decisions/effective-access-and-grants.md#sb-ea-01--free-has-no-subscription-record).

**Never deleted on downgrade or halt.** Falling back to Free (via cycle-end downgrade, cancellation,
or `halted`) changes the Subscription's phase; it does not delete the record. This is what makes
[un-halting non-destructive](../../../project/feature-specification/subscription/decisions/payment-failure-and-recovery.md#sb-pf-04--un-halting-restores-paid-access-automatically-and-non-destructively) possible.

**One active Subscription per user at a time**, but a user's full *history* of Subscriptions (across
cancel → resubscribe cycles, each producing a new Razorpay subscription ID) is preserved — see
[`SubscriptionHistoryEntry`](#subscriptionhistoryentry).

---

## EntitlementGrant

A non-billing entitlement source: an admin grant, a promotion, or (conceptually) a trial's
access-shaping counterpart. See [ADR note] — a Razorpay-native trial is implemented as a
`Subscription` in its `TRIALING` phase, not as an `EntitlementGrant`; `EntitlementGrant` covers
sources that never touch Razorpay at all.

| Property | Contract |
| --- | --- |
| Recipient | One user |
| Plan | The tier this grant contributes |
| Source | `ADMIN_GRANT` \| `PROMOTION` (extensible — see [future sources](../../../project/feature-specification/subscription/future.md)) |
| Validity window | A start time and an optional end time (`null` = indefinite) |
| Status | `ACTIVE` \| `EXPIRED` \| `REVOKED` |
| Provenance | Who granted it (for `ADMIN_GRANT`) or which promotion code (for `PROMOTION`), and why |

### Invariants

**Never requires Razorpay.** Creating, extending, or revoking a grant touches nothing on the
provider boundary.

**Independent of any Subscription.** A grant coexists with a paid Subscription; it does not modify,
pause, or replace it — see
[SB-EA-03](../../../project/feature-specification/subscription/decisions/effective-access-and-grants.md#sb-ea-03--entitlement-sources-coexist-as-independent-records).

**Auditable.** Every creation, extension, and revocation is attributable to an actor and a reason —
see [`../../subscription/history-and-audit/admin-grant-audit.md`](../../subscription/history-and-audit/admin-grant-audit.md).

---

## EffectiveAccess

Not a stored entity — the result of a computation.

| Property | Contract |
| --- | --- |
| Input | The user's current Subscription phase (if any) and all currently `ACTIVE` EntitlementGrants |
| Output | The single highest-tier plan among currently valid sources, or `FREE` if none |
| Storage | None. Recomputed on read, never cached as a source of truth (a short-lived request-scoped cache is an implementation optimization, not a storage decision) |

See [`../../../project/feature-specification/subscription/entitlements-and-effective-access.md`](../../../project/feature-specification/subscription/entitlements-and-effective-access.md) and
[`../../subscription/entitlements/effective-access-resolution.md`](../../subscription/entitlements/effective-access-resolution.md).

---

## BillingEvent

The append-only record of every webhook event Kizunia has received and verified.

| Property | Contract |
| --- | --- |
| Identity | `(provider, providerEventId)`, unique — the idempotency key |
| Payload | The raw, verified event body |
| Received state | `RECEIVED` → `PROCESSED` \| `FAILED` \| `SKIPPED_STALE` |
| Linkage | Points at the Subscription it concerns, where determinable from the payload |

**Invariant.** Written once verification succeeds, before any processing — see
[SB-WH-02](../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md#sb-wh-02--every-received-event-is-persisted-with-a-unique-constraint-dedupe-key-before-acknowledgement).
Never overwritten; a re-delivery of the same event is recognized by its unique key, not updated in
place.

---

## SubscriptionHistoryEntry

The append-only record of every Subscription phase transition.

| Property | Contract |
| --- | --- |
| Subscription | Which Subscription changed |
| From / to phase | The transition |
| Cause | `webhook` \| `admin` \| `reconciliation` |
| Triggering reference | The `BillingEvent` id (if `webhook`/`reconciliation`) or the admin action (if `admin`) |
| Timestamp | When |

**Invariant.** Answers "why does this user currently have this access" without needing to replay
`BillingEvent`s — see [`../../subscription/history-and-audit/subscription-history.md`](../../subscription/history-and-audit/subscription-history.md).

---

## ProviderReference

The opaque Razorpay identifiers a Subscription carries, kept structurally separate from Kizunia's
own domain identity.

| Property | Contract |
| --- | --- |
| Razorpay subscription ID | Changes across a cancel → resubscribe cycle; never used as Kizunia's own primary key |
| Razorpay plan ID | Which underlying Razorpay Plan object bills this Subscription |
| Active offer ID | If a billing discount is attached |

**Invariant.** Nothing outside the provider boundary reads these fields directly — see
[SB-PB-04](../../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-04--razorpay-identifiers-never-leak-past-the-provider-boundary).

---

## What is not an entity here

| Not an entity | Why |
| --- | --- |
| "Effective access" | A computed value — see [`EffectiveAccess`](#effectiveaccess) |
| "Coupon" | Splits into a Razorpay-side Offer reference (on `ProviderReference`) and a Kizunia-side `EntitlementGrant` (`PROMOTION`) — never one thing |
| A generic `AuditLog` | No such table exists in the codebase yet; `SubscriptionHistoryEntry` and the admin-grant audit trail are purpose-built, not a reuse of something generic |
| "Trial" as its own table | A trial is a `Subscription` in a `TRIALING` phase — see [`../../subscription/lifecycle/trials.md`](../../subscription/lifecycle/trials.md) |
