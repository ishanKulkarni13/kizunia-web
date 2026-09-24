# Observability and Operations

> **Status:** Implementation plan — not implemented
>
> **Last Updated:** 2026-09-24
>
> **Blueprint section:** §17 (see the [section map](README.md#blueprint-section-map))

Structured logging, correlation identifiers, metrics, failure states, alerts and the operational hooks that the runbook relies on, with no secrets or payment data in logs.

**Open decisions referenced here:** [IB-11](open-decisions.md#ib-11--alerting-channel). Text that follows a recommended resolution is provisional until that item is ruled; see [open decisions](open-decisions.md).

---

- **Logging:** `modules/billing/observability/log.ts` → `console.log("[billing] " + JSON.stringify({event, ...fields}))`, guarded like `logNotificationEvent`. Every line carries whichever apply: `subscriptionId`, `userId`, `operationId`, `billingEventId`, `providerEventId`, `syncRunId`, `mode`, `trigger`, `priority`. `providerSubscriptionId` appears only in billing logs.
- **Event catalog:** `webhook.received|duplicate|unmatched|rejected_signature|rejected_account|latency`, `command.started|settled|rejected|outcome_unknown`, `sync.claimed|applied|no_change|stale_discarded|failed`, `budget.acquired|refused`, `cooldown.entered|left`, `orphan.window|bound|unmatched`, `anomaly.raised|resolved`, `grant.created|extended|revoked`, `alert.<CONDITION>` (`billing.alert` with a `severity` field).
- **Never logged:** raw payloads, signatures, secrets, keys, card or UPI data, `customer_email`/`customer_contact`.
- **Metrics:** no metrics infrastructure exists. Expose a `GET /api/v1/admin/billing/health` summary computed from tables (subscriptions by phase, due backlog + oldest due age, open anomalies by type, `OUTCOME_UNKNOWN` count + oldest age, last `billing:sync` result from `internal_job_run`, cooldown state, last webhook received per mode) and derive rates from logs.
- **Alerts:** the conditions in `observability.md` (`AUTH_FAILURE`, signature failures, `WEBHOOK_SILENCE`, 429/`BUDGET_EXHAUSTED`, `SYNC_OVERDUE`, `OUTCOME_UNKNOWN` age, the anomalies, disabled-in-production), each emitted as `billing.alert`. The delivery channel is IB-11.
- **Runbook hooks (admin tools):** sync now; bulk re-sync (optional filter `lastSyncedAt < t`); explain access; billing timeline (history + operations + events + facts); immediate cancel (reason); resolve anomaly (reason).

---

## Related documents

**In this directory**

- [Webhook Architecture](webhooks.md)
- [Synchronization](synchronization.md)
- [Reconciliation](reconciliation.md)
- [Open decisions](open-decisions.md) · [Settled decisions](settled-decisions.md) · [Index](README.md)

**Design and specification**

- [Observability (design)](../cross-cutting/observability.md)
- [Operations runbook](../cross-cutting/operations-runbook.md)
