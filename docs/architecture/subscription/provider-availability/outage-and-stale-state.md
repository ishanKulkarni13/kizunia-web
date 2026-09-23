# Outage and Stale State

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24

A Razorpay outage — full or partial, in `live` or `test` mode — must never revoke access. This is
different from [`disabled-provider-mode.md`](disabled-provider-mode.md): the provider is configured
and normally reachable, just not responding correctly right now.

---

## The invariant

> **A failure to observe Razorpay is never treated as an observation.**

Effective-access resolution reads only Kizunia's own tables
([`../entitlements/effective-access-resolution.md`](../entitlements/effective-access-resolution.md)),
and local phases change only when an authoritative observation is *successfully applied*
([SB-RC-07](../../../project/feature-specification/subscription/decisions/reconciliation.md#sb-rc-07--provider-failures-back-off-and-never-change-local-state)).
No timer, heartbeat or overdue sync ever demotes a user "just in case".

## Behavior by failure kind

| Failure | Webhooks | Syncs | User commands | Access |
| --- | --- | --- | --- | --- |
| Razorpay API fully down (timeouts/5xx) | Still received, recorded, acknowledged (no provider call before the 2xx) | Back off; global cooldown stops background calls | Fail fast: "billing temporarily unavailable"; mutations already sent become `OUTCOME_UNKNOWN` | Unchanged |
| Partial failure (some calls fail) | Same | Failing Subscriptions back off individually; others proceed | Individual calls fail as above | Unchanged |
| Rate limited (429) | Same | Global cooldown; priority 1 only | Fail fast if no budget | Unchanged |
| Malformed responses | Same | Not applied; `MALFORMED` anomaly; backoff | Command `OUTCOME_UNKNOWN` | Unchanged |
| Authentication failure (401/403: revoked or wrong key) | Same | **All** provider calls stop; page immediately | Refused | Unchanged |
| Razorpay cannot deliver webhooks to Kizunia | — (Razorpay retries 24 h, then disables the webhook) | Due-based syncs still observe changes at checkpoints/heartbeats | Unaffected | Correct at checkpoint latency |
| Kizunia database down | Webhook returns 5xx; Razorpay retries for 24 h | Nothing runs | Unavailable | Resolution unavailable with the rest of the app — no billing-specific failure |

The full classification is the [provider failure taxonomy](../reconciliation/provider-rate-limits.md#provider-failure-taxonomy).

## How long stale state is trusted

Indefinitely, until a webhook-triggered or scheduled sync succeeds. Demoting a paying user because
Razorpay was unreachable would turn a provider availability problem into a Kizunia-caused access loss.

The other direction — a user keeping access they no longer pay for because a cancellation or halt has
not been observed yet — is bounded by due-based scheduling (observation shortly after each lifecycle
checkpoint) and made visible by `SYNC_OVERDUE` alerts. Kizunia accepts that bounded exposure rather
than risk the unbounded one.

## Recovery

Once Razorpay recovers, the global cooldown decays, due Subscriptions drain oldest first within the
request budget, `OUTCOME_UNKNOWN` operations resolve by observation, and orphan discovery covers any
create whose response was lost. No manual step is needed for the common case; the runbook covers the
rest ([`../cross-cutting/operations-runbook.md`](../cross-cutting/operations-runbook.md#razorpay-outage)).
