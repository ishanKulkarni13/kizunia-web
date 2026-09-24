# Reconciliation

> **Status:** Implementation plan — not implemented
>
> **Last Updated:** 2026-09-24
>
> **Blueprint section:** §10 (see the [section map](README.md#blueprint-section-map))

Due-based reconciliation on the existing internal-jobs architecture: what becomes due, lifecycle checkpoints, retry and backoff, bounded batches, leasing, orphan discovery, the provider request budget, the global cooldown, and priorities. Scheduler code stays separate from subscription business logic.

**Decisions referenced here:** [IB-10](open-decisions.md#ib-10--tick-time-budget). All were ruled on 2026-09-24; see [open decisions](open-decisions.md) for each ruling and who made it (product decision (owner) or architecture decision (autonomous)).

---

Scheduler separation: domain services take `{ now, deadline, budgetPriority }` and know nothing about HTTP or cron. The tick route registers task objects. Dedicated manual routes `GET /api/v1/internal/billing/sync` and `…/orphan-discovery` (`CRON_SECRET`) follow the convention. Moving from a daily Vercel Cron to an external pinger or `*/5` Vercel Cron changes only deployment config (SB-PB-06).

| Task | `minIntervalSeconds` | Budget | Does |
| --- | --- | --- | --- |
| `billing:sync` | 60 (every tick) | ~10–12 s wall clock (IB-10); priority 3 (2 for `WEBHOOK`/`CHECKOUT_CONFIRM` rows) | Skip if cooldown; expire lapsed `IN_FLIGHT` → `OUTCOME_UNKNOWN`; loop claim → fetch → apply until the deadline, an empty claim, no budget, or cooldown; return counts |
| `billing:orphan-discovery` | ~900 | Priority 4, only if `billing:sync` left nothing due; `maxPagesPerRun` | Windowed `listSubscriptions` from the watermark (`created_at`, inclusive, overlap + settle delay); bind / `NOTES_CONFLICT` / `UNMATCHED`; advance the watermark only when a window completes; close windows → `ABANDONED` + `NOT_APPLIED` for `PROVISIONING` rows older than `requestSentAt + overlap` |
| `billing:payload-prune` | 86 400 | DB only | Null `rawPayload` older than 180 days (B3 default) in bounded batches |

**What becomes due** (`policy/next-due.ts`, pure): `nextDue = min(earliest upcoming checkpoint + margin, lastSyncedAt + heartbeat(phase, timeInPhase))`.

| Phase | Checkpoints | Heartbeat |
| --- | --- | --- |
| `PENDING_AUTHENTICATION` | `expireBy` (+ A8 lag margin) | hours |
| `TRIALING` | `startAt` | days |
| `ACTIVE` | `chargeAt`, `currentPeriodEnd`, `scheduledChangeAt`; **`currentPeriodEnd` when `cancelAtPeriodEnd`** | ~weekly |
| `PAST_DUE` | next retry day | daily |
| `HALTED` | — | decaying daily → weekly → monthly (SB-PF-05) |
| `PAUSED` | — | weekly |
| terminal / `PROVISIONING` | — | none / orphan scan |

**Budget:** key `razorpay-outbound:{mode}:{windowStart}` on `rate_limit`, via `incrementIfBelow` with a per-priority ceiling (`window − headroom(priority)`). P1 may use the whole window; P2–P4 progressively less (C1). **Cooldown:** a `BillingProviderState` row; any 429 or K consecutive 5xx/timeouts → `cooldownUntil = now + base·2^level·jitter`, `level++`; the first success decays it. P2–P4 skip entirely while cooling; P1 may still try. **Per-subscription backoff:** as in [synchronization](synchronization.md). **Priorities:** P1 user/admin commands and admin sync-now; P2 checkout confirm and webhook `after()`; P3 due reconciliation; P4 orphan discovery.

---

## Related documents

**In this directory**

- [Synchronization](synchronization.md)
- [Provider Boundary](provider-boundary.md)
- [Open decisions](open-decisions.md) · [Settled decisions](settled-decisions.md) · [Index](README.md)

**Design and specification**

- [Reconciliation scheduling (design)](../reconciliation/reconciliation-job.md)
- [Orphan discovery (design)](../reconciliation/orphan-discovery.md)
- [Provider rate limits (design)](../reconciliation/provider-rate-limits.md)
- [Internal / scheduled job convention](../../workflows/internal-jobs.md)
- [Notification jobs](../../notifications/jobs/README.md)
