# Domain Model

> **Status:** Implementation plan — not implemented
>
> **Last Updated:** 2026-09-24
>
> **Blueprint section:** §2 (see the [section map](README.md#blueprint-section-map))

The conceptual domain model. For every entity: responsibility, important fields, relationships, lifecycle, ownership and invariants. This is conceptual; the mapping onto Prisma/PostgreSQL is in [database design](database-design.md).

---

`FREE` is never stored. A trial is a `Subscription` of kind `TRIAL`. Effective access is computed, never stored.

| Entity | Responsibility | Important fields | Relationships | Lifecycle | Owner | Invariants |
| --- | --- | --- | --- | --- | --- | --- |
| **Plan** (code catalog) | Plan identity, ordering, capabilities, quotas | `FREE < PRO < PRO_PLUS`; per plan: `ownedProjectLimit`, `portfolio`, `deadlineNotifications`, `recommendations`, `mcp` | Referenced by Subscription.plan, EntitlementGrant.plan | Changed by deploy (SB-PL-04) | `lib/entitlements` | Only the capability layer reads the mapping; identity never renamed |
| **Provider plan catalog** (config, per mode) | Razorpay plan ID → `(plan, cycle)`, many-to-one; also create-time plan ID per `(plan, cycle)` and display price | `mode`, `providerPlanId`, `plan`, `cycle`, `retired`, `displayAmountPaise` | Used by create and sync apply | Retired IDs stay while in use | billing/config | Unknown ID → `UNMAPPED_PLAN`, not applied (SB-PB-05) |
| **Subscription** | One Razorpay subscription, for its whole life, in Kizunia's vocabulary | kind, providerMode, plan, cycle, phase, period, scheduled change, `cancelAtPeriodEnd`, provider reference, provider snapshot, advisory payment method, sync state, `supersededById`, `firstContributedAt` | User 1–n; operations, history, events, facts; self (supersededBy) | Created `PROVISIONING` before the provider call; phase changes only via applied observation (or local `ABANDONED`); never deleted | billing | Provider ID bound once, unique per mode (SB-UQ-01); written before call (SB-CM-02); Kizunia never creates a second open one (SB-UQ-02) |
| **Phase** (value) | Kizunia state | 11 phases, see [state model](state-model.md) | — | — | billing/policy | Written only by the apply path |
| **Scheduled change** (on Subscription) | A pending `cycle_end` plan change | `scheduledPlan`, `scheduledCycle`, `scheduledProviderPlanId`, `scheduledChangeAt`, `scheduledByOperationId` | — | Set by UPDATE_PLAN(cycle_end); cleared on apply or cancel | billing | At most one (SB-LC-08) |
| **Cycle-end cancellation claim** (on Subscription) | Kizunia's own record that it asked for a cycle-end cancel | `cancelAtPeriodEnd`, `cancelRequestedAt`, `cancelRequestedByOperationId` | → BillingOperation | Set by a settled CANCEL_AT_CYCLE_END; cleared only by `CANCELLED` or by `CANCELLATION_NOT_EFFECTIVE` detection | billing | Razorpay shows nothing (A2); never cleared because the entity lacks it |
| **BillingOperation** | Every provider mutation Kizunia attempts | kind, status, userId, subscriptionId, parentOperationId, actor, idempotencyKey, request, leaseUntil, requestSentAt, failureClass, providerError*, resolvedAt | User, Subscription, parent | `IN_FLIGHT → SUCCEEDED / REJECTED / OUTCOME_UNKNOWN → SUCCEEDED / NOT_APPLIED` | billing | ≤ 1 root `IN_FLIGHT` per user (DB); committed before the call; never deleted |
| **BillingEvent** | Every verified webhook | provider, providerMode, dedupeKey, eventType, providerSubscriptionId, accountId, providerCreatedAt, receivedAt, matchedSecret, status, subscriptionId, rawPayload | Subscription 0..1 | Inserted once; payload pruned after retention; status `UNMATCHED_PENDING → UNMATCHED` possible | billing | Unique `(provider, dedupeKey)`; written with the sync mark before the 2xx; "applied" is derived, never stored |
| **Money fact** (charge/refund/dispute) | Append-only money movements Razorpay reported | kind, providerObjectId, amount, currency, invoice/period, occurredAt, billingEventId | Subscription, BillingEvent | Insert only | billing | Unique per provider object; never changes access (SB-WH-04) |
| **SubscriptionHistoryEntry** | Every access-relevant change | change, from, to, cause, trigger, operationId, eventId, actor, observationAt, recordedAt | Subscription, User | Append only | billing | Written in the same transaction as the change |
| **EntitlementGrant** | Non-billing entitlement source (admin grant, promotion) | userId, plan, source, status, validFrom, validUntil, grantedBy, promotionId, reason, revoked* | User, Promotion | `ACTIVE → REVOKED`; expiry derived | billing (writes) / entitlements (reads) | Never touches Razorpay; no self-grant (SB-EA-08); expiry never written (SB-EA-09) |
| **GrantAuditEntry** | Audit of grant actions | grantId, action, performedBy, targetUser, plan, previous/new `validUntil`, reason, promotionId | EntitlementGrant | Append only | billing | Same transaction as the grant change |
| **Promotion / PromotionRedemption** | Free-access codes (S14) | code, plan, duration, remainingRedemptions, window, eligibility; redemption `(promotionId, userId)` | → EntitlementGrant | Decrement conditionally | billing | Unique redemption + conditional decrement (SB-CP-04) |
| **Marketing-code → Offer map** (config, per mode) | Billing discounts (S14) | code, offerId per mode, plans, eligibility, window | Stored on the Subscription as `marketingCode`/`offerId` | Deploy | billing/config | Eligibility checked before any call |
| **BillingAnomaly** | Situations left for a human | type, userId, subscriptionIds, providerSubscriptionId, mode, subjectKey, first/lastSeenAt, occurrences, details, resolved* | User, Subscriptions | Open → resolved (with reason) | billing | Resolving never changes billing state |
| **BillingProviderState** (per mode) | Global cooldown; auth-failure pin; orphan-scan watermark | cooldownUntil, cooldownLevel, authFailurePinnedKeyFingerprint, orphanWatermark, orphanWindowTo, orphanSkip | — | Mutated by the budget and the orphan task | billing | One row per mode |
| **EffectiveAccess** (computed) | Highest valid tier → capabilities and quotas | plan, capabilities, quotas, sources[] (for explain) | reads Subscription + EntitlementGrant | Per read | lib/entitlements | Zero provider calls; deterministic max |
| **Trial** | — | `Subscription.kind = TRIAL`, `startAt` = trial end | — | — | billing | Kind recorded at creation, never inferred (SB-LC-10); one per account (SB-LC-11) |

---

## Related documents

**In this directory**

- [Database Design](database-design.md)
- [Subscription State Model](state-model.md)
- [Open decisions](open-decisions.md) · [Settled decisions](settled-decisions.md) · [Index](README.md)

**Design and specification**

- [Domain model — overview](../../domain/subscription/overview.md)
- [Domain model — entities](../../domain/subscription/entities.md)
- [Domain model — relationships](../../domain/subscription/relationships.md)
- [Multiple subscriptions](../lifecycle/multiple-subscriptions.md)
