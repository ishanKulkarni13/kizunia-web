# Provider Rate Limits and Failures

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24

How Kizunia bounds its outbound Razorpay traffic, and how it behaves when a call fails. Rulings:
[SB-RC-06](../../../project/feature-specification/subscription/decisions/reconciliation.md#sb-rc-06--all-outbound-razorpay-calls-share-one-bounded-request-budget),
[SB-RC-07](../../../project/feature-specification/subscription/decisions/reconciliation.md#sb-rc-07--provider-failures-back-off-and-never-change-local-state).

**FACT.** Razorpay rate-limits its API and documents HTTP 429, recommending exponential backoff with
randomization, but publishes **no numbers and no `Retry-After` header**
([razorpay-facts](../provider-boundary/razorpay-facts.md#api-rate-limits-and-errors)). Every number
below is therefore configuration ([C1, C2](../../../project/feature-specification/subscription/open-decisions.md#c-implementation-time-configuration)),
to be confirmed with Razorpay Support before `live` ([A12](../../../project/feature-specification/subscription/open-decisions.md#a-razorpay-behavior-requiring-test-mode-verification-or-support)).

---

## Three different things called "limits"

| | Direction | Protects | Owned by |
| --- | --- | --- | --- |
| **Provider request budget** (this page) | Kizunia → Razorpay | Razorpay's limit on Kizunia's account | Billing module |
| **Rate limiting** | Clients → Kizunia | Kizunia from abusive clients | `lib/rate-limit` |
| **Plan quota** | Product rule | What a plan includes | Entitlements |

They never share configuration and never substitute for one another. See
[`../entitlements/quotas-vs-rate-limits.md`](../entitlements/quotas-vs-rate-limits.md).

## The budget

One global budget per provider mode, shared by every Kizunia instance, implemented on the existing
Postgres rate-limit store (`next/src/lib/rate-limit/postgres.store.ts`, fixed-window counters keyed
`{scope}:{identifier}:{windowStart}` with an atomic increment). Scope `razorpay-outbound`,
identifier the provider mode. Every outbound call — including webhook-triggered fetches — acquires
one unit first.

| Priority | Callers | May use |
| --- | --- | --- |
| 1 | User and admin commands, admin "sync now" | The whole window |
| 2 | Checkout confirmation, webhook-triggered syncs | Window minus headroom reserved for priority 1 |
| 3 | Due reconciliation (checkpoints, heartbeats, retries) | Window minus headroom for priorities 1–2 |
| 4 | Orphan discovery | A small fixed share, only when priority 3 has no due work |

Acquisition is a single atomic "increment if below this priority's ceiling" — never read-then-write.
A caller that cannot acquire:

- **background (priorities 2–4):** releases its lease, leaves the row due, and stops the batch;
- **user command (priority 1):** fails fast, `REJECTED(BUDGET_EXHAUSTED)`, "billing is temporarily
  busy, try again shortly"; nothing was sent, nothing changes.

**Why it cannot be per caller.** Razorpay's limit is *presumed* to be per account — an **inference**:
the documentation does not state the scope, only that increases are requested from Support
([A12](../../../project/feature-specification/subscription/open-decisions.md#a-razorpay-behavior-requiring-test-mode-verification-or-support)).
The design does not depend on the presumption being exactly right: bounding the sum of Kizunia's own
traffic is the safe reading under any scope. Reconciliation and a webhook storm
each staying under their own limit can still exceed Razorpay's together
(`docs/temp/suscriptions-issues.md`). One budget is the only thing that bounds the sum.

**Sizing for scale.** Due-based scheduling makes steady-state demand proportional to lifecycle
events, not to the number of subscriptions: with *N* paying subscriptions on monthly cycles, roughly
*N*/30 renewal checkpoints per day, plus heartbeats and one fetch per webhook burst. At 5,000 paying
customers that is on the order of a few hundred fetches a day — far below any plausible limit — so
the budget exists to cap *bursts* (an incident backlog, a Dashboard bulk action, a webhook storm),
not steady state.

## Global cooldown

A shared marker (a single row, or a well-known key in the same store) holding `cooldownUntil` and a
cooldown level.

| Trigger | Effect |
| --- | --- |
| Any 429 | `cooldownUntil = now + base * 2^level` (jittered, capped); `level += 1` |
| K consecutive 5xx/timeouts across callers within a short window | Same |
| First success after cooldown | `level` decays back toward 0 |

While cooling down, priorities 2–4 do not call Razorpay at all; priority 1 may still try (a user
explicitly asking to cancel should get a real answer if Razorpay has recovered). Without the global
cooldown, per-subscription backoff alone still sends one request per due subscription into an
outage every tick.

## Provider failure taxonomy

Every provider-boundary operation returns exactly one of these classes. Nothing outside the
boundary sees a raw SDK error.

| Class | Detected by | Retry | Local state | Alert |
| --- | --- | --- | --- | --- |
| `SUCCESS` | 2xx with a valid, fully mapped entity | — | Applied via the guarded apply path | — |
| `TIMEOUT` | Client timeout, connection reset | Per-subscription backoff; counts toward global cooldown | Unchanged. For a mutation: `OUTCOME_UNKNOWN` | Rate |
| `UNAVAILABLE` | 5xx, `SERVER_ERROR`, `GATEWAY_ERROR` | Same as `TIMEOUT` | Unchanged. For a mutation: `OUTCOME_UNKNOWN` | Rate |
| `RATE_LIMITED` | 429 | Global cooldown + per-subscription backoff | Unchanged. For a mutation: `REJECTED` (not processed) | Any occurrence |
| `CONCURRENT_OPERATION` | "another subscription operation is in progress" | Short backoff on that subscription | Unchanged; subscription marked sync-due | — |
| `REJECTED` | 4xx `BAD_REQUEST_ERROR` business refusal | Never automatically | Unchanged; for a command, a typed user-facing error | Unexpected codes only |
| `NOT_FOUND` | 404 (**observed:** only a malformed ID, as a gateway routing miss; a real unknown ID is a `400` that classifies as `REJECTED`, so this class does not by itself mean "the subscription is gone", see D12 in [razorpay-facts](../provider-boundary/razorpay-facts.md#documentation-vs-observed-behavior)) | Backoff | Unchanged. On a **sync fetch of a stored ID**, `NOT_FOUND` and `REJECTED` both raise `PROVIDER_SUBSCRIPTION_MISSING` ([IB-23](../implementation/open-decisions.md#ib-23--detecting-a-missing-provider-subscription)); `PROVIDER_MODE_MISMATCH` is detected locally, never from a failure | Always |
| `AUTH_FAILURE` | 401/403 | No — **all** provider calls stop (global cooldown pinned) until credentials are fixed and the process restarts | Unchanged | Page immediately |
| `MALFORMED` | Unparseable body, missing required fields, unknown status, `notes` contradicting the record | Backoff (may be transient) | Unchanged — never guess a state | Always |
| `UNMAPPED_PLAN` | Plan ID not in the per-mode catalog ([SB-PB-05](../../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-05--provider-plan-ids-map-to-kizunia-plans-through-a-per-mode-catalog-many-to-one)) | Backoff; applies once the catalog is fixed | Last known state kept | Always |
| `BUDGET_EXHAUSTED` | No slot acquired (never reached Razorpay) | Background: next run. Command: user retries | Unchanged | Sustained exhaustion |

The invariant across every row: **a failure to observe is never treated as an observation.** In
particular, no failure class, however long it persists, demotes a user or ends access
([`../provider-availability/outage-and-stale-state.md`](../provider-availability/outage-and-stale-state.md)).

## Backoff

Per Subscription: `delay = min(cap, base · 2^attempts)`, multiplied by a random factor in [0.5, 1.0]
(jitter, so a shared outage does not re-synchronize every retry). A Subscription is never marked
permanently failed; after the cap it is retried at the capped interval indefinitely and
`SYNC_OVERDUE` is raised past a threshold. Notification-work-queue precedent: an unrecognized error
is treated as retryable ([`../../notifications/jobs/README.md`](../../notifications/jobs/README.md#retry)).

## Webhook storms and bulk Dashboard actions

A Dashboard bulk operation or a Razorpay replay can deliver thousands of events in minutes. Each
event costs one insert and one idempotent "mark sync-due" — no provider call on the request path. The
`after()` attempt is capped per invocation and acquires budget like everything else; whatever it does
not reach is drained by the tick at the budget's pace, oldest first. Kizunia's webhook endpoint keeps
answering within Razorpay's 5-second window throughout, because none of the provider traffic happens
before the 2xx.
