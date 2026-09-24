# Observability

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24 (decision close-out: IB-11, IB-9 alert)

Billing is financially sensitive. Every question support or an engineer will ask about a user's
billing must be answerable from durable records, not from reproducing the bug.

---

## The questions, and where each answer lives

| Question | Answered by |
| --- | --- |
| Why does this user currently have PRO? | Effective-access explanation (below): each contributing Subscription (phase, plan, since when, per its latest `SubscriptionHistoryEntry`) and each active grant (who, why, until) |
| Why did they lose access? | The `SubscriptionHistoryEntry` that ended the last contributing source (e.g. `ACTIVE → HALTED`, cause `provider_observed`, trigger `webhook`, event ID), or the grant's revocation/`validUntil` |
| What happened to their Razorpay subscription? | The Subscription's history entries in order, plus `providerStatus`/`providerSnapshot` for what Razorpay last said |
| Did Kizunia receive the webhook? | `BillingEvent` rows for that provider subscription ID (receipt time, type, duplicate count, matched secret) |
| Was it processed? | Derived: applied if `subscription.lastAppliedObservationAt > event.receivedAt` ([`../webhooks/reliability-and-idempotency.md`](../webhooks/reliability-and-idempotency.md#was-this-event-processed)); otherwise the Subscription is still sync-due — see its sync fields |
| Was an authoritative refetch performed? Did it fail? | Sync fields: `lastSyncedAt`, `syncAttempts`, `lastSyncFailureClass`, `syncDueAt`; structured sync log lines |
| Was reconciliation attempted? | History entries with trigger `checkpoint`/`heartbeat`; sync log lines per `billing-sync` run; the run summary in the internal task marker |
| Was the provider rate limit hit? | `RATE_LIMITED` counts per run, the global cooldown marker and its history in logs/metrics, `BUDGET_EXHAUSTED` operations |
| Did subscription creation partially fail? | `BillingOperation` with kind `CREATE_SUBSCRIPTION` in `OUTCOME_UNKNOWN`; `PROVISIONING` Subscriptions without a provider ID |
| Are there orphaned provider subscriptions? | `UNMATCHED_PROVIDER_SUBSCRIPTION` anomalies; `ABANDONED` Subscriptions; orphan-discovery watermark and run results |
| Are there multiple non-terminal subscriptions? | `MULTIPLE_OPEN_SUBSCRIPTIONS` anomalies (evaluated on every phase change) |
| Did we cause this change, or did it happen at Razorpay? | History `cause` (`kizunia_command` with operation and actor, vs `provider_observed`) |

## Effective-access explanation

The resolver has a sibling, `explainEffectiveAccess(userId, at?)`, available only to billing-admin
tooling: it returns every entitlement source considered, whether each contributed, why not (phase,
mode mismatch, grant expired/revoked), and the resulting tier. It uses the same predicate as the
resolver, so the explanation cannot disagree with the decision. With `at`, it answers the question
historically from history entries and grant audit.

## Correlation

Every log line in the billing paths carries the relevant identifiers: Kizunia Subscription ID, user
ID, `BillingOperation` ID, `BillingEvent` ID and Razorpay event ID, sync run ID. Razorpay subscription
IDs appear only in billing-module logs. From any one ID, an engineer can reach the others.

## What is logged at each stage

| Stage | Logged |
| --- | --- |
| Webhook receive | Event ID, type, bytes, latency to 2xx (watched against Razorpay's 5 s) |
| Verify | Success/failure and which secret matched — never the signature or secret |
| Record | New vs duplicate; matched vs unmatched Subscription |
| Command | Operation ID, kind, actor, budget wait, provider latency, classified outcome |
| Sync | Subscription ID, trigger, priority, outcome class, phase/plan change or "no change", stale observations discarded |
| Budget | Acquisitions and refusals per priority; cooldown entered/left and level |
| Orphan discovery | Window, pages scanned, bound, unmatched, watermark |

## What must never be logged

Raw webhook payloads (they may contain customer contact details), payment-instrument data, webhook
secrets, API keys, checkout signatures. Logs carry identifiers; the raw payload is looked up in
`BillingEvent` behind billing-admin access, while it is retained.

## Metrics

Webhooks received/duplicate/unmatched/rejected per type; webhook 2xx latency; sync attempts by
trigger and outcome class; due backlog size and age of the oldest due Subscription; budget
utilization per priority; cooldown time; operations by kind and outcome, and `OUTCOME_UNKNOWN` age;
open anomalies by type; Subscriptions by phase.

## Alerting

| Condition | Why it matters | Severity |
| --- | --- | --- |
| `AUTH_FAILURE` from Razorpay | All billing stops | Page |
| Signature-verification failures above baseline | Probing, or a secret rotation gone wrong | High |
| No webhook received for longer than expected given active subscriptions (`WEBHOOK_SILENCE`), or webhook 5xx/latency near 5 s | Razorpay disables the webhook after 24 h of failures | High |
| Any 429, or sustained `BUDGET_EXHAUSTED` | Budget misconfigured or Razorpay limits lower than assumed | High |
| Oldest due Subscription older than threshold, or `SYNC_OVERDUE` | Local state may be stale for paying users | High |
| `OUTCOME_UNKNOWN` operation older than threshold | A user may have been charged without a record, or is blocked from billing actions | High |
| `MULTIPLE_OPEN_SUBSCRIPTIONS`, `UNMATCHED_PROVIDER_SUBSCRIPTION`, `NOTES_CONFLICT` | Possible double billing or billing a person Kizunia does not know | High |
| `UNMAPPED_PROVIDER_PLAN`, `PROVIDER_MODE_MISMATCH`, `MALFORMED` | Configuration error, or an unexpected Razorpay change | High |
| `CANCELLATION_NOT_EFFECTIVE` | A user who cancelled is still being billed | High |
| Drift found by checkpoint/heartbeat syncs above baseline | Systemic webhook delivery problem | Medium |
| A subscription `HALTED` past an observation window | Support outreach candidate (not an automatic action) | Low |
| Provider mode `disabled` in production | Expected before live credentials exist; must be a deliberate state | Low (Medium once `live` has been used) |
| `TRIAL_CONVERSION_OVERDUE` ([IB-9](../implementation/open-decisions.md#ib-9--trial-conversion-gap)) | A trial passed `start_at` + grace with no first charge observed | Medium |

**Delivery channel: DEFERRED, a LIVE BLOCKER** ([IB-11](../implementation/open-decisions.md#ib-11--alerting-channel)).
The repository has structured `console` logs only: no metrics, no pager. From implementation-plan
Phase IV onward, every condition above emits one structured `billing.alert` log event (the
`[billing] {json}` sibling of the notifications log), carrying the condition, the severity and
correlation IDs, never secrets or payloads. The channel that turns those events into a notification
(Vercel log-drain alert, e-mail, or an in-app admin notice) is chosen in
[Phase IX](../implementation-plan/phase-IX/README.md) and must exist before LIVE billing is enabled.
Until then "Page" and "High" describe urgency, not a delivery mechanism.
