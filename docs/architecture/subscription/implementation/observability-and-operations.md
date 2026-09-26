# Observability and Operations

> **Status:** Partly implemented. Phase IV (2026-09-25) emits the `webhook.*`, `sync.*`, `anomaly.*`, `command.settled|outcome_unknown` and `billing.alert` events below (conditions named in `observability/log.ts` `BillingAlertCondition`); Phase VIII (2026-09-26) adds the admin tools (explain, timeline, anomalies, bulk re-sync, the health summary) and `billing:payload-prune`; see the [operations runbook](../cross-cutting/operations-runbook.md#admin-tools)
>
> **Last Updated:** 2026-09-24
>
> **Blueprint section:** §17 (see the [section map](README.md#blueprint-section-map))

Structured logging, correlation identifiers, metrics, failure states, alerts and the operational hooks that the runbook relies on, with no secrets or payment data in logs.

**Decisions referenced here:** [IB-11](open-decisions.md#ib-11--alerting-channel). All were ruled on 2026-09-24; see [open decisions](open-decisions.md) for each ruling and who made it (product decision (owner) or architecture decision (autonomous)).

---

- **Logging:** `modules/billing/observability/log.ts` → `console.log("[billing] " + JSON.stringify({event, ...fields}))`, guarded like `logNotificationEvent`. Every line carries whichever apply: `subscriptionId`, `userId`, `operationId`, `billingEventId`, `providerEventId`, `syncRunId`, `mode`, `trigger`, `priority`. `providerSubscriptionId` appears only in billing logs.
- **Event catalog:** `webhook.received|duplicate|unmatched|rejected_signature|rejected_account|latency`, `command.started|settled|rejected|outcome_unknown`, `sync.claimed|applied|no_change|stale_discarded|failed`, `mode.resolved` (at boot: the resolved and expected mode, never a key), `budget.acquired|refused` (a refusal carries its `reason`: `CEILING`, `COOLDOWN`, `AUTH_PINNED` or `STORE_ERROR`), `cooldown.entered|left`, `health.record_failed|verdict_failed|record_conceded` (the state store misbehaving; never a lost result), `orphan.window|bound|unmatched`, `anomaly.raised|resolved` (`resolved` carries `by`: `observation`, or `admin` with the actor and reason), `grant.created|extended|revoked`, `sync.admin`, `resync.bulk_previewed|bulk_marked` (actor, mode, reason, filter, counts), `admin.payload_viewed` (actor and event id, never the content), `payload.pruned` (cutoff and counts), an `adminPath` field on every `billing.alert` (a link to the admin view), `alert.<CONDITION>` (`billing.alert` with a `severity` field).
- **Never logged:** raw payloads, signatures, secrets, keys, card or UPI data, `customer_email`/`customer_contact`.
- **Metrics:** no metrics infrastructure exists. `GET /api/v1/admin/billing/health` (Phase VIII) is a summary computed from tables (subscriptions by phase, due backlog + oldest due age, open anomalies by type, `OUTCOME_UNKNOWN` count + oldest age, last `billing:sync` result from `internal_job_run`, cooldown state, last webhook received per mode, the provider mode, plus the oldest due and `OUTCOME_UNKNOWN` rows, the orphan watermark and the last previous-secret match; [IB-28](open-decisions.md#ib-28--phase-viii-decisions-and-implementation-rulings) item 9) and rates are derived from logs.
- **Alerts:** the conditions in `observability.md` (`AUTH_FAILURE`, signature failures, `WEBHOOK_SILENCE`, 429/`BUDGET_EXHAUSTED`, `SYNC_OVERDUE`, `OUTCOME_UNKNOWN` age, the anomalies, disabled-in-production), and `TRIAL_CONVERSION_OVERDUE` (IB-9), each emitted as `billing.alert` from Phase IV onward. The delivery channel is **DEFERRED — a LIVE BLOCKER** chosen in [Phase IX](../implementation-plan/phase-IX/README.md) ([IB-11](open-decisions.md#ib-11--alerting-channel)).
- **Authorization of these tools (IB-15, product decision (owner)):** `VIEW_BILLING` (`ADMIN`, `SUPER_ADMIN`) covers the health summary, explain, timeline and "sync now"; `MANAGE_BILLING` (`SUPER_ADMIN`) covers immediate cancel, anomaly resolution and bulk re-sync; raw payloads are `SUPER_ADMIN` only.
- **Runbook hooks (admin tools):** all built; the [operations runbook](../cross-cutting/operations-runbook.md#admin-tools) maps each procedure to its tool and route.

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
