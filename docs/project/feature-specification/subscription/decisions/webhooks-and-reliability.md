# Rulings — Webhook Reliability

> **Status:** Live
>
> **Last Updated:** 2026-09-21

The full mechanism is described in
[`../../../architecture/subscription/webhooks/README.md`](../../../architecture/subscription/webhooks/README.md); these rulings
record the decisions behind it.

---

## SB-WH-01 — Signature is verified against the raw body before anything else happens

**Status:** Accepted

**Decision:** The webhook handler verifies `X-Razorpay-Signature` (HMAC-SHA256 over the raw request
body, using the webhook secret) before parsing the body as JSON, before any database write, and
before any business logic runs.

**Rationale:** [RAZORPAY FACT] Signature verification requires the unparsed raw body — pre-parsing
breaks the check, a documented common integration bug (see
[`../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../architecture/subscription/provider-boundary/razorpay-facts.md#webhooks)).
Verifying first, unconditionally, means no unverified payload is ever capable of reaching any code
path that trusts it.

## SB-WH-02 — Every received event is persisted with a unique-constraint dedupe key before acknowledgement

**Status:** Accepted

**Decision:** Once verified, an event is written to a `(provider, eventId)`-unique-constrained
table before Kizunia acknowledges the webhook. A constraint violation (the event was already seen)
is treated as success, not an error.

**Rationale:** [RAZORPAY FACT] Razorpay's delivery is documented at-least-once, with `x-razorpay-event-id`
provided specifically as a dedupe key (see
[`../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../architecture/subscription/provider-boundary/razorpay-facts.md#webhooks)).
[ENGINEERING] The notification subsystem already treats a Prisma `P2002` unique-constraint violation
as "already done, not an error" rather than a read-then-write existence check — reusing that exact
convention here (instead of inventing a new idempotency mechanism) keeps the dedupe atomic under
concurrent delivery of the same event.

## SB-WH-03 — State-changing events trigger an authoritative refetch

**Status:** Accepted

**Decision:** For events that represent a subscription state transition (`subscription.*`), Kizunia
does not apply the webhook payload's embedded status as the new state directly. It fetches the
current Subscription entity from Razorpay's API and derives the new Kizunia state from that
authoritative read.

**Rationale:** [RAZORPAY FACT] Razorpay explicitly documents that webhooks are **not** guaranteed to
arrive in order (see
[`../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../architecture/subscription/provider-boundary/razorpay-facts.md#webhooks)).
Applying an out-of-order payload directly (for example, an older `subscription.pending` arriving
after a newer `subscription.halted` was already processed) would regress state. Refetching the
current authoritative status instead of trusting a possibly-stale payload makes the outcome
independent of delivery order.

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

**Status:** Accepted

**Decision:** Kizunia responds `2xx` to Razorpay as soon as the event is durably persisted
([SB-WH-02](#sb-wh-02--every-received-event-is-persisted-with-a-unique-constraint-dedupe-key-before-acknowledgement)). The actual state-transition
processing ([SB-WH-03](#sb-wh-03--state-changing-events-trigger-an-authoritative-refetch)) happens afterwards, asynchronously, through
Kizunia's existing Postgres-backed work queue.

**Rationale:** [RAZORPAY FACT] Razorpay treats a response slower than five seconds as a delivery
failure and retries (see
[`../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../architecture/subscription/provider-boundary/razorpay-facts.md#webhooks)).
[ENGINEERING] Separating "durably received" from "fully processed" means slow downstream work (an
authoritative Razorpay refetch, a database transaction) never risks tripping that timeout and
triggering needless redelivery — and reuses the exact generation/delivery split already proven by
the notification subsystem's work queue rather than inventing new queue infrastructure.
