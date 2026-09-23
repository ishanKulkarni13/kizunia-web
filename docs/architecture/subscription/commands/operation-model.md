# Operation Model

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24

Mechanism behind [SB-CM-01 through SB-CM-05](../../../project/feature-specification/subscription/decisions/commands-and-idempotency.md).

---

## `BillingOperation`

One record per provider mutation Kizunia attempts. It is the durable answer to "did Kizunia ask
Razorpay to do this, and what happened?"

| Field | Contract |
| --- | --- |
| `kind` | `CREATE_SUBSCRIPTION` · `UPDATE_PLAN` · `CANCEL_AT_CYCLE_END` · `CANCEL_IMMEDIATELY` · `CANCEL_SCHEDULED_CHANGE`, plus the parent kinds `SUPERSEDE` and `CHANGE_PLAN` for composed commands |
| `userId` | The user whose billing this changes (always present) |
| `subscriptionId` | The Kizunia Subscription it targets (for `CREATE_SUBSCRIPTION`, the `PROVISIONING` record) |
| `actor` | `user:<id>` or `admin:<id>` — who asked |
| `idempotencyKey` | Client-supplied for user requests, generated for admin/system-composed steps; unique per `(userId, idempotencyKey)` |
| `request` | The normalized intent (target plan/cycle, `atCycleEnd`, offer code…), never raw provider payloads |
| `status` | `IN_FLIGHT` → `SUCCEEDED` \| `REJECTED` \| `OUTCOME_UNKNOWN`; `OUTCOME_UNKNOWN` → `SUCCEEDED` \| `NOT_APPLIED` once resolved |
| `leaseUntil` | While `IN_FLIGHT`: after this, the operation is treated as `OUTCOME_UNKNOWN` |
| `requestSentAt` | When the provider request was sent — the observation time used by the stale-apply guard |
| `failureClass` | From the [provider failure taxonomy](../reconciliation/provider-rate-limits.md#provider-failure-taxonomy), when not `SUCCEEDED` |
| `providerErrorCode` | Razorpay's error code/description, stored for diagnosis (never shown raw to users) |
| `parentOperationId` | For composed commands (e.g. supersession's cancel step) |

**Invariants.**

- **At most one `IN_FLIGHT` operation per user**, enforced by a database constraint (for example a
  partial unique index on `userId` where `status = 'IN_FLIGHT'`) — never by a read-then-insert check.
- **Never deleted, never rewritten** except the status transitions above. An operation is an audit
  record ([`../history-and-audit/README.md`](../history-and-audit/README.md)).
- **Written in its own committed transaction before the provider call.** The provider call never
  happens inside a database transaction.

## The command lifecycle

```text
1. Authorize           session actor; admin actions via PlatformAuthorizer (see cross-cutting/security.md)
2. Idempotency lookup  (userId, idempotencyKey) exists?
                         -> SUCCEEDED/REJECTED: return the recorded result, do nothing
                         -> IN_FLIGHT/OUTCOME_UNKNOWN: return "in progress" with the operation id
3. Begin               one transaction:
                         - insert BillingOperation(IN_FLIGHT, leaseUntil = now + lease)
                           (unique violation on the in-flight constraint -> 409 "a billing change
                            is already in progress"; nothing else written)
                         - evaluate preconditions against local state (uniqueness, phase, eligibility)
                           -> fail: mark REJECTED in the same transaction, return a typed error
                         - for creation: insert Subscription(PROVISIONING)
                       commit
4. Budget              acquire a priority-1 slot from the provider request budget
                         -> unavailable: mark REJECTED(failureClass = BUDGET_EXHAUSTED), return
                            "billing is temporarily busy" — nothing was sent
5. Call                record requestSentAt; call Razorpay with a bounded client timeout
6. Classify            SUCCEEDED | REJECTED | OUTCOME_UNKNOWN (see below)
7. Apply               SUCCEEDED: apply the returned entity through the sync apply path
                       (observation time = requestSentAt), mark the subscription sync-due for
                       confirmation, mark the operation SUCCEEDED — one transaction
8. Respond             the user sees the resulting local state, never an optimistic guess
```

## Classifying the outcome

| Provider result | Operation status | Local subscription state |
| --- | --- | --- |
| 2xx with a valid entity | `SUCCEEDED` | Applied via the sync apply path |
| 4xx business rejection (`BAD_REQUEST_ERROR`: wrong state, payment method cannot be updated, below ₹0.5 proration, expired offer…) | `REJECTED` | Unchanged; subscription marked sync-due if the rejection suggests local state is stale (e.g. "not in authenticated/active state") |
| "another subscription operation is in progress" | `REJECTED` (`CONCURRENT_OPERATION`) | Unchanged; subscription marked sync-due; the user may retry |
| 429 before any processing | `REJECTED` (`RATE_LIMITED`) | Unchanged; global cooldown set |
| 401/403 (credentials) | `REJECTED` (`AUTH_FAILURE`) | Unchanged; all provider calls stop; operations paged |
| Timeout, connection reset, 5xx, malformed body | `OUTCOME_UNKNOWN` | Unchanged; subscription marked sync-due (update/cancel) or orphan resolution scheduled (create) |
| Process died after step 5 | `IN_FLIGHT` until `leaseUntil`, then `OUTCOME_UNKNOWN` | Unchanged |

A 429 is classified `REJECTED` rather than `OUTCOME_UNKNOWN` because a rate-limited request was not
processed. A 5xx is `OUTCOME_UNKNOWN` because Razorpay may have applied the change before failing.

## Resolving `OUTCOME_UNKNOWN`

Resolution is observation-only ([SB-CM-03](../../../project/feature-specification/subscription/decisions/commands-and-idempotency.md#sb-cm-03--an-outcome-unknown-command-is-resolved-by-observation-never-by-blind-retry)):

| Kind | How it is resolved | Resolved as |
| --- | --- | --- |
| `CREATE_SUBSCRIPTION` | Orphan discovery searches the creation window for `notes.kz_sub = <Subscription id>` ([`orphan-discovery.md`](../reconciliation/orphan-discovery.md)); a webhook carrying those notes resolves it sooner ([SB-WH-06](../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md#sb-wh-06--events-for-unknown-subscriptions-are-persisted-and-matched-never-dropped)) | Found → provider ID bound, `SUCCEEDED`. Window closed without a match → Subscription `ABANDONED`, operation `NOT_APPLIED` |
| `UPDATE_PLAN` | Next sync: the provider plan (or a pending scheduled change) equals the requested plan | `SUCCEEDED` or `NOT_APPLIED` |
| `CANCEL_IMMEDIATELY` | Next sync: status `cancelled` | `SUCCEEDED` or `NOT_APPLIED` |
| `CANCEL_AT_CYCLE_END` | Not observable from the entity ([open item A2](../../../project/feature-specification/subscription/open-decisions.md#a-razorpay-behavior-requiring-test-mode-verification-or-support)); resolved when the subscription is observed `cancelled` at period end, or offered to the user to re-issue (expected to be harmless; [A14](../../../project/feature-specification/subscription/open-decisions.md#a-razorpay-behavior-requiring-test-mode-verification-or-support)) | `SUCCEEDED` or `NOT_APPLIED` |
| `CANCEL_SCHEDULED_CHANGE` | Next sync: `has_scheduled_changes = false` | `SUCCEEDED` or `NOT_APPLIED` |

Until resolved, the user sees "your last billing change is still being confirmed" and may not issue
another command for that user (the in-flight constraint covers only `IN_FLIGHT`; a dedicated check
refuses new commands while an `OUTCOME_UNKNOWN` operation for the same user is younger than the
resolution window). An `OUTCOME_UNKNOWN` operation older than the alert threshold raises
`OPERATION_OUTCOME_UNKNOWN` for operations.

## Command catalog

| Command | Allowed when (local) | Provider call | Access changes when |
| --- | --- | --- | --- |
| Start checkout (paid plan or trial) | No open Subscription, or reuse/supersede per [SB-UQ-03](../../../project/feature-specification/subscription/decisions/uniqueness-and-resubscription.md#sb-uq-03--a-new-purchase-while-a-paid-subscription-is-live-is-refused-not-duplicated); trial eligibility per [SB-LC-11](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-11--one-trial-per-account) | Create Subscription | Sync observes `authenticated` (trial) or `active` |
| Change plan (paid→paid) | `ACTIVE` or `TRIALING` | Update Subscription (`now` for upgrades, `cycle_end` for downgrades), preceded by Cancel an Update if a change is pending | Sync observes the new plan |
| Cancel (customer) | `ACTIVE`, `PAST_DUE` → cycle end; `TRIALING` → immediate | Cancel (`cancel_at_cycle_end` true / false) | Sync observes `cancelled` |
| Cancel immediately (admin) | Any open phase | Cancel (`false`) | Sync observes `cancelled` |
| Abandon checkout | `PENDING_AUTHENTICATION` | Cancel (`false`) — see [open item A1](../../../project/feature-specification/subscription/open-decisions.md#a-razorpay-behavior-requiring-test-mode-verification-or-support) | n/a |
| Supersede | `HALTED` or `PAUSED`, user confirmed | Cancel (`false`), sync-confirmed, then Start checkout | Per the new subscription |

Composed commands (plan change after cancelling a scheduled change; supersession) run as a parent
operation with child operations, sequentially, each recorded; a failed child stops the parent with
nothing further sent.

## Why per-user, not per-subscription, serialization

The most dangerous race — two browser tabs each starting a checkout — has no subscription to lock
yet. Per-user serialization covers it, and costs nothing in practice: one user issuing two billing
changes at once is never legitimate.
