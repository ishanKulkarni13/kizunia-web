# Rulings — Commands and Idempotency

> **Status:** Live
>
> **Last Updated:** 2026-09-24

A **command** is anything Kizunia asks Razorpay to *change*: create a subscription, update its plan,
cancel it, cancel a scheduled update. Webhooks and reconciliation cover what Razorpay tells Kizunia;
these rulings cover the opposite direction, which the original design did not address at all. The
mechanism is described in
[`../../../../architecture/subscription/commands/`](../../../../architecture/subscription/commands/README.md).

---

## SB-CM-01 — Every mutating provider call is a recorded billing operation

**Status:** Accepted

**Decision:** Every call that mutates Razorpay state is preceded by a durable `BillingOperation`
record — `{ kind, userId, subscriptionId?, actor, idempotencyKey, status, requestSentAt,
providerError? }`, with status `IN_FLIGHT` → `SUCCEEDED` | `REJECTED` | `OUTCOME_UNKNOWN`. A user has
at most one `IN_FLIGHT` operation at a time, enforced by a database constraint (not a
read-then-write check). A second concurrent command for the same user is refused with a "a billing
change is already in progress" response. An `IN_FLIGHT` operation whose lease expires (the process
died mid-call) becomes `OUTCOME_UNKNOWN`.

**Rationale:** Billing commands cross a network boundary Kizunia does not control; a timeout does
not mean the change did not happen. Without a durable record written *before* the call, Kizunia
cannot answer "did this user's cancellation reach Razorpay?", cannot resolve a lost response, and
cannot stop two browser tabs from each creating a subscription. Serializing per user — rather than
per subscription — is required because the most dangerous race (two concurrent creates) has no
subscription to lock yet. [RAZORPAY FACT] Razorpay itself rejects some concurrent mutations
("another subscription operation is in progress" —
[razorpay-facts](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#upgrade--downgrade)),
but not concurrent *creates*, and its rejection is not something to design around. The record also
distinguishes Kizunia-originated changes from Dashboard- and customer-originated ones in history
([`subscription-history.md`](../../../../architecture/subscription/history-and-audit/subscription-history.md)).

## SB-CM-02 — The local record is written before the provider call

**Status:** Accepted

**Decision:** Creating a subscription first commits a `Subscription` in phase `PROVISIONING` and a
`BillingOperation`, then calls Razorpay with the Kizunia Subscription ID, operation ID and provider
mode in `notes`, and an explicit `expire_by`. The Razorpay subscription ID is bound to the record
when the response arrives. `notes` carry only opaque Kizunia identifiers — never email, name, or
other personal data.

**Rationale:** [RAZORPAY FACT] Create Subscription has no idempotency mechanism
([razorpay-facts](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#creating-subscriptions)).
The only way to find a provider subscription whose creation response was lost is to recognize it
later, and `notes` (returned by both Fetch and Fetch All) is the one field Kizunia fully controls. A
record written *after* the call cannot exist for exactly the case it is needed for — the process that
would have written it is the one that crashed.

## SB-CM-03 — An outcome-unknown command is resolved by observation, never by blind retry

**Status:** Accepted

**Decision:** When a command's outcome is unknown (timeout, connection reset, 5xx after the request
was sent, process death):

- **Create** is never retried. The operation is `OUTCOME_UNKNOWN`; the orphan-discovery scan
  ([SB-RC-09](reconciliation.md#sb-rc-09--provider-subscriptions-kizunia-lost-track-of-are-found-by-a-bounded-scan))
  looks for a provider subscription carrying its `notes`. If found, it is bound to the
  `PROVISIONING` record; if the search window closes without a match, the record becomes
  `ABANDONED` (terminal, never existed at Razorpay) and the user may try again.
- **Update / cancel / cancel-scheduled-change** mark the subscription sync-due; the next
  authoritative sync shows whether the change took effect, and the operation is resolved from that.
  They are not re-sent automatically; the user (or admin) may re-issue them once the operation is
  resolved.

**Rationale:** Retrying a create whose first attempt may have succeeded is how duplicate billing
happens. Mutations on an existing subscription are observable by fetching it, so observation is
always strictly safer than a retry. "Never blind-retry" is the command-side counterpart of
[SB-WH-03](webhooks-and-reliability.md#sb-wh-03--state-changing-events-trigger-an-authoritative-refetch).

## SB-CM-04 — Client retries and multiple tabs resolve to the same operation

**Status:** Accepted

**Decision:** Every user-initiated billing request carries a client-generated idempotency key,
unique per `(userId, idempotencyKey)`. A repeated request with the same key returns the original
operation's result (for a checkout: the same Razorpay subscription and checkout parameters) instead
of acting again. Independently of the key, a checkout request that matches an existing unexpired
`PENDING_AUTHENTICATION` or `PROVISIONING` Subscription for the same plan and cycle returns that one
([SB-UQ-03](uniqueness-and-resubscription.md#sb-uq-03--a-new-purchase-while-a-paid-subscription-is-live-is-refused-not-duplicated)).

**Rationale:** Correctness must not depend on frontend behavior. The idempotency key covers network
retries of one click; the natural-key reuse covers what an idempotency key cannot — two tabs, a
reload, a second device — each of which generates a fresh key.

## SB-CM-05 — Command responses are applied through the same path as synchronization

**Status:** Accepted

**Decision:** A successful command response (the returned Subscription entity) is applied to the
local record through exactly the same mapping and stale-apply guard as any sync
([SB-RC-08](reconciliation.md#sb-rc-08--a-synchronization-result-is-applied-only-if-it-is-newer-than-the-last-one-applied)),
using the command's `requestSentAt` as its observation time, and the subscription is additionally
marked sync-due so a fresh fetch confirms it. A rejected command changes no local subscription state.

**Rationale:** One apply path means one set of bugs. A command response and a webhook-triggered
fetch for the same subscription can arrive in either order; the shared guard makes the result
independent of that order.

## SB-CM-06 — Checkout confirmation syncs only the caller's own subscription

**Status:** Accepted

**Decision:** When Razorpay Checkout completes, the client calls a confirmation endpoint. The server
verifies `razorpay_signature` using the Razorpay subscription ID **it already holds for that user's
`PENDING_AUTHENTICATION` record** (never the ID sent by the client), then marks that subscription
sync-due and attempts an immediate sync within the provider request budget. The endpoint is
rate-limited per user. It never changes local state from client-supplied values; a failed or
missing confirmation only delays access until the webhook or reconciliation sync.

**Rationale:** [RAZORPAY FACT] Razorpay recommends verifying the checkout signature against the
server-held subscription ID
([razorpay-facts](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#creating-subscriptions)).
The endpoint exists for latency, not correctness: it gives a paying user access in seconds rather
than waiting for webhook processing, while remaining harmless if abused — at worst it spends a
rate-limited provider fetch on the caller's own subscription.
