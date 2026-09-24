# Sync Mechanism

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24

The single mechanism by which Kizunia reads Razorpay subscription state and applies it
([SB-RC-04](../../../project/feature-specification/subscription/decisions/reconciliation.md#sb-rc-04--one-synchronization-mechanism-serves-webhooks-commands-and-reconciliation)).
Webhook refetches, checkout confirmation, post-command confirmation, due reconciliation and admin
"sync now" are all *triggers* of this mechanism, not separate code paths.

---

## Sync state on each Subscription

| Field | Meaning |
| --- | --- |
| `syncDueAt` | When this Subscription next needs an authoritative fetch; `null` for terminal Subscriptions |
| `syncReason` | The trigger that last set `syncDueAt` (`webhook`, `checkout_confirm`, `command_confirm`, `checkpoint`, `heartbeat`, `retry`, `admin`) |
| `syncRequestedAt` | When the most recent *event-driven* trigger (webhook, confirmation, admin) was recorded |
| `syncAttempts` | Consecutive failed attempts since the last success (drives backoff) |
| `syncLeaseUntil` | Set when claimed; another worker may claim only after it passes |
| `lastSyncedAt` | Last successful fetch |
| `lastAppliedObservationAt` | Observation time of the last provider state applied (the stale-apply watermark) |
| `lastSyncFailureClass` | Last failure class, for diagnosis and alerting |
| `providerStatus`, `providerSnapshot` | Last fetched raw status and normalized entity — billing-module-internal ([SB-PB-04](../../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-04--razorpay-identifiers-never-leak-past-the-provider-boundary)) |

Indexed for "due, unleased, current provider mode, ordered by `syncDueAt`".

## Marking sync-due

Any trigger performs one idempotent write:

```text
syncDueAt       := min(coalesce(syncDueAt, +inf), <requested time>)
syncReason      := <trigger>
syncRequestedAt := now            -- event-driven triggers only
```

Taking the minimum means ten webhooks in a burst leave one due time — *coalescing* — and a later
heartbeat never postpones an earlier urgent request. Marking is always done inside the transaction
that records its cause (the `BillingEvent` insert, the `BillingOperation` update), so the cause and
the pending work are durable together.

## Claiming

```text
UPDATE subscription SET syncLeaseUntil = now + lease
WHERE id IN (
  SELECT id FROM subscription
  WHERE syncDueAt <= now
    AND (syncLeaseUntil IS NULL OR syncLeaseUntil < now)
    AND providerMode = <current mode>
  ORDER BY syncDueAt
  LIMIT <batch>
  FOR UPDATE SKIP LOCKED)
RETURNING ...
```

The same claim-with-lease pattern as the notification work queue
([`../../notifications/jobs/README.md`](../../notifications/jobs/README.md#claiming)), including its
raw-SQL hazards (UTC binding, enum casts, explicit `updatedAt`). Differences: the work item is the
Subscription row itself, and there is no attempt cap — a billing sync is never abandoned
([SB-RC-07](../../../project/feature-specification/subscription/decisions/reconciliation.md#sb-rc-07--provider-failures-back-off-and-never-change-local-state)).
A targeted claim (`WHERE id = <one subscription>`) is used by the immediate paths.

## Fetching

Outside any transaction:

1. Acquire a slot from the [provider request budget](provider-rate-limits.md) at the trigger's
   priority. None available → release the lease, leave `syncDueAt` as is, stop this batch.
2. Record `observationAt = now` (request send time).
3. `fetchSubscription(providerSubscriptionId)` with a bounded client timeout.
4. Classify the result ([failure taxonomy](provider-rate-limits.md#provider-failure-taxonomy)).

A `PROVISIONING` Subscription with no provider ID yet is not fetched; it is resolved by
[orphan discovery](orphan-discovery.md).

## Applying an observation

The single apply path, used by sync results *and* command responses
([SB-CM-05](../../../project/feature-specification/subscription/decisions/commands-and-idempotency.md#sb-cm-05--command-responses-are-applied-through-the-same-path-as-synchronization)):

```text
BEGIN
  SELECT ... FROM subscription WHERE id = :id FOR UPDATE
  IF :observationAt <= lastAppliedObservationAt:           -- SB-RC-08 stale-apply guard
      log "stale observation discarded"; COMMIT; return
  validate: known status, plan id in the catalog, notes consistent with this record
      -> invalid: record the failure class (MALFORMED / UNMAPPED_PLAN), raise anomaly,
                  do NOT change phase/plan; schedule retry; COMMIT; return
  newPhase := map(providerStatus, kind, start_at)          -- lifecycle/state-mapping.md
  write providerStatus, providerSnapshot, plan, cycle, period, scheduled change, phase
  IF anything access-relevant changed: INSERT SubscriptionHistoryEntry (cause from syncReason)
  lastAppliedObservationAt := :observationAt; lastSyncedAt := now
  syncAttempts := 0; syncLeaseUntil := null
  syncDueAt := IF syncRequestedAt > :observationAt THEN now   -- a trigger arrived after this
               ELSE nextDue(newPhase, snapshot)              -- request was sent; see below
  resolve any BillingOperation this observation settles (commands/operation-model.md)
  re-check the user's open-subscription count (lifecycle/multiple-subscriptions.md#detection)
COMMIT
```

Effective access is not "recalculated" or cached anywhere — it is computed on read from these rows
([`../entitlements/effective-access-resolution.md`](../entitlements/effective-access-resolution.md)),
so the commit *is* the access change.

**Why the request send time is the right watermark.** A Razorpay response to a request sent at t2
reflects state at least as new as the response to a request sent at t1 < t2, whichever response
arrives first. Receive time would not order them; a provider-side version number would, but none
is documented.

## Failure handling

On a retryable failure the claim is released with backoff:

```text
syncAttempts += 1
syncDueAt    := now + min(cap, base * 2^syncAttempts) * random(0.5, 1.0)   -- jittered
lastSyncFailureClass := <class>
```

Local phase, plan and access are untouched ([SB-RC-07](../../../project/feature-specification/subscription/decisions/reconciliation.md#sb-rc-07--provider-failures-back-off-and-never-change-local-state)).
Past a threshold of consecutive failures or of time since `lastSyncedAt`, `SYNC_OVERDUE` is raised.
Global cooldown and non-retryable classes are handled per
[`provider-rate-limits.md`](provider-rate-limits.md#provider-failure-taxonomy).

## Where it runs

| Runner | Claims | Budget priority | Bound |
| --- | --- | --- | --- |
| Checkout confirmation / command endpoint | That one Subscription | 2 / 1 | One fetch, inside the request |
| Webhook `after()` | The Subscription(s) the event marked | 2 | A small fixed number, after the 2xx is sent |
| Tick task `billing-sync` | Oldest due first | 3 (2 for rows whose `syncReason` is `webhook`/`checkout_confirm`) | Batch size and a wall-clock budget below the tick's `maxDuration`; stops cleanly and leaves the rest due |
| Admin "sync now" | That one Subscription | 1 | One fetch |

All four call the same service; the tick task is registered in `next/src/lib/internal-jobs/registry.ts`
with a minimum interval no larger than the target cadence
([SB-PB-06](../../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-06--billing-execution-is-scheduler-agnostic)).
`after()` is best-effort by nature — if the platform ends the invocation early, the lease expires and
the tick picks the row up.

## Concurrency, exhaustively

| Race | Outcome |
| --- | --- |
| Two runners claim the same Subscription | `SKIP LOCKED` + lease: one wins; the other skips it |
| Targeted claim while the tick holds the lease | The targeted path skips (the tick's fetch will apply); the user sees the state as of that apply |
| Lease expires mid-fetch (slow provider), a second worker fetches too | Both apply through the guard; the later-sent observation wins regardless of arrival order |
| Webhook marks sync-due while a fetch is in flight | The webhook sets `syncRequestedAt` later than the in-flight fetch's `observationAt`; the apply therefore leaves `syncDueAt = now` instead of scheduling the next checkpoint, so the event is always observed by a fetch sent *after* it arrived |
| Command response and a webhook-triggered fetch race | Same guard; both are observations |
| User command while a sync is in flight | Independent: the command's own operation serialization; its response is one more observation |
