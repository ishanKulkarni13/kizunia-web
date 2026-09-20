# Decisions — Delivery

> **Status:** Live
>
> **Last Updated:** 2026-09-17

Rulings covering how a generated notification reaches a user: channels, delivery state, retry,
push subscriptions, and what the system is and is not entitled to claim. Explanatory treatment
lives in [`architecture/notifications/delivery/`](../../../../architecture/notifications/delivery/README.md).

These rulings postdate the Phase 1 register. Where an earlier ruling assumed there was no delivery
layer, the amendment is noted on that ruling rather than applied silently.

---

## ND-D-01 — Generation and delivery are separate failure domains

**Status:** Accepted

A notification exists once it is persisted. Delivering it through a channel is a separate
operation with its own state, its own retries and its own terminal failures.

```text
Recommendation -> Policy -> Notification -> Delivery -> Provider
                                 |             |
                              durable      retryable
```

A delivery failure must retry **delivery**. It must never re-run recommendation generation, and it
must never remove or alter the notification record.

**Rationale:** re-running generation to fix a transport failure re-derives a decision that was
already made correctly, wastes the most expensive step in the pipeline, and can produce a
*different* decision from the one the user was already told about.

---

## ND-D-02 — The queue is a persisted table plus a sweep

**Status:** Accepted — resolves open item A-3

Work is a durable row. A scheduled sweep claims rows and processes them. There is no broker, no
Redis, no external queue service.

[`queue.md`](../../../../architecture/notifications/delivery/queue.md) framed this as a choice
between a persisted table and a purely conceptual seam, and named the deciding condition: the
moment a channel exists that can **fail independently**, the persisted table becomes necessary.
Web push is that channel.

**Rationale:** Postgres is already the durable source of truth, already available in every
execution, and already understood by everyone working here. A broker would be new infrastructure
bought before its first real requirement.

