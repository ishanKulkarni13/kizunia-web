# Reconciliation and Provider Synchronization

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24

Every way Kizunia reads Razorpay subscription state: webhook-triggered refetches, checkout and
command confirmation, due-based reconciliation, and orphan discovery. They are one mechanism with
several triggers, sharing one request budget and one stale-apply guard — see
[SB-RC-04](../../../project/feature-specification/subscription/decisions/reconciliation.md#sb-rc-04--one-synchronization-mechanism-serves-webhooks-commands-and-reconciliation).

| Document | Contents |
| --- | --- |
| [`sync-mechanism.md`](sync-mechanism.md) | The sync-due marker, claiming, fetching, the single apply path and its stale-apply guard, concurrency |
| [`reconciliation-job.md`](reconciliation-job.md) | Due-based scheduling: when each Subscription is next observed, and the `billing-sync` tick task |
| [`provider-rate-limits.md`](provider-rate-limits.md) | The global outbound request budget, priorities, global cooldown, the provider failure taxonomy |
| [`orphan-discovery.md`](orphan-discovery.md) | Finding provider subscriptions Kizunia has no record pointing at |

## What is authoritative

Razorpay is always authoritative for billing facts. Synchronization never "corrects" Razorpay based
on Kizunia's local state — it only ever pulls Razorpay's state into Kizunia and corrects local drift
to match it. Nothing in this section calls a mutating Razorpay API
([SB-RC-10](../../../project/feature-specification/subscription/decisions/reconciliation.md#sb-rc-10--synchronization-only-reads-it-never-changes-provider-state)).

## The guarantees, stated once

| Guarantee | Mechanism |
| --- | --- |
| Every non-terminal Subscription is observed again within its heartbeat | Due-based scheduling |
| A missed webhook is noticed shortly after the lifecycle moment it concerned | Checkpoints |
| An event burst costs one fetch per Subscription | Coalescing sync-due marker |
| An older observation never overwrites a newer one | Stale-apply guard |
| Outbound traffic never exceeds a configured bound, whatever triggers it | Global budget |
| A provider outage produces no retry storm and no access loss | Global cooldown + backoff; failures never change local state |
| Two workers never fetch-and-apply the same Subscription inconsistently | `SKIP LOCKED` + lease + guard |
| A provider subscription Kizunia never recorded is eventually found | Orphan discovery |
| Correctness does not depend on the scheduler's cadence | Durable markers; cadence only bounds latency |
