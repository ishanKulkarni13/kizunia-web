# Synchronization

> **Status:** Implementation plan — not implemented
>
> **Last Updated:** 2026-09-24
>
> **Blueprint section:** §9 (see the [section map](README.md#blueprint-section-map))

The single synchronization mechanism: the sync-due marker, claiming, fetching, the one apply path and its stale-apply guard, concurrency between webhooks, commands and reconciliation, and failure handling.

---

One service, `SyncService`, with triggers as inputs.

- **`markDue(tx, subId, reason, at, eventDriven)`:** `syncDueAt = LEAST(COALESCE(syncDueAt, 'infinity'), at)`, `syncReason = reason`, and `syncRequestedAt = now` when event-driven. It is always written inside the transaction that records its cause.
- **Claim (batch):** raw SQL in the `postgres-work-queue.ts` style: a CTE selecting `WHERE "providerMode" = $mode::"ProviderMode" AND "syncDueAt" <= utc(now) AND ("syncLeaseUntil" IS NULL OR "syncLeaseUntil" < utc(now)) ORDER BY "syncDueAt", id LIMIT $n FOR UPDATE SKIP LOCKED`, then `UPDATE … SET "syncLeaseUntil" = …, "updatedAt" = …`, returning rows. Enum casts, the `utc()` binding and an explicit `updatedAt` follow the documented hazards. **Targeted claim:** the same with `id = $id`; a row leased elsewhere is skipped.
- **Fetch:** outside any transaction, through `BudgetedProvider` at the trigger's priority. No slot → release the lease, leave it due, stop the batch.
- **Apply (`apply.ts`), shared with command responses:**

```text
BEGIN
 SELECT * FROM subscription WHERE id=$1 FOR UPDATE
 if observationAt <= lastAppliedObservationAt: log stale_discarded; COMMIT; return        -- SB-RC-08
 if row.providerMode != resolved mode or notes.kz_env mismatch: anomaly PROVIDER_MODE_MISMATCH; no change
 validate status known, plan ID in catalog(mode), notes.kz_sub == row.id (when present)
   invalid -> lastSyncFailureClass MALFORMED/UNMAPPED_PLAN, anomaly (UNMAPPED_PROVIDER_PLAN), backoff; COMMIT
 if row terminal and new phase differs: anomaly + alert; do not apply; COMMIT
 newPhase := mapPhase(status, kind, startAt, now)
 write providerStatus/snapshot, plan/cycle (catalog), period fields, chargeAt, offerId
 scheduled change: hasScheduledChanges -> keep Kizunia's target if its operation set one, else flag only;
                   plan now == scheduledPlan -> clear (applied); flag false && plan != target -> clear (cancelled)
 cancelAtPeriodEnd: never cleared by absence; CANCELLED clears it naturally; [PAST_DUE cancellation](past-due-cancellation.md) detection may clear + anomaly
 firstContributedAt ||= now if newPhase contributes
 history entries for each access-relevant change (cause = KIZUNIA_COMMAND if this settles an op, else PROVIDER_OBSERVED)
 settle pending operations this observation proves or disproves
 lastAppliedObservationAt = observationAt; lastSyncedAt = now; syncAttempts = 0; syncLeaseUntil = null
 syncDueAt = terminal ? null : (syncRequestedAt > observationAt ? now : nextDue(phase, snapshot, now))
 if phase changed: count open subs for (userId, mode); > 1 -> upsert MULTIPLE_OPEN_SUBSCRIPTIONS
 if HALTED -> ACTIVE: flag advisory payment method for refresh
COMMIT
```

- **Failure:** `syncAttempts += 1`; `syncDueAt = now + min(cap, base·2^attempts)·U(0.5, 1.0)`; `lastSyncFailureClass`; release the lease. Local phase, plan and access are untouched. `SYNC_OVERDUE` alerts past a threshold. `NOT_FOUND` raises `PROVIDER_SUBSCRIPTION_MISSING`/mode mismatch; `AUTH_FAILURE` pins cooldown.
- **Stale protection, precisely:** the watermark is the **request send time** of the observation (fetch or command). It is compared under the row lock, and applied only if strictly newer. A slow response to an early request can never overwrite a later request's result, whatever order they arrive in. Webhook-vs-fetch-in-flight is closed by `syncRequestedAt`: a trigger recorded after a fetch was sent forces another fetch.
- **Concurrent webhook + command + reconciliation:** all three are observations through the same guard. Commands are additionally serialized per user; claims are exclusive (`SKIP LOCKED` + lease).
- **Plan changes, cancellations, lifecycle and Dashboard changes** all arrive as the same observation shape. Attribution is by whether the observation settles a Kizunia operation.

---

## Related documents

**In this directory**

- [Subscription State Model](state-model.md)
- [Webhook Architecture](webhooks.md)
- [Reconciliation](reconciliation.md)
- [Open decisions](open-decisions.md) · [Settled decisions](settled-decisions.md) · [Index](README.md)

**Design and specification**

- [Sync mechanism (design)](../reconciliation/sync-mechanism.md)
- [Ordering and staleness](../webhooks/ordering-and-staleness.md)
- [Outage and stale state](../provider-availability/outage-and-stale-state.md)
- [Rulings — reconciliation](../../../project/feature-specification/subscription/decisions/reconciliation.md)
