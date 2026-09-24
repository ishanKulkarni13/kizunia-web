# Reconciliation Scheduling

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24 (decision close-out: IB-10)
> replaced by due-based scheduling)

*When* each Subscription is next observed. The mechanism that performs the observation is
[`sync-mechanism.md`](sync-mechanism.md). Rulings:
[SB-RC-01](../../../project/feature-specification/subscription/decisions/reconciliation.md#sb-rc-01--a-periodic-job-re-fetches-authoritative-state-for-locally-active-paid-subscriptions) (amended),
[SB-RC-05](../../../project/feature-specification/subscription/decisions/reconciliation.md#sb-rc-05--reconciliation-is-due-based-not-a-sweep).

---

## What changed, and why

The earlier design was a periodic job that looped over every locally-active paid subscription and
fetched each one. At scale that is an unbounded loop against a rate-limited API; it skipped
unreachable subscriptions and moved straight on to the next (hammering Razorpay during an outage);
and it excluded exactly the subscriptions most likely to drift — abandoned checkouts, lost creates,
halted ones. See `docs/temp/suscriptions-issues.md`.

Now there is no sweep. Every non-terminal Subscription always has a `syncDueAt`, computed from what
Razorpay last said about it. The `billing-sync` tick task drains whatever is due, oldest first, within
the provider request budget.

## `nextDue` — computed after every successful sync

```text
nextDue = min(
  earliest upcoming checkpoint for this phase + checkpointMargin,
  lastSyncedAt + heartbeat(phase, timeInPhase)
)
```

| Phase | Checkpoints | Heartbeat (upper bound) |
| --- | --- | --- |
| `PROVISIONING` | — (resolved by [orphan discovery](orphan-discovery.md)) | — |
| `PENDING_AUTHENTICATION` | `expire_by` | Short (hours): an unfinished checkout either completes or expires quickly |
| `TRIALING` | `start_at` (trial end → first charge) | Days |
| `ACTIVE` | `charge_at` (renewal), `current_end`, scheduled change's effective time | ~Weekly |
| `PAST_DUE` | Next retry day (retries are daily for cards/UPI) | Daily |
| `HALTED` | — | Decaying: daily → weekly → monthly ([SB-PF-05](../../../project/feature-specification/subscription/decisions/payment-failure-and-recovery.md#sb-pf-05--synchronization-of-a-halted-subscription-decays-it-never-stops)) |
| `PAUSED` | — | Weekly |
| Terminal | — | Never (`syncDueAt = null`) |

Exact intervals and margins are configuration ([C3](../../../project/feature-specification/subscription/open-decisions.md#c-implementation-time-configuration)).
The margin exists because Razorpay's renewal and its webhook take time to happen; observing a few
hours after a checkpoint finds the settled state instead of racing it.

## What each checkpoint detects

| Checkpoint missed webhook | Detected at | Worst-case staleness (target cadence) |
| --- | --- | --- |
| Renewal failed (`pending`) | `charge_at` + margin | margin + ≤ 15 min |
| Cycle-end cancellation took effect | `current_end` + margin | same |
| Scheduled downgrade applied (no webhook documented) | Effective time + margin | same |
| Trial converted / first charge failed | `start_at` + margin | same |
| `halted` → `active` recovery | Next heartbeat | Up to the decayed heartbeat (the `subscription.activated` webhook is the primary path) |
| Dashboard/UPI-app change mid-cycle | Next heartbeat | Up to ~1 week |

Under a daily-only tick every "≤ 15 min" becomes "≤ 24 h" ([SB-PB-06](../../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-06--billing-execution-is-scheduler-agnostic)).

**Which way staleness errs.** Between a real change and its observation, the local state is the
*previous* state. For a missed cancellation or halt, the user keeps access slightly longer than paid
for; for a missed recovery, access is restored slightly late. Kizunia accepts the first and minimizes
the second with webhooks as the primary path — it never shortens access speculatively
([`../provider-availability/outage-and-stale-state.md`](../provider-availability/outage-and-stale-state.md)).

## The `billing-sync` tick task

Registered in the internal task registry; minimum interval ≤ the target cadence.

**Ordering and budget (decided 2026-09-24,
[IB-10](../implementation/open-decisions.md#ib-10--tick-time-budget)):**

- The tick route has `maxDuration = 60` and runs its tasks sequentially, and `notifications:tick`
  drained for up to 45 s. `billing:sync` is therefore registered **before** `notifications:tick` with
  its own wall-clock budget, of the order of 10–12 s.
- The notification drain default is lowered so that the tasks plus teardown headroom fit within 60 s.
- Orphan discovery and payload pruning are separate, lower-frequency tasks.
- Exact values are implementation-time and documented in
  [`../../workflows/internal-jobs.md`](../../workflows/internal-jobs.md#the-tick-one-cron-entry-many-tasks).
- Cadence: the only Vercel cron entry is daily on the Hobby plan. The 5-minute target needs an
  external pinger before LIVE ([IB-19](../implementation/open-decisions.md#ib-19--tick-cadence-on-the-vercel-hobby-plan)).

```text
run(deadline):
  if global cooldown active: return { skipped: "cooldown" }
  resolve expired IN_FLIGHT operations -> OUTCOME_UNKNOWN          (cheap, local)
  loop until deadline or empty claim:
    claim a batch of due Subscriptions (sync-mechanism.md#claiming)
    for each: acquire budget (priority 2 or 3) -> fetch -> apply | backoff
    stop early if budget unavailable or cooldown begins
  return counts: claimed, applied, stale-discarded, failed by class, remaining due
```

The drain stops on an empty claim, not a short one, and stops cleanly before the platform's time
limit, leaving the remainder due — the same two rules the notification drain follows
([`../../notifications/jobs/README.md`](../../notifications/jobs/README.md#the-budget)). Orphan
discovery is a separate, lower-priority task ([`orphan-discovery.md`](orphan-discovery.md)).

## Multiple workers

Two ticks (Vercel Cron and an external scheduler, or an overlap) may run concurrently. The registry's
last-run marker and the claim's `SKIP LOCKED` + lease make that safe: each Subscription is claimed by
at most one of them, and any leftover race is resolved by the stale-apply guard. The task has no
state of its own beyond the rows it claims.

## Scale

Steady-state work is proportional to lifecycle events, not to total subscriptions — see
[`provider-rate-limits.md`](provider-rate-limits.md#the-budget). A backlog (after an outage, or a
deployment that paused the tick) drains oldest-first at the budget's rate; because every row's due
time is kept, nothing is skipped and no subscription is starved by newer ones.
