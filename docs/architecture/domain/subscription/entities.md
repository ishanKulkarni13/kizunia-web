# Subscription Domain — Entities

> **Status:** Design — conceptual, not a schema
>
> **Last Updated:** 2026-09-24 (decision close-out: IB-9, IB-17(d))

---

## Plan

A fixed catalog entry, not a per-user record.

| Property | Contract |
| --- | --- |
| Identity | `FREE`, `PRO`, `PRO_PLUS` — stable, referenced everywhere else, never renamed |
| Cycle | Paid plans additionally carry `MONTHLY` \| `YEARLY` |
| Capabilities | A static mapping from plan to quotas/capabilities (owned-project limit, portfolio, deadline notifications, recommendations, MCP) — see [`../../../project/feature-specification/subscription/plans.md`](../../../project/feature-specification/subscription/plans.md) |
| Provider catalog | Per provider mode, a many-to-one map from Razorpay plan IDs to `(plan, cycle)` — [SB-PB-05](../../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-05--provider-plan-ids-map-to-kizunia-plans-through-a-per-mode-catalog-many-to-one) |

**Invariant.** Nothing outside the capability-resolution layer reads the capability mapping directly,
and nothing outside the billing module reads the provider catalog.

---

## Subscription

One Razorpay subscription, mirrored into Kizunia's vocabulary, for its whole life.

