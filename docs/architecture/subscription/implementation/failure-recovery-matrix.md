# Failure and Recovery Matrix

> **Status:** Implementation plan — not implemented
>
> **Last Updated:** 2026-09-24
>
> **Blueprint section:** §18 (see the [section map](README.md#blueprint-section-map))

Every failure the design must survive, with how it is detected, what is persisted, how it is retried, what the user sees, and how it recovers.

**Open decisions referenced here:** [IB-1](open-decisions.md#ib-1--past_due-cancellation). Text that follows a recommended resolution is provisional until that item is ruled; see [open decisions](open-decisions.md).

---

| Failure | Detection | Persisted state | Retry | User sees | Recovery |
| --- | --- | --- | --- | --- | --- |
| Provider timeout (read) | Client timeout | Sync fields: attempts++, failure class | Jittered backoff; counts to cooldown | Nothing changes | Next due sync |
| Provider timeout (mutation) | Same | Op `OUTCOME_UNKNOWN`; sub marked due (create: stays `PROVISIONING`) | **Never re-sent** | "Confirming your last change" | Observation / orphan scan |
| Provider 4xx | `BAD_REQUEST_ERROR` | Op `REJECTED` + code; state unchanged; maybe marked due | No | Typed message ("not available for your subscription") | None; alert on unexpected codes |
| Provider 429 | HTTP 429 | Op `REJECTED(RATE_LIMITED)` / sync backoff; cooldown set | Cooldown + backoff | "Billing is busy" | Automatic; alert |
| Provider 5xx | 5xx / `SERVER_ERROR` | Read: backoff. Mutation: `OUTCOME_UNKNOWN` | Backoff; cooldown after K | Unchanged / confirming | Automatic |
| Unknown provider outcome (crash) | `IN_FLIGHT` past lease | → `OUTCOME_UNKNOWN` (tick or next command) | No | Confirming | Observation; alert past threshold |
| Duplicate command | `(userId, key)` exists | One op | — | Same result | — |
| Concurrent command | Partial-index `P2002` | Nothing new | — | 409 "already in progress" | Retry later |
| Duplicate webhook | `(provider, dedupeKey)` `P2002` | `duplicateCount++` | — | — | — |
| Out-of-order webhook | Always assumed | Only a sync mark | — | — | Refetch + guard |
| Stale sync response | `observationAt <= watermark` | Discarded (logged) | — | — | — |
| Missing webhook | Checkpoints / heartbeat | Stays due | — | Change seen at checkpoint latency | Due sync; runbook bulk re-sync |
| Dashboard mutation | Webhook or next sync | Applied, `PROVIDER_OBSERVED` | — | New state | Automatic |
| Abandoned checkout | `expireBy` checkpoint | `PENDING_AUTHENTICATION` → `EXPIRED` | — | Can resume until expiry | Automatic |
| Failed payment | `subscription.pending` / checkpoint | `PAST_DUE` (still contributes) | Razorpay retries | "Payment failing — update payment method" | Razorpay |
| PAST_DUE | as above | Contributing | — | Warning; plan change refused | Razorpay; cancel per IB-1 |
| HALTED | `subscription.halted` / checkpoint | `HALTED` (no access); decaying heartbeat | — | "On hold: fix payment or start new" | Recovery (observed) or supersession |
| PAUSED | `subscription.paused` | `PAUSED` (no access) | — | "Paused" | Resume at Razorpay / supersession |
| Cancellation not effective | I-4 checks | Anomaly; `cancelAtPeriodEnd` cleared | — | "You are still subscribed" notice | Human; refund in Dashboard |
| Duplicate open subscriptions | Open count > 1 on phase change | Anomaly; max access | — | Self-serve refused: contact support | Admin immediate cancel + resolve |
| Reconciliation failure | Task error / backlog age | Rows stay due | Next tick | None | Tick retries; manual route |
| DB transaction failure | Exception | Webhook: nothing (500, Razorpay retries). Command tx A: nothing sent. Tx B: op stays `IN_FLIGHT` → unknown → observed | As listed | Error or confirming | Lease + observation |
| Auth failure (401/403) | `AUTH_FAILURE` | Cooldown pinned to key fingerprint | None until keys change | "Billing unavailable" | Rotate keys, deploy; alert |
| Unmapped plan / mode mismatch | Apply validation / 404 | Last state kept; anomaly | Backoff | Unchanged | Catalog fix / data review |

---

## Related documents

**In this directory**

- [Billing Command Model](command-model.md)
- [Checkout and Subscription Creation](checkout-flow.md)
- [Webhook Architecture](webhooks.md)
- [Synchronization](synchronization.md)
- [Reconciliation](reconciliation.md)
- [Open decisions](open-decisions.md) · [Settled decisions](settled-decisions.md) · [Index](README.md)

**Design and specification**

- [Checkout failure matrix (design)](../commands/checkout-and-creation.md#failure-matrix)
- [Provider failure taxonomy](../reconciliation/provider-rate-limits.md#provider-failure-taxonomy)
- [Outage and stale state](../provider-availability/outage-and-stale-state.md)
- [Verification checklist](../verification-checklist.md)
