# Database Design

> **Status:** Implementation plan — not implemented
>
> **Last Updated:** 2026-09-24
>
> **Blueprint section:** §3 (see the [section map](README.md#blueprint-section-map))

The mapping of the domain model onto the existing Prisma/PostgreSQL conventions: enums, models, relations, unique constraints, indexes, foreign keys, deletion behavior, concurrency constraints, and the fields needed for idempotency, provider synchronization and audit. This is a description, not the Prisma schema; no schema or migration is written here.

**Open decisions referenced here:** [IB-6](open-decisions.md#ib-6--composed-commands-and-the-in-flight-constraint), [IB-12](open-decisions.md#ib-12--soft-deleted-projects-and-the-quota), [IB-14](open-decisions.md#ib-14--account-removal-storage), [IB-17](open-decisions.md#ib-17--stale-documents-and-leftovers). Text that follows a recommended resolution is provisional until that item is ruled; see [open decisions](open-decisions.md).

---

Conventions (from `prisma/schema.prisma` and existing migrations): PascalCase models with `@@map("snake_case")`; camelCase columns (raw SQL must double-quote them); `@id @default(cuid())`; `createdAt @default(now())`, `updatedAt @updatedAt`; `DateTime` is `timestamp(3)` without time zone, so raw SQL binds with the `utc()` helper; enums PascalCase with SCREAMING values; partial unique indexes and CHECKs as hand-written `-- CustomIndex` / `-- CustomCheck` blocks; `ALTER TYPE … ADD VALUE` in its own migration.

## Enums

| Enum | Values | Note |
| --- | --- | --- |
| `MembershipPlan` | `PRO`, `PRO_PLUS` | `FREE` deliberately unrepresentable in storage (SB-EA-01). Declaration order = tier order |
| `BillingCycle` | `MONTHLY`, `YEARLY` | |
| `SubscriptionKind` | `STANDARD`, `TRIAL` | |
| `ProviderMode` | `TEST`, `LIVE` | `disabled` is never stamped |
| `SubscriptionPhase` | `PROVISIONING`, `PENDING_AUTHENTICATION`, `TRIALING`, `ACTIVE`, `PAST_DUE`, `HALTED`, `PAUSED`, `CANCELLED`, `EXPIRED`, `COMPLETED`, `ABANDONED` | |
| `SyncReason` | `WEBHOOK`, `CHECKOUT_CONFIRM`, `COMMAND_CONFIRM`, `CHECKPOINT`, `HEARTBEAT`, `RETRY`, `ADMIN` | |
| `ProviderFailureClass` | `TIMEOUT`, `UNAVAILABLE`, `RATE_LIMITED`, `CONCURRENT_OPERATION`, `REJECTED`, `NOT_FOUND`, `AUTH_FAILURE`, `MALFORMED`, `UNMAPPED_PLAN`, `BUDGET_EXHAUSTED` | |
| `BillingOperationKind` | `CREATE_SUBSCRIPTION`, `UPDATE_PLAN`, `CANCEL_AT_CYCLE_END`, `CANCEL_IMMEDIATELY`, `CANCEL_SCHEDULED_CHANGE`, `SUPERSEDE`, `CHANGE_PLAN` | Last two are parents |
| `BillingOperationStatus` | `IN_FLIGHT`, `SUCCEEDED`, `REJECTED`, `OUTCOME_UNKNOWN`, `NOT_APPLIED` | |
| `BillingActorKind` | `USER`, `ADMIN`, `SYSTEM` | |
| `BillingEventStatus` | `RECORDED`, `UNMATCHED_PENDING`, `UNMATCHED`, `SKIPPED_UNSUPPORTED` | |
| `BillingProvider` | `RAZORPAY` | Only because `(provider, dedupeKey)` is the documented identity |
| `MoneyFactKind` | `CHARGE`, `REFUND`, `DISPUTE` | One table (the docs leave "shared table?" open; one is simpler) |
| `HistoryChange` | `PHASE`, `PLAN`, `SCHEDULED_CHANGE`, `CANCEL_AT_PERIOD_END`, `BINDING`, `SUPERSESSION` | |
| `HistoryCause` | `KIZUNIA_COMMAND`, `PROVIDER_OBSERVED`, `LOCAL` | |
| `HistoryTrigger` | `WEBHOOK`, `CHECKOUT_CONFIRM`, `COMMAND_RESPONSE`, `COMMAND_CONFIRM`, `CHECKPOINT`, `HEARTBEAT`, `RETRY`, `ORPHAN_DISCOVERY`, `ADMIN_SYNC`, `SYSTEM` | |
| `EntitlementSource` | `ADMIN_GRANT`, `PROMOTION` | Extensible (future one-time purchases) |
| `GrantStatus` | `ACTIVE`, `REVOKED` | No `EXPIRED` (SB-EA-09) |
| `GrantAuditAction` | `CREATED`, `EXTENDED`, `REVOKED` | |
| `BillingAnomalyType` | `MULTIPLE_OPEN_SUBSCRIPTIONS`, `UNMATCHED_PROVIDER_SUBSCRIPTION`, `NOTES_CONFLICT`, `UNMAPPED_PROVIDER_PLAN`, `PROVIDER_MODE_MISMATCH`, `PROVIDER_SUBSCRIPTION_MISSING`, `CANCELLATION_NOT_EFFECTIVE` | `MALFORMED` stays alert-only unless IB-17(d) adds it |

## Models

**`Subscription`** → `subscription`

| Field | Type | Purpose |
| --- | --- | --- |
| `id` | cuid | Only ID other modules may hold |
| `userId` | String? → User, **Restrict** | Owner; nulled only by pseudonymization (IB-14) |
| `subjectPseudonym` | String? | Set on account removal |
| `kind`, `providerMode` | enums | Stamped at creation, immutable |
| `plan`, `cycle` | enums | Requested at creation; then as last observed |
| `phase` | enum | Written only by apply path / local `ABANDONED` |
| `providerSubscriptionId` | String? | Bound once |
| `providerPlanId`, `offerId`, `marketingCode` | String? | Provider reference (billing-internal) |
| `providerStatus`, `providerSnapshot` | String?, Json? | Last observation (billing-internal, SB-PB-04 amended) |
| `currentPeriodStart`, `currentPeriodEnd`, `chargeAt`, `startAt`, `expireBy`, `endedAt` | DateTime? | Checkpoints and display |
| `scheduledPlan`, `scheduledCycle`, `scheduledProviderPlanId`, `scheduledChangeAt`, `scheduledByOperationId` | ? | Pending change |
| `cancelAtPeriodEnd` Bool @default(false), `cancelRequestedAt`, `cancelRequestedByOperationId` | | Kizunia's own claim |
| `advisoryPaymentMethod` String?, `advisoryInternationalCard` Bool? | | UX only (SB-LC-07) |
| `firstContributedAt` | DateTime? | Set by apply on first entry to `TRIALING`/`ACTIVE`/`PAST_DUE`; backs trial and offer eligibility cheaply |
| `syncDueAt`, `syncReason`, `syncRequestedAt`, `syncAttempts` Int @default(0), `syncLeaseUntil`, `lastSyncedAt`, `lastAppliedObservationAt`, `lastSyncFailureClass` | | Sync state |
| `supersededById` | String? @unique → Subscription, Restrict | |
| `createdAt`, `updatedAt` | | |

- **Unique:** `(providerMode, providerSubscriptionId)`, which makes SB-UQ-01 a DB fact (NULLs allowed while `PROVISIONING`). `supersededById`.
- **Indexes:** `(userId, phase)` for resolution and the open-count check; **partial** `(providerMode, syncDueAt) WHERE "syncDueAt" IS NOT NULL` for the claim; `(providerMode, phase)` for admin, metrics and the orphan window; `(userId, kind)` for trial eligibility.
- **CHECKs:** `phase <> 'PROVISIONING' OR "providerSubscriptionId" IS NULL OR …` is not needed. Add only: `"syncAttempts" >= 0`; terminal phases have `"syncDueAt" IS NULL`, which catches a buggy `nextDue`.
- **Deliberately absent:** a DB constraint on the number of open subscriptions (SB-UQ-02 is a creation rule).

**`BillingOperation`** → `billing_operation`

`id`, `userId` String? → User Restrict, `subjectPseudonym`, `subscriptionId` String? → Subscription Restrict, `parentOperationId` String? → self Restrict, `kind`, `status` @default(IN_FLIGHT), `providerMode`, `actorKind`, `actorUserId` String? (plain string, no FK: audit survives admin removal), `idempotencyKey` String, `request` Json (normalized intent, never a raw provider payload), `leaseUntil` DateTime?, `requestSentAt` DateTime?, `resolvedAt`, `failureClass`?, `providerErrorCode` String?, `providerErrorDescription` String? (diagnosis only, never shown), `createdAt`, `updatedAt`.

- **Unique:** `(userId, idempotencyKey)`.
- **Partial unique (CustomIndex):** `(userId) WHERE status = 'IN_FLIGHT' AND "parentOperationId" IS NULL` (IB-6).
- **Indexes:** `(status, leaseUntil)` for lease expiry; `(userId, status, createdAt)` for the outcome-unknown window; `(subscriptionId, createdAt)`.

**`BillingEvent`** → `billing_event`

`id`, `provider`, `providerMode`, `dedupeKey`, `dedupeSource` (`HEADER` | `BODY_SHA256`), `eventType` String, `providerSubscriptionId` String?, `accountId` String?, `providerCreatedAt` DateTime?, `receivedAt`, `matchedSecret` (`CURRENT` | `PREVIOUS`), `status`, `subscriptionId` String? → Subscription Restrict, `duplicateCount` Int @default(0), `rawPayload` Json?, `payloadPrunedAt` DateTime?.

- **Unique:** `(provider, dedupeKey)`.
- **Indexes:** `(providerSubscriptionId, receivedAt)`; `(status, receivedAt)` for unmatched review; `(receivedAt) WHERE "rawPayload" IS NOT NULL` for pruning; `(providerMode, receivedAt)` for `WEBHOOK_SILENCE`.
- No `userId` column: an event reaches a user only through its Subscription, so nothing to pseudonymize except payload (pruned).

**`BillingMoneyFact`** → `billing_money_fact`

`id`, `kind`, `providerMode`, `providerObjectId` (payment/refund/dispute ID), `subscriptionId`? Restrict, `userId`? Restrict + `subjectPseudonym`, `billingEventId`? Restrict, `amountMinor` Int, `currency`, `providerInvoiceId`?, `periodStart`?, `periodEnd`?, `occurredAt`, `createdAt`. **Unique** `(providerMode, kind, providerObjectId)`.

**`SubscriptionHistoryEntry`** → `subscription_history_entry`

`id`, `subscriptionId` → Subscription Restrict, `userId`? Restrict + `subjectPseudonym`, `change`, `fromValue` String?, `toValue` String?, `cause`, `trigger`, `operationId`? → BillingOperation Restrict, `billingEventId`? → BillingEvent Restrict, `actorUserId` String? (plain), `observationAt`?, `recordedAt @default(now())`. **Indexes** `(subscriptionId, recordedAt)`, `(userId, recordedAt)`.

**`EntitlementGrant`** → `entitlement_grant`

`id`, `userId`? → User Restrict + `subjectPseudonym`, `plan`, `source`, `status` @default(ACTIVE), `validFrom`, `validUntil`?, `grantedByUserId` String? (plain), `promotionId`? → Promotion Restrict, `reason` String, `revokedAt`?, `revokedByUserId`?, `revokeReason`?, `createdAt`, `updatedAt`.

- **Index:** `(userId, status, validUntil)`, the resolver's grant read (docs).
- **CHECKs:** `"validUntil" IS NULL OR "validUntil" > "validFrom"`; `source <> 'ADMIN_GRANT' OR ("grantedByUserId" IS NOT NULL AND "grantedByUserId" <> "userId")` (SB-EA-08 as defense in depth; the service refuses first); `source <> 'PROMOTION' OR "promotionId" IS NOT NULL`.

**`GrantAuditEntry`** → `grant_audit_entry`: `id`, `grantId` → EntitlementGrant Restrict, `action`, `performedByUserId` String (plain), `targetUserId`? + `subjectPseudonym`, `plan`, `previousValidUntil`?, `newValidUntil`?, `reason`, `promotionId`?, `createdAt`. Index `(grantId, createdAt)`, `(targetUserId, createdAt)`.

**`BillingAnomaly`** → `billing_anomaly`: `id`, `type`, `providerMode`, `userId`? Restrict + `subjectPseudonym`, `subscriptionIds` String[], `providerSubscriptionId`?, `subjectKey` String (for example `user:<id>` or `psub:<id>`), `details` Json, `firstSeenAt`, `lastSeenAt`, `occurrences` Int, `resolvedAt`?, `resolvedByUserId`?, `resolutionReason`?. **Partial unique** `(type, "subjectKey") WHERE "resolvedAt" IS NULL`: raise is an upsert on the open row, so repeated detection bumps `lastSeenAt`/`occurrences` and `P2002` means "already open".

**`BillingProviderState`** → `billing_provider_state`: `providerMode` @id, `cooldownUntil`?, `cooldownLevel` Int @default(0), `consecutiveFailures` Int, `authFailurePinnedKeyFingerprint` String?, `orphanWatermark` DateTime?, `orphanWindowTo`?, `orphanSkip` Int @default(0), `updatedAt`. The pin applies only while the configured key's fingerprint (a hash of the key ID) matches, so rotating keys and redeploying un-pins without manual SQL. This satisfies "until credentials are fixed and the process restarts".

**`Promotion`**, **`PromotionRedemption`** (S14): `Promotion { id, code @unique, plan, durationDays, remainingRedemptions Int?, validFrom, validUntil?, eligibility, createdByUserId, createdAt }`; `PromotionRedemption { id, promotionId Restrict, userId Restrict + subjectPseudonym, grantId @unique, createdAt, @@unique([promotionId, userId]) }`; CHECK `"remainingRedemptions" IS NULL OR "remainingRedemptions" >= 0`.

**Existing model change:** `ProjectMember` gets `@@index([userId, role])` (IB-12). `User` gets back-relations only; there are no new User columns.

## Deletion behavior

- **Every** FK from a billing table to `User` is `onDelete: Restrict` (Prisma default for required relations is also restrictive, but state it explicitly). This is the database form of SB-DP-04: Better Auth's `remove-user` fails for any user with billing rows instead of cascading. Existing cascades such as `ProjectMember` and `Portfolio` are untouched.
- Billing-to-billing FKs are `Restrict`: nothing billing is ever deleted except `rawPayload` content (nulled, never the row).
- Actor columns (`actorUserId`, `grantedByUserId`, `performedByUserId`, `resolvedByUserId`) are plain strings. An admin's removal must not rewrite audit, and a FK would force `SetNull`, which loses it.
- Pseudonymization (S16, IB-14): one transaction sets `userId = NULL` and `subjectPseudonym = <random per removed user>` on `subscription`, `billing_operation`, `billing_money_fact`, `subscription_history_entry`, `entitlement_grant`, `grant_audit_entry.targetUserId`, `billing_anomaly`, and `promotion_redemption`, then deletes the user. It is refused while any Subscription is open.

## Concurrency, idempotency, sync and audit fields (summary)

| Concern | Mechanism |
| --- | --- |
| Two concurrent commands per user | Partial unique `billing_operation(userId) WHERE IN_FLIGHT AND root`; `P2002` → 409 `BILLING_OPERATION_IN_PROGRESS` |
| Client retry | Unique `(userId, idempotencyKey)` |
| Webhook duplicates | Unique `(provider, dedupeKey)`; fact unique `(mode, kind, providerObjectId)` |
| Provider ID uniqueness | Unique `(providerMode, providerSubscriptionId)` |
| Two workers syncing one subscription | Raw-SQL claim `FOR UPDATE SKIP LOCKED` + `syncLeaseUntil` |
| Stale observation | `SELECT … FOR UPDATE` + `lastAppliedObservationAt` compare |
| Promotion double redemption | Unique `(promotionId, userId)` + conditional decrement |
| Project quota race | `pg_advisory_xact_lock` inside `ProjectService.create`'s transaction |
| Budget | Conditional increment on `rate_limit` |
| Anomaly dedupe | Partial unique on open `(type, subjectKey)` |

---

## Related documents

**In this directory**

- [Domain Model](domain-model.md)
- [Billing Command Model](command-model.md)
- [Synchronization](synchronization.md)
- [Open decisions](open-decisions.md) · [Settled decisions](settled-decisions.md) · [Index](README.md)

**Design and specification**

- [Domain relationships — storage is an implementation-phase decision](../../domain/subscription/relationships.md#storage-is-an-implementation-phase-decision)
- [SB-DP-04 — billing records survive account removal](../../../project/feature-specification/subscription/decisions/data-preservation.md#sb-dp-04--billing-records-survive-account-removal)
- [Operation model](../commands/operation-model.md)
- [Webhook reliability and idempotency](../webhooks/reliability-and-idempotency.md)
- [Subscription history](../history-and-audit/subscription-history.md)
