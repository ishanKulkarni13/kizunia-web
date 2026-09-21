# Reconciliation Job

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-21

---

## Periodic sweep

Registered as a task in the existing `internal-jobs` tick/task-registry
(`next/src/lib/internal-jobs/registry.ts`), following the exact convention documented in
[`../../workflows/internal-jobs.md`](../../workflows/internal-jobs.md) — a `GET` route behind
`CRON_SECRET`, guarded by its own minimum-interval marker so it runs on a multi-day cadence
independent of how often the shared tick fires. See
[SB-RC-01](../../../project/feature-specification/subscription/decisions/reconciliation.md#sb-rc-01--a-periodic-job-re-fetches-authoritative-state-for-locally-active-paid-subscriptions).

```text
for each Subscription where phase in {ACTIVE, TRIALING, HALTED, PAUSED}
                        and lastReconciledAt older than the configured horizon:
  fetchSubscription(providerRef)
  if authoritative state disagrees with local phase:
    apply the correction transactionally, same code path a webhook's processing would use
    record SubscriptionHistoryEntry with cause = reconciliation
  set lastReconciledAt = now
```

This deliberately reuses [`../lifecycle/state-mapping.md`](../lifecycle/state-mapping.md) and the
same transactional-update-plus-history-entry shape from
[`../webhooks/reliability-and-idempotency.md`](../webhooks/reliability-and-idempotency.md) — a
reconciliation correction is not a special kind of state change, only a differently-triggered one.

## On-demand trigger

A `BillingEvent` that exhausts its processing retry budget ([SB-RC-02](../../../project/feature-specification/subscription/decisions/reconciliation.md#sb-rc-02--a-webhook-processing-failure-after-signature-verification-triggers-on-demand-reconciliation)) enqueues an immediate
reconciliation for the subscription it concerns, rather than waiting for the periodic sweep's
cadence — Kizunia already knows something was reported and not fully processed, which is stronger
information than "a webhook might have been missed."

## Scope: only currently-relevant subscriptions

Terminal-phase subscriptions (`CANCELLED`, `EXPIRED`, `COMPLETED`) are not reconciled — their state
cannot change further on Razorpay's side. This keeps the sweep's cost proportional to the number of
subscriptions that can actually still drift, not to the full historical count.

## Concurrency

A subscription being reconciled at the same moment its own webhook is being processed is handled the
same way [`../webhooks/ordering-and-staleness.md`](../webhooks/ordering-and-staleness.md) handles two
concurrent webhook-triggered refetches: both read the same authoritative source and converge on the
same result, and the transactional update is idempotent (a "set current phase" write, not a delta).

## If Razorpay is unreachable during a reconciliation pass

The fetch for that subscription fails; `lastReconciledAt` is left unchanged so the next pass retries
it; no local state is modified. The sweep continues with the remaining subscriptions rather than
aborting entirely — one unreachable dependency during one pass does not stop reconciliation for
every other subscription, mirroring the existing tick registry's own "a failing task does not abort
the tick" behavior.
