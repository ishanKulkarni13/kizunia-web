# Rulings — Webhook Reliability

> **Status:** Live
>
> **Last Updated:** 2026-09-24

The full mechanism is described in
[`../../../../architecture/subscription/webhooks/README.md`](../../../../architecture/subscription/webhooks/README.md); these rulings
record the decisions behind it.

---

## SB-WH-01 — Signature is verified against the raw body before anything else happens

**Status:** Accepted

**Decision:** The webhook handler verifies `X-Razorpay-Signature` (HMAC-SHA256 over the raw request
body, using the webhook secret) before parsing the body as JSON, before any database write, and
before any business logic runs.

**Rationale:** [RAZORPAY FACT] Signature verification requires the unparsed raw body — pre-parsing
breaks the check, a documented common integration bug (see
[`../../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#webhooks)).
Verifying first, unconditionally, means no unverified payload is ever capable of reaching any code
path that trusts it.

## SB-WH-02 — Every received event is persisted with a unique-constraint dedupe key before acknowledgement

**Status:** Accepted

**Decision:** Once verified, an event is written to a `(provider, eventId)`-unique-constrained
table before Kizunia acknowledges the webhook. A constraint violation (the event was already seen)
is treated as success, not an error.

**Rationale:** [RAZORPAY FACT] Razorpay's delivery is documented at-least-once, with `x-razorpay-event-id`
provided specifically as a dedupe key (see
[`../../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#webhooks)).
[ENGINEERING] The notification subsystem already treats a Prisma `P2002` unique-constraint violation
as "already done, not an error" rather than a read-then-write existence check — reusing that exact
convention here (instead of inventing a new idempotency mechanism) keeps the dedupe atomic under
concurrent delivery of the same event.

**Note (2026-09-24, no change to the ruling):** [RAZORPAY FACT] The header is documented as "unique
per event"; its presence on every delivery and stability across retries are implied, not stated
([open item A6](../open-decisions.md#a-razorpay-behavior-requiring-test-mode-verification-or-support)).
A verified delivery without the header is deduplicated on the SHA-256 of its raw body instead —
redelivery of the same event carries the same bytes, and because processing never trusts the payload
([SB-WH-03](#sb-wh-03--state-changing-events-trigger-an-authoritative-refetch)), a duplicate that
slips through costs one coalesced sync, not a wrong state.

## SB-WH-03 — State-changing events trigger an authoritative refetch

**Status:** Amended — 2026-09-24, see the end of this ruling

**Decision:** For events that represent a subscription state transition (`subscription.*`), Kizunia
does not apply the webhook payload's embedded status as the new state directly. It fetches the
current Subscription entity from Razorpay's API and derives the new Kizunia state from that
authoritative read.

**Rationale:** [RAZORPAY FACT] Razorpay explicitly documents that webhooks are **not** guaranteed to
arrive in order (see
[`../../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#webhooks)).
Applying an out-of-order payload directly (for example, an older `subscription.pending` arriving
after a newer `subscription.halted` was already processed) would regress state. Refetching the
current authoritative status instead of trusting a possibly-stale payload makes the outcome
independent of delivery order.

**Amended (2026-09-24):** Refetching alone does not make the outcome order-independent: two fetches
of the same subscription can complete in the opposite order to the one they were sent in, and the
older result can overwrite the newer one. The refetch is therefore performed by the single
synchronization mechanism ([SB-RC-04](reconciliation.md#sb-rc-04--one-synchronization-mechanism-serves-webhooks-commands-and-reconciliation)),
which (a) coalesces every event for a subscription into one pending fetch, so a burst of events
costs one provider call, and (b) applies a result only if it is newer than the last one applied
([SB-RC-08](reconciliation.md#sb-rc-08--a-synchronization-result-is-applied-only-if-it-is-newer-than-the-last-one-applied)).
The earlier claim that concurrent refetches "converge because they read the same source" was wrong
and has been removed from the architecture documents.

## SB-WH-04 — Charges are recorded as append-only facts, separate from current state

**Status:** Accepted

**Decision:** A charge event (`subscription.charged`, `payment.*`) is recorded as an immutable,
append-only ledger entry keyed by its own payment/invoice identifier. It never itself overwrites
"current subscription state" — only an authoritative subscription refetch does that
([SB-WH-03](#sb-wh-03--state-changing-events-trigger-an-authoritative-refetch)).

**Rationale:** [ENGINEERING] Separates "a discrete billing fact occurred" (which is naturally
append-only and safe to record multiple times under retry) from "what phase is this subscription in
right now" (which must always reflect the single latest authoritative read, not an accumulation of
possibly-reordered deltas). Mirrors the notification subsystem's own append-only, never-overwritten
occurrence model.

## SB-WH-05 — Acknowledgement happens before asynchronous processing, not after

**Status:** Amended — 2026-09-24, see the end of this ruling

**Decision:** Kizunia responds `2xx` to Razorpay as soon as the event is durably persisted
([SB-WH-02](#sb-wh-02--every-received-event-is-persisted-with-a-unique-constraint-dedupe-key-before-acknowledgement)). The actual state-transition
processing ([SB-WH-03](#sb-wh-03--state-changing-events-trigger-an-authoritative-refetch)) happens afterwards, asynchronously, through
Kizunia's existing Postgres-backed work queue.

**Rationale:** [RAZORPAY FACT] Razorpay treats a response slower than five seconds as a delivery
failure and retries (see
[`../../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#webhooks)).
[ENGINEERING] Separating "durably received" from "fully processed" means slow downstream work (an
authoritative Razorpay refetch, a database transaction) never risks tripping that timeout and
triggering needless redelivery — and reuses the exact generation/delivery split already proven by
the notification subsystem's work queue rather than inventing new queue infrastructure.

**Amended (2026-09-24):** The acknowledge-before-processing principle stands; the *mechanism* after
acknowledgement changes, because the original one waited for "the next queue drain" and the only
scheduled trigger in the repository fires **once a day** (`next/vercel.json`, `0 13 * * *`) — a
paying user could wait up to 24 hours for access. Now:

1. **In the same transaction as the dedupe insert,** Kizunia records any charge fact the event
   carries ([SB-WH-04](#sb-wh-04--charges-are-recorded-as-append-only-facts-separate-from-current-state))
   and marks the affected Subscription *sync-due*. No separate webhook-processing job exists; the
   durable sync-due marker *is* the pending work.
2. **After responding,** the same request makes a best-effort attempt to perform that sync
   immediately (Next.js `after()`), within the provider request budget.
3. **If that attempt does not happen or fails,** the sync-due marker is drained by the next tick,
   whatever invokes it ([SB-PB-06](provider-boundary-and-environments.md#sb-pb-06--billing-execution-is-scheduler-agnostic)).

Correctness depends only on step 1 being durable; steps 2 and 3 only affect latency. See
[SB-RC-04](reconciliation.md#sb-rc-04--one-synchronization-mechanism-serves-webhooks-commands-and-reconciliation)
and [`../../../../architecture/subscription/webhooks/reliability-and-idempotency.md`](../../../../architecture/subscription/webhooks/reliability-and-idempotency.md).

## SB-WH-06 — Events for unknown subscriptions are persisted and matched, never dropped

**Status:** Accepted

**Decision:** A verified event whose Razorpay subscription ID matches no local Subscription is still
persisted. Kizunia then fetches that provider subscription (within the request budget) and reads its
`notes`: if they carry a Kizunia Subscription ID for a `PROVISIONING` record in the current provider
mode, the provider ID is bound to it (this is how a create whose response was lost is recovered —
[SB-CM-03](commands-and-idempotency.md#sb-cm-03--an-outcome-unknown-command-is-resolved-by-observation-never-by-blind-retry));
otherwise the event is marked `UNMATCHED` and an `UNMATCHED_PROVIDER_SUBSCRIPTION` anomaly is raised.
Kizunia never attaches a provider subscription to a user by any other signal (email, phone, amount).

**Rationale:** [RAZORPAY FACT] Subscriptions can be created from the Dashboard and via Subscription
Links, not only by Kizunia ([razorpay-facts](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#payment-methods-and-customer-originated-changes)).
Dropping such an event loses evidence of a subscription that may be billing a real person; guessing
its owner from contact details risks granting access to the wrong account. V1 does not support
Dashboard-created subscriptions as a way of granting access — an operator who wants to give access
without payment uses an [admin grant](../admin-grants.md).

## SB-WH-07 — The previous webhook secret is accepted during a rotation window

**Status:** Accepted

**Decision:** Kizunia verifies a webhook signature against the current webhook secret and, when one
is configured, the previous secret, for a bounded rotation window (at least the 24-hour Razorpay
retry window after the rotation). Which secret matched is recorded on the `BillingEvent`. Outside a
rotation only one secret is configured.

**Rationale:** [RAZORPAY FACT] After a webhook secret change, retries of events created before the
change are still signed with the old secret — "Using the new secret will lead to a signature
mismatch" ([razorpay-facts](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#webhooks)).
Accepting only the new secret would reject those retries until Razorpay's 24-hour retry window
expires and disables the webhook. Bounding the old secret's acceptance keeps a leaked old secret from
remaining valid indefinitely.

## SB-WH-08 — Kizunia subscribes only to the events it acts on

**Status:** Accepted

**Decision:** The Razorpay webhook is configured for the ten `subscription.*` events, plus
`refund.processed` and `payment.dispute.created` recorded as facts for support visibility. `payment.*`
authorization/capture/failure and `invoice.*` events are not subscribed. An unexpected event type
that nevertheless arrives is persisted and marked `SKIPPED_UNSUPPORTED`.

**Rationale:** Every subscribed event that concerns a subscription costs a provider fetch under
[SB-WH-03](#sb-wh-03--state-changing-events-trigger-an-authoritative-refetch). `payment.*` events
duplicate what `subscription.charged` and the authoritative fetch already provide and are
documented to arrive in contradictory order (`payment.failed` then `payment.captured`); subscribing
to them would add load to the provider request budget without adding information.