| Property | Contract |
| --- | --- |
| Identity | Kizunia ID — the only identifier other modules hold |
| Owner | One user |
| Kind | `STANDARD` \| `TRIAL` — recorded at creation, never inferred ([SB-LC-10](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-10--subscription-kind-is-recorded-at-creation-never-inferred)) |
| Provider mode | `test` \| `live` — stamped at creation ([SB-EA-07](../../../project/feature-specification/subscription/decisions/effective-access-and-grants.md#sb-ea-07--a-subscription-contributes-only-in-the-provider-mode-it-was-created-in)) |
| Plan, cycle | As last observed at Razorpay, mapped through the catalog |
| Phase | See [`../../subscription/lifecycle/state-mapping.md`](../../subscription/lifecycle/state-mapping.md) — `PROVISIONING`, `PENDING_AUTHENTICATION`, `TRIALING`, `ACTIVE`, `PAST_DUE`, `HALTED`, `PAUSED`, `CANCELLED`, `EXPIRED`, `COMPLETED`, `ABANDONED` |
| Current period | Start/end of the billing period in force; next charge time |
| Scheduled change | A pending `cycle_end` plan change (target plan, effective time), and whether a cycle-end cancellation was requested by Kizunia |
| Provider reference | Razorpay subscription ID (bound once), plan ID, Offer ID, marketing code used — see [`ProviderReference`](#providerreference) |
| Last provider observation | Raw status and normalized snapshot — billing-module-internal ([SB-PB-04](../../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-04--razorpay-identifiers-never-leak-past-the-provider-boundary)) |
| Advisory payment method | From the authorization payment; UX only ([SB-LC-07](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-07--razorpay-decides-whether-a-plan-change-is-possible)) |
| Sync state | `syncDueAt`, `syncReason`, `syncRequestedAt`, `syncAttempts`, `syncLeaseUntil`, `lastSyncedAt`, `lastAppliedObservationAt`, `lastSyncFailureClass` — [`../../subscription/reconciliation/sync-mechanism.md`](../../subscription/reconciliation/sync-mechanism.md) |
| Supersession | `supersededBy` — the Subscription that replaced this one, if any |

### Invariants

**One Razorpay subscription, bound once.** A Subscription's Razorpay subscription ID never changes
once set, and no two Subscriptions share one (unique per provider mode)
([SB-UQ-01](../../../project/feature-specification/subscription/decisions/uniqueness-and-resubscription.md#sb-uq-01--a-subscription-is-one-razorpay-subscription-bound-once)).

**Written before the provider call.** A Subscription exists (as `PROVISIONING`) before Kizunia asks
Razorpay to create anything ([SB-CM-02](../../../project/feature-specification/subscription/decisions/commands-and-idempotency.md#sb-cm-02--the-local-record-is-written-before-the-provider-call)).

**Kizunia never creates a second open Subscription for a user**
([SB-UQ-02](../../../project/feature-specification/subscription/decisions/uniqueness-and-resubscription.md#sb-uq-02--kizunia-never-creates-a-second-open-subscription-for-a-user)).
This is a rule on creation, not a database constraint on phases — Razorpay-side events can still
produce two, which are detected and never silently resolved.

**Phase changes only through an applied observation** (or the local-only `PROVISIONING → ABANDONED`).
No code sets a phase from a request, a payload, or a timer.

**Never deleted.** Falling back to Free changes the phase; terminal Subscriptions remain as history.
Account removal pseudonymizes rather than deletes
([SB-DP-04](../../../project/feature-specification/subscription/decisions/data-preservation.md#sb-dp-04--billing-records-survive-account-removal)).

---

## BillingOperation

Every mutation Kizunia asks Razorpay to perform. See
[`../../subscription/commands/operation-model.md`](../../subscription/commands/operation-model.md).

| Property | Contract |
| --- | --- |
| Kind | Create, update plan, cancel (cycle end / immediate), cancel scheduled change; parent kinds for composed commands |
| User, Subscription, actor | Who, on what, requested by whom |
| Idempotency key | Unique per user |
| Status | `IN_FLIGHT` → `SUCCEEDED` \| `REJECTED` \| `OUTCOME_UNKNOWN` (→ `SUCCEEDED` \| `NOT_APPLIED`) |
| Request sent at, failure class, provider error | For the stale-apply guard and diagnosis |

**Invariants.** At most one `IN_FLIGHT` *root* operation per user (database-enforced); child operations of a composed command run under their root's slot ([IB-6](../../subscription/implementation/open-decisions.md#ib-6--composed-commands-and-the-in-flight-constraint), 2026-09-24). Written and committed before the
provider call. Never deleted.

---

## EntitlementGrant

A non-billing entitlement source: an admin grant or a promotion. A trial is **not** a grant — it is a
`Subscription` of kind `TRIAL`.

| Property | Contract |
| --- | --- |
| Recipient | One user |
| Plan | The tier this grant contributes |
| Source | `ADMIN_GRANT` \| `PROMOTION` (extensible — see [future sources](../../../project/feature-specification/subscription/future.md)) |
| Validity window | A start time and an optional end time (`null` = indefinite) |
| Status | `ACTIVE` \| `REVOKED` — "expired" is derived from the window, never stored ([SB-EA-09](../../../project/feature-specification/subscription/decisions/effective-access-and-grants.md#sb-ea-09--grant-expiry-is-derived-when-read-never-written-by-a-read)) |
| Provenance | Who granted it (never the recipient themselves — [SB-EA-08](../../../project/feature-specification/subscription/decisions/effective-access-and-grants.md#sb-ea-08--administrators-cannot-grant-access-to-themselves)) or which promotion code, and why |

### Invariants

**Never requires Razorpay.** **Independent of any Subscription**
([SB-EA-03](../../../project/feature-specification/subscription/decisions/effective-access-and-grants.md#sb-ea-03--entitlement-sources-coexist-as-independent-records)).
**Auditable** — every creation, extension and revocation, in the same transaction
([`../../subscription/history-and-audit/admin-grant-audit.md`](../../subscription/history-and-audit/admin-grant-audit.md)).

---

## EffectiveAccess

Not a stored entity — the result of a computation.

| Property | Contract |
| --- | --- |
| Input | All of the user's Subscriptions in a contributing phase (`TRIALING`, `ACTIVE`, `PAST_DUE`) and of the deployment's expected billing mode, plus all grants valid now |
| Output | The highest tier among them, or `FREE` if none ([SB-EA-06](../../../project/feature-specification/subscription/decisions/effective-access-and-grants.md#sb-ea-06--effective-access-takes-the-maximum-over-every-contributing-subscription)) |
| Storage | None. Computed on read; a request-scoped memo is an optimization, not a storage decision |

See [`../../subscription/entitlements/effective-access-resolution.md`](../../subscription/entitlements/effective-access-resolution.md).

---

## BillingEvent

Every webhook event Kizunia has received and verified.

| Property | Contract |
| --- | --- |
| Identity | `(provider, dedupeKey)`, unique — the event ID header, or the raw-body hash if absent |
| Payload | The raw, verified body — retained for a bounded period |
| Metadata | Type, provider subscription ID, `account_id`, Razorpay `created_at`, received at, matched secret, provider mode |
| Status | `RECORDED` \| `UNMATCHED_PENDING` \| `UNMATCHED` \| `SKIPPED_UNSUPPORTED` |
| Linkage | The Subscription it concerns, when matched |

**Invariant.** Written, together with the Subscription's sync-due mark, before acknowledgement
([SB-WH-02](../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md#sb-wh-02--every-received-event-is-persisted-with-a-unique-constraint-dedupe-key-before-acknowledgement),
[SB-WH-05](../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md#sb-wh-05--acknowledgement-happens-before-asynchronous-processing-not-after)).
Never overwritten. Whether it has been *applied* is derived from the Subscription's sync state, not
stored.

---

## Charge, refund and dispute facts

Append-only records of money movements Razorpay reported (`subscription.charged`,
`refund.processed`, `payment.dispute.created`), each unique by its Razorpay payment/refund/dispute ID
([SB-WH-04](../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md#sb-wh-04--charges-are-recorded-as-append-only-facts-separate-from-current-state)).
They never change a Subscription's phase or anyone's access.

---

## SubscriptionHistoryEntry

The append-only record of every access-relevant change to a Subscription.

| Property | Contract |
| --- | --- |
| Subscription, user | Which one changed |
| Change | `phase` \| `plan` \| `scheduled_change` \| `cancel_at_period_end` \| `binding` \| `supersession`, with from/to |
| Cause | `kizunia_command` \| `provider_observed` \| `local` |
| Trigger | `webhook`, `checkout_confirm`, `command_response`, `command_confirm`, `checkpoint`, `heartbeat`, `retry`, `orphan_discovery`, `admin_sync`, `system` |
| References | Operation ID, event ID, actor, observation time |

See [`../../subscription/history-and-audit/subscription-history.md`](../../subscription/history-and-audit/subscription-history.md).

---

## BillingAnomaly

A situation synchronization detected and deliberately did not resolve automatically:
`MULTIPLE_OPEN_SUBSCRIPTIONS`, `UNMATCHED_PROVIDER_SUBSCRIPTION`, `NOTES_CONFLICT`,
`UNMAPPED_PROVIDER_PLAN`, `PROVIDER_MODE_MISMATCH`, `PROVIDER_SUBSCRIPTION_MISSING`,
`CANCELLATION_NOT_EFFECTIVE`, `TERMINAL_STATE_CONTRADICTED` (added in Phase IV, 2026-09-25, by
[IB-24](../../subscription/implementation/open-decisions.md#ib-24--phase-iv-implementation-rulings):
Razorpay reported a subscription Kizunia holds in a terminal phase in another state), and
`TRIAL_CONVERSION_OVERDUE` (added 2026-09-24 by
[IB-9](../../subscription/implementation/open-decisions.md#ib-9--trial-conversion-gap)). Carries the
user/subscriptions involved, first/last seen, and resolved at/by/reason. Resolving one records a
human decision; it never changes billing state by itself.

`MALFORMED` provider responses and non-JSON signed webhook bodies are **not** anomalies. They are
failure classes that raise a `billing.alert` and keep the last known state; nothing about them needs
a human resolution record (decided 2026-09-24,
[IB-17](../../subscription/implementation/open-decisions.md#ib-17--stale-documents-and-leftovers)(d)).

---

## ProviderReference

The opaque Razorpay identifiers a Subscription carries, kept structurally separate from Kizunia's own
domain identity.

| Property | Contract |
| --- | --- |
| Razorpay subscription ID | Bound once per Subscription; a resubscribe is a new Subscription with a new ID; never Kizunia's primary key |
| Razorpay plan ID | The underlying Razorpay Plan object (and the scheduled one, if a change is pending) |
| Offer ID, marketing code | If a billing discount is attached |

**Invariant.** Nothing outside the billing module reads these fields —
[SB-PB-04](../../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-04--razorpay-identifiers-never-leak-past-the-provider-boundary).

---

## What is not an entity here

| Not an entity | Why |
| --- | --- |
| "Effective access" | A computed value — see [`EffectiveAccess`](#effectiveaccess) |
| "Coupon" | Splits into a Razorpay-side Offer reference and a Kizunia-side `EntitlementGrant` (`PROMOTION`) — never one thing |
| A generic `AuditLog` | No such table exists; the billing records above are purpose-built |
| "Trial" as its own table | A trial is a `Subscription` of kind `TRIAL` |
| A "successor" or "scheduled" Subscription | V1 never represents a future plan as a second Subscription; a pending plan change is state on the existing one |
| A webhook-processing job | The Subscription's sync-due marker is the pending work ([SB-RC-04](../../../project/feature-specification/subscription/decisions/reconciliation.md#sb-rc-04--one-synchronization-mechanism-serves-webhooks-commands-and-reconciliation)) |
