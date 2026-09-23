# Rulings — Reconciliation and Provider Synchronization

> **Status:** Live
>
> **Last Updated:** 2026-09-24

The mechanism is described in
[`../../../../architecture/subscription/reconciliation/`](../../../../architecture/subscription/reconciliation/README.md).
On 2026-09-24 this topic widened from "the periodic safety net" to every way Kizunia reads provider
state — webhook-triggered refetches, post-command confirmation, checkout confirmation, due-based
reconciliation and orphan discovery. All of them share one provider, one rate limit and one race;
designing them separately is what produced the unbounded sweep and the stale-apply race recorded in
`docs/temp/suscriptions-issues.md`.

---

## SB-RC-01 — A periodic job re-fetches authoritative state for locally-active paid subscriptions

**Status:** Amended — 2026-09-24, see the end of this ruling and [SB-RC-05](#sb-rc-05--reconciliation-is-due-based-not-a-sweep)

**Decision:** A scheduled job periodically re-fetches each locally-active paid Subscription's
current state from Razorpay and corrects any local drift.

**Rationale:** No webhook system, including Razorpay's, can be assumed to deliver every event
(delivery is documented at-least-once *per attempted event*, but an event can still be missed
entirely if Razorpay's own retry window is exhausted, or if Kizunia's endpoint was unreachable
throughout it — see
[`../../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#webhooks)).
A periodic authoritative sweep is the safety net that makes correctness independent of any single
webhook actually arriving. [ENGINEERING] It reuses the existing `internal-jobs` tick/task-registry
convention already used for scheduled work in this codebase, rather than introducing new
infrastructure.

**Amended (2026-09-24):** The safety-net purpose stands; three things change.

1. **Scope** is every *non-terminal* Subscription — including `PROVISIONING`,
   `PENDING_AUTHENTICATION`, `PAST_DUE`, `PAUSED` and `HALTED` — not only "locally-active paid" ones.
   An abandoned checkout, a lost create and a halted subscription are exactly the ones that drift.
2. **Selection** is due-based, not a periodic sweep over the whole set
   ([SB-RC-05](#sb-rc-05--reconciliation-is-due-based-not-a-sweep)).
3. **Every fetch is bounded** by the shared provider request budget
   ([SB-RC-06](#sb-rc-06--all-outbound-razorpay-calls-share-one-bounded-request-budget)). A
   reconciliation run never loops over an unbounded set, and never assumes it can fetch an arbitrary
   number of subscriptions in one run.

## SB-RC-02 — A webhook-processing failure after signature verification triggers on-demand reconciliation

**Status:** Superseded — 2026-09-24, by [SB-RC-04](#sb-rc-04--one-synchronization-mechanism-serves-webhooks-commands-and-reconciliation)

**Decision:** If asynchronous processing of a verified, persisted webhook event fails (beyond its
bounded retry budget), Kizunia enqueues an out-of-cycle reconciliation fetch for the affected
subscription, rather than only waiting for the periodic sweep.

**Rationale:** [ENGINEERING] Kizunia already knows, precisely, that something happened and wasn't
fully processed — this is strictly more information than "an event might have been missed," so it
is handled immediately rather than left to the periodic sweep's cadence.

**Superseded because:** there is no longer a separate webhook-processing job that can "fail beyond
its retry budget". A verified webhook marks its Subscription sync-due in the same transaction that
records it ([SB-WH-05](webhooks-and-reliability.md#sb-wh-05--acknowledgement-happens-before-asynchronous-processing-not-after));
a failed sync keeps the marker and is retried with backoff until it succeeds
([SB-RC-07](#sb-rc-07--provider-failures-back-off-and-never-change-local-state)). The intent of this
ruling — "Kizunia knows something happened, so act on it now, not at the next sweep" — is preserved
as a property of that mechanism rather than as a second, hand-off path.

## SB-RC-03 — Reconciliation corrections are applied transactionally and recorded in history

**Status:** Accepted

**Decision:** Any correction reconciliation makes to local Subscription state is applied inside a
database transaction and recorded as a `SubscriptionHistoryEntry` with source `reconciliation`,
exactly like a correction driven by a webhook.

**Rationale:** [PRODUCT] The history/audit requirement ("why does this user have this access")
applies equally regardless of what triggered a state change — see
[`../../../../architecture/subscription/history-and-audit/subscription-history.md`](../../../../architecture/subscription/history-and-audit/subscription-history.md).
A silent reconciliation correction with no audit trail would be indistinguishable from an
unexplained state change during a future investigation.

**Note (2026-09-24, no change to the ruling):** the history cause taxonomy is widened so the
*trigger* of a sync (webhook, checkout confirmation, command confirmation, due reconciliation,
orphan discovery, admin) is recorded precisely — see
[`subscription-history.md`](../../../../architecture/subscription/history-and-audit/subscription-history.md).

## SB-RC-04 — One synchronization mechanism serves webhooks, commands and reconciliation

**Status:** Accepted

**Decision:** Every read of provider subscription state goes through one mechanism. Each Subscription
carries a durable *sync-due* marker (`syncDueAt`) and sync bookkeeping (attempt count, lease, last
successful sync, last applied observation time, last error class). Anything that learns a
subscription may have changed — a verified webhook, a checkout confirmation, a command response, a
lifecycle checkpoint, an admin "sync now" — only sets `syncDueAt` (to now, or to a scheduled time)
and records the trigger. A single sync routine claims due Subscriptions (`FOR UPDATE SKIP LOCKED` with
a lease — the notification work queue's claim pattern), fetches them within the request budget, and
applies the result. It runs from the webhook request's `after()`, from checkout and command
endpoints, and from the tick.

**Rationale:** Webhook refetches and reconciliation fetches are the same operation against the same
rate-limited API on the same rows. Two mechanisms would race each other, double the provider calls
for one change, and need two sets of retry rules. One marker per Subscription also coalesces event
bursts naturally: ten webhooks for one subscription set the same marker and cost one fetch. It needs
no new queue — the Subscription row *is* the work item.

## SB-RC-05 — Reconciliation is due-based, not a sweep

**Status:** Accepted

**Decision:** After every successful sync, Kizunia computes when that Subscription next needs to be
observed, from the provider state it just read, and stores it as the next `syncDueAt`:

- a **lifecycle checkpoint** plus a margin — the next `charge_at`, `current_end`, a scheduled change's
  effective time, a trial's `start_at`, a checkout's `expire_by` — whichever comes first; and
- a **per-phase heartbeat** as the upper bound, so a Subscription with no upcoming checkpoint is still
  observed periodically (decaying for long-halted ones —
  [SB-PF-05](payment-failure-and-recovery.md#sb-pf-05--synchronization-of-a-halted-subscription-decays-it-never-stops)).

Terminal Subscriptions are never scheduled. Each tick processes at most a bounded batch of due
Subscriptions, oldest due first.

**Rationale:** State changes happen at predictable moments — renewals, cycle ends, trial ends — and
between them a subscription does not drift unless something Kizunia would be told about happens.
Observing at those moments detects a missed webhook within a small margin of when it mattered, at a
cost proportional to *lifecycle events*, not to the number of subscriptions times the sweep
frequency. [RAZORPAY FACT] No webhook is documented for a scheduled `cycle_end` change being applied
([razorpay-facts](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#webhooks)),
so checkpoint-based observation is also the *primary* way such a change is seen. Oldest-due-first
ordering is what keeps a backlog fair: no subscription is starved behind newer work.

## SB-RC-06 — All outbound Razorpay calls share one bounded request budget

**Status:** Accepted

**Decision:** Every outbound Razorpay API call — commands, syncs, orphan scans, admin actions —
first acquires a slot from one global, cross-instance request budget, implemented on the existing
Postgres-backed rate-limit store. Calls are classified into priorities, highest first:
(1) user- and admin-initiated commands, (2) checkout-confirmation and webhook-triggered syncs,
(3) due reconciliation, (4) orphan discovery. Lower priorities may use only the budget left after a
reserved headroom for higher ones. Background work that cannot acquire a slot stops for this run and
leaves its work due; a user command that cannot acquire one fails fast with "billing is temporarily
busy, try again shortly" and changes nothing. The numbers are configuration.

**Rationale:** [RAZORPAY FACT] Razorpay rate-limits its API and documents HTTP 429, but publishes no
numbers and no `Retry-After` header
([razorpay-facts](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#api-rate-limits-and-errors)).
A budget per *caller* would let reconciliation and a webhook storm each stay within their own limits
while together exceeding Razorpay's; the budget must be global because Razorpay's limit is. Priorities
exist so that a user trying to cancel is never blocked behind a background scan. Reusing the existing
`RateLimit` store means no new infrastructure. This is an *outbound* budget — unrelated to the
inbound rate limits users are subject to, and to plan quotas
([`quotas-vs-rate-limits.md`](../../../../architecture/subscription/entitlements/quotas-vs-rate-limits.md)).

## SB-RC-07 — Provider failures back off, and never change local state

**Status:** Accepted

**Decision:** A failed provider call never modifies the local Subscription's phase, plan or access.
Failures are classified (timeout, unavailable, rate-limited, concurrent-operation, rejected,
authentication failure, not-found, malformed) and handled per class
([provider failure taxonomy](../../../../architecture/subscription/reconciliation/provider-rate-limits.md#provider-failure-taxonomy)).
For retryable classes the Subscription's `syncDueAt` moves forward by exponential backoff with full
jitter, capped; a sync is never marked permanently failed — it keeps its capped retry cadence and
raises a `SYNC_OVERDUE` alert past a threshold. A 429, or a run of 5xx/timeouts, additionally sets a
global cooldown during which only priority-1 calls may be attempted. An authentication failure stops
all provider calls and pages operations.

**Rationale:** [RAZORPAY FACT] Razorpay recommends "exponential backoff… Add some randomisation…
to avoid the thundering herd effect"
([razorpay-facts](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#api-rate-limits-and-errors)).
The failure of an observation is not an observation: a user must never lose paid access because
Kizunia could not reach Razorpay ([`outage-and-stale-state.md`](../../../../architecture/subscription/provider-availability/outage-and-stale-state.md)).
A per-subscription backoff without a global cooldown still produces a retry storm when Razorpay is
down for everyone; a global cooldown without priorities blocks user commands behind background work.

## SB-RC-08 — A synchronization result is applied only if it is newer than the last one applied

**Status:** Accepted

**Decision:** Every provider read or command response carries its *observation time*: the moment the
request was sent. It is applied inside a transaction holding the Subscription's row lock, and only if
its observation time is later than the Subscription's `lastAppliedObservationAt`; otherwise it is
discarded (and logged as stale). The provider call itself is never made while holding a database
transaction or lock.

**Rationale:** Two reads of the same subscription sent at t1 < t2 can complete in either order.
Because Razorpay's answer to the t2 request reflects state at least as new as its answer to t1, the
request-send time orders observations correctly, whatever order the responses arrive in. Without this
guard the earlier claim that concurrent refetches are idempotent is false — the older result can
overwrite the newer one. Holding a transaction across an HTTP call would instead pin a database
connection for the duration of a provider timeout.

## SB-RC-09 — Provider subscriptions Kizunia lost track of are found by a bounded scan

**Status:** Accepted

**Decision:** A low-priority orphan-discovery task pages through Razorpay's Fetch All Subscriptions
over a bounded, watermarked creation-time window (with overlap), at most a configured number of
pages per run, and matches each item's `notes` against local Subscriptions of the current provider
mode. A match for a `PROVISIONING` record binds it; an item with no Kizunia match raises
`UNMATCHED_PROVIDER_SUBSCRIPTION`. It never cancels or adopts anything by itself.

**Rationale:** [RAZORPAY FACT] Create Subscription has no idempotency mechanism, and Fetch All
supports `from`/`to` windows, up to 100 items per page, and returns `notes`
([razorpay-facts](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#listing-subscriptions)).
This is the only way to detect a provider subscription whose creation response Kizunia never
received *and* whose webhooks never arrived — the double failure the per-subscription mechanisms
cannot see because there is no local row pointing at it. The window keeps the scan's cost bounded
regardless of total history size.

## SB-RC-10 — Synchronization only reads; it never changes provider state

**Status:** Accepted

**Decision:** Neither synchronization nor reconciliation nor orphan discovery ever calls a mutating
Razorpay API. Every provider mutation is a user- or admin-initiated command recorded as a
`BillingOperation` ([SB-CM-01](commands-and-idempotency.md#sb-cm-01--every-mutating-provider-call-is-a-recorded-billing-operation)).
Anomalies found by synchronization (multiple open subscriptions, unmatched subscriptions, unmapped
plans) are raised for a human, never auto-corrected at Razorpay.

**Rationale:** [PRODUCT] Razorpay is authoritative for billing facts
([`../../../../architecture/subscription/reconciliation/README.md`](../../../../architecture/subscription/reconciliation/README.md)).
An automatic job that cancels or modifies subscriptions turns a Kizunia bug or a stale read into a
real billing action against a customer, at scale, with no human in the loop. Keeping the background
path read-only bounds the blast radius of any defect in it to Kizunia's own records.
