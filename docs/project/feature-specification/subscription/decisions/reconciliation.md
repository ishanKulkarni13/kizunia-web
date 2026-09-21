# Rulings — Reconciliation

> **Status:** Live
>
> **Last Updated:** 2026-09-21

---

## SB-RC-01 — A periodic job re-fetches authoritative state for locally-active paid subscriptions

**Status:** Accepted

**Decision:** A scheduled job periodically re-fetches each locally-active paid Subscription's
current state from Razorpay and corrects any local drift.

**Rationale:** No webhook system, including Razorpay's, can be assumed to deliver every event
(delivery is documented at-least-once *per attempted event*, but an event can still be missed
entirely if Razorpay's own retry window is exhausted, or if Kizunia's endpoint was unreachable
throughout it — see
[`../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../architecture/subscription/provider-boundary/razorpay-facts.md#webhooks)).
A periodic authoritative sweep is the safety net that makes correctness independent of any single
webhook actually arriving. [ENGINEERING] It reuses the existing `internal-jobs` tick/task-registry
convention already used for scheduled work in this codebase, rather than introducing new
infrastructure.

## SB-RC-02 — A webhook-processing failure after signature verification triggers on-demand reconciliation

**Status:** Accepted

**Decision:** If asynchronous processing of a verified, persisted webhook event fails (beyond its
bounded retry budget), Kizunia enqueues an out-of-cycle reconciliation fetch for the affected
subscription, rather than only waiting for the next periodic sweep.

**Rationale:** [ENGINEERING] Kizunia already knows, precisely, that something happened and wasn't
fully processed — this is strictly more information than "an event might have been missed," so it
is handled immediately rather than left to the periodic sweep's cadence.

## SB-RC-03 — Reconciliation corrections are applied transactionally and recorded in history

**Status:** Accepted

**Decision:** Any correction reconciliation makes to local Subscription state is applied inside a
database transaction and recorded as a `SubscriptionHistoryEntry` with source `reconciliation`,
exactly like a correction driven by a webhook.

**Rationale:** [PRODUCT] The history/audit requirement ("why does this user have this access")
applies equally regardless of what triggered a state change — see
[`../../../architecture/subscription/history-and-audit/subscription-history.md`](../../../architecture/subscription/history-and-audit/subscription-history.md).
A silent reconciliation correction with no audit trail would be indistinguishable from an
unexplained state change during a future investigation.