**Consequence:** the dispatch mechanism is isolated behind a port so it can later be replaced — by
Kafka or anything else — without the notification domain changing. See
[ND-D-10](#nd-d-10--infrastructure-lives-behind-ports-not-inside-the-domain).

---

## ND-D-03 — Delivery state vocabulary

**Status:** Accepted

Every delivery carries exactly one of:

| State | Means |
| --- | --- |
| `PENDING` | The row exists. Nothing has been attempted |
| `PROCESSING` | A worker holds a lease on it |
| `SENT` | The provider **accepted** the message |
| `DELIVERED` | The channel can genuinely assert delivery |
| `FAILED` | Terminal. A permanent error, or attempts exhausted |
| `SKIPPED` | Deliberately not attempted, with a recorded reason |

`SENT` and `DELIVERED` are different claims and must not be conflated. For web push, `SENT` is the
strongest statement available: FCM accepting a message says the message was queued for a device,
not that the device received it, and certainly not that a person saw it.

**Rationale:** a status vocabulary that overstates what the system knows makes every later question
unanswerable. "Did we deliver it?" has to mean something specific or it means nothing.

---

## ND-D-04 — In-app delivery completes at persistence

**Status:** Accepted

For the `IN_APP` channel, the delivery row is created already `DELIVERED`, in the same transaction
as the notification itself.

For an inbox, the record being committed and visible **is** the delivery. There is no later event
to wait for, no transport to fail, and no acknowledgement to receive.

**Rationale:** this is what makes
[ND-H-03](history.md#nd-h-03--delivered-consumes-the-triple-undelivered-does-not) coherent.
`delivered = true` consumes the triple and means *the user is reasonably presumed to have been
told*. An inbox entry the user can open satisfies that. Marking it delivered at generation time is
therefore not a shortcut that defeats the product rule — for this channel, generation and delivery
are genuinely the same moment.

Push delivery is **not** a precondition for this. A user with no push subscription still receives
the notification; they receive it in the inbox.

---

## ND-D-05 — At-least-once, never exactly-once

**Status:** Accepted

The system guarantees at-least-once processing with idempotent effects. It does not claim
exactly-once delivery, because exactly-once across a process boundary and a third-party provider is
not achievable without distributed transactions that neither Postgres nor FCM offers.

Concretely, the one unavoidable window: a worker sends successfully to the provider and crashes
before recording the outcome. The next attempt sends again.

What this costs and how it is bounded:

- duplicate **notifications** are prevented by a database uniqueness constraint
  ([ND-D-06](#nd-d-06--idempotency-is-enforced-by-the-database-not-by-a-check));
- duplicate **pushes** are mitigated at the client — every push carries a collapse identity equal
  to the notification id, so the operating system replaces the earlier banner rather than stacking
  a second one.

**Rationale:** the alternative is at-most-once, which silently loses notifications on any crash.
Given the choice between a rare duplicate banner the OS collapses and a silently dropped
notification, the duplicate is clearly preferable — and it is honest about what the system can
prove.

---

## ND-D-06 — Idempotency is enforced by the database, not by a check

**Status:** Accepted

Two uniqueness constraints carry the guarantee:

```text
notification   unique (user, intent, occurrence)
job            unique (dedupe key)
```

A read-then-write existence check is a race, not a guarantee: two concurrent executions both read
"no record" and both insert. The constraint is the only thing that holds under concurrency.

**A uniqueness violation on either constraint is a success, not an error.** It means "already
scheduled" or "already generated" — the desired end state — and the operation completes normally.

**Rationale:** duplicate scheduler runs and duplicate worker executions are certainties on Vercel,
not edge cases
([`failure-and-idempotency.md`](../../../../architecture/notifications/cross-cutting/failure-and-idempotency.md)).
The protection has to live where concurrency is actually arbitrated.

---

## ND-D-07 — Occurrence identity is decided by the scheduler, never by the worker

**Status:** Accepted

The occurrence key, and any evaluation window the decision depends on, are computed **once** when
work is scheduled and carried in the job's payload. A worker reads them; it never derives them from
its own clock.

```text
Scheduler    computes  occurrence = top:2026-09-17,  window = [.., ..)
Job payload  carries   both
Worker       reads     both, and consults no clock for either
```

Without this, a job retried across a UTC midnight computes a *different* occurrence key and
generates a second notification for the same occasion, while a deadline window recomputed a day
later silently evaluates a different set of competitions under the same key.

**Rationale:** a retry must reproduce the same decision, not a fresh one. This is the same rule the
policy layer already follows — `evaluatedAt` is always supplied by the caller and never read from
the clock inside a policy — extended across the process boundary that retries introduce.

---

## ND-D-08 — Retries are bounded, backed off, and classified

**Status:** Accepted

Every failure is classified before it is retried:

| Classification | Behavior |
| --- | --- |
| Retryable | Retry with exponential backoff and jitter, up to a bounded maximum |
| Permanent | Fail immediately. No retry |
| Invalid destination | Fail immediately, and deactivate the destination ([ND-D-09](#nd-d-09--an-invalid-push-subscription-is-deactivated-on-first-proof)) |

An unrecognized provider error is treated as **retryable**. Failing soft on the unknown case loses
at most some work to a bounded retry; failing hard silently drops notifications for an error nobody
has seen yet.

Jitter is not optional. Several thousand per-user jobs enqueued by a single scheduler pass will
retry in lockstep without it, and re-create the failure that caused the retry.

Retry parameters are configuration, not constants scattered through the code. They are expected to
differ by deployment: a system whose worker sweep runs every few minutes and one whose sweep runs
daily do not want the same attempt count.

**Rationale:** unbounded retries turn a provider outage into a self-inflicted outage. No retries
turn a transient network blip into a lost notification.

---

## ND-D-09 — An invalid push subscription is deactivated on first proof

**Status:** Accepted

When a provider reports that a token is unregistered or malformed, the subscription is marked
invalid immediately, with a timestamp, and is excluded from every future send. It is not retried.

A subscription that accumulates repeated retryable failures without ever succeeding is also
deactivated, defensively — a token can be dead in a way the provider does not report cleanly.

Deactivation is per-subscription and affects no other subscription belonging to the same user.

**Rationale:** a browser that cleared its storage or revoked permission will never accept another
message. Retrying it forever spends quota, pollutes failure metrics, and delays real deliveries
behind work that cannot succeed.

---

## ND-D-10 — Infrastructure lives behind ports, not inside the domain

**Status:** Accepted

Two boundaries are mandatory:

```text
Notification domain -> WorkQueue port    -> Postgres      (future: Kafka)
Notification domain -> PushProvider port -> Firebase FCM  (future: others)
```

No file outside the push adapter may import a provider SDK. No file outside the queue
implementation may know how work is stored or claimed. The domain sees a classified outcome, never
a vendor error code or a vendor response shape.

This is two abstractions, not a general policy of abstracting everything. Each exists because a
specific, named replacement is anticipated: Kafka for dispatch, additional channels and providers
for delivery. That is the bar an abstraction has to clear here
([principle 13](../../../../architecture/notifications/principles.md)).

**Rationale:** the whole point of the boundary is that swapping the implementation is a change to
one file rather than an archaeology exercise across the subsystem.

---

## ND-D-11 — A notification may have several deliveries; the user still has one notification

**Status:** Accepted

One notification fans out to one delivery per channel, and for push, one delivery per active
subscription. Each has independent state, attempts and failures.

```text
Notification
├── delivery  IN_APP                 DELIVERED
├── delivery  WEB_PUSH  laptop       SENT
├── delivery  WEB_PUSH  phone        FAILED
└── delivery  WEB_PUSH  old browser  FAILED (subscription deactivated)
```

None of this is visible to the user as more than one notification, and no delivery outcome changes
the inbox record.

**Rationale:** a user with three browsers has not asked to be told three times; they have asked to
be reachable on three devices. Per-destination state is what makes partial failure diagnosable
instead of collapsing to one misleading boolean.

---

## ND-D-12 — Preferences are re-checked immediately before sending

**Status:** Accepted — narrows [ND-I-17](intents.md#nd-i-17--competition-state-is-not-re-validated-before-delivery-in-phase-1)

A user who disables an intent after a notification was generated but before it was pushed does not
receive the push. The delivery is marked `SKIPPED` with that reason recorded.

The already-created notification **remains in the inbox**. It is history, and history is not
rewritten ([ND-H-02](history.md#nd-h-02--history-is-retained-and-never-overwritten)).

ND-I-17 says *competition state* is not re-validated before delivery; that remains true, and a
cancelled competition's notification is still sent. This ruling is narrower and concerns the user's
own communication preference, which is the one thing a delivery must not ignore.

**Rationale:** pushing to someone who has just switched the setting off is the clearest possible
evidence that a preference control does not work. The check is a single indexed read on a path that
is already doing far more expensive work.

---

## ND-D-13 — A stale delivery is skipped, not failed

**Status:** Accepted

A push that has not succeeded within its useful lifetime is marked `SKIPPED` with reason `STALE`
rather than retried further or marked `FAILED`.

**Rationale:** a push about a deadline two days away has no value delivered six hours late, and the
inbox already carries the information. `FAILED` would misreport a deliberate decision as an error,
and a system whose failure metrics are full of deliberate decisions stops being readable.
