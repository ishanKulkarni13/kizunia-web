# Notification Storage

> **Status:** Implemented
>
> **Last Updated:** 2026-09-18

Notification history is an **append-only log of occurrences**. That framing, not any particular
table shape, is what the storage design must preserve.

The product model is in
[`history/notification-record.md`](../../../project/feature-specification/notification/history/notification-record.md)
and is not repeated here.

---

## What a record carries

| Element | Note |
| --- | --- |
| User | |
| Subject | The competition today. **Must not be modelled as competition-only** — the first non-competition intent must not require a migration |
| Intent | Stable identity; part of the deduplication key |
| Creation time | When the decision was made |
| Delivery state | What suppresses future notifications |
| Response state | Binary in Phase 1 |

---

## The rules storage must enforce

### Append-only

Historical records are never overwritten when a later notification for the same competition is
generated. A later notification is a **new** record; the earlier one stays exactly as it was.

Practically: nothing in the subsystem updates a record's user, subject, intent or creation time
after insert. Only delivery state and response state ever transition, and each only forward.

### Deduplication is a read against delivered records

The dedup query is: *does a delivered record exist for this `(user, subject, intent)`?*
([ND-H-03](../../../project/feature-specification/notification/decisions/history.md#nd-h-03--delivered-consumes-the-triple-undelivered-does-not))

This runs during candidate filtering, per user, per evaluation — so it is on the hot path of the
daily sweep and should be indexable on exactly that triple plus delivery state.

Note what is **not** the query: *has a record ever existed?* An undelivered record must not
suppress
([`history/deduplication.md`](../../../project/feature-specification/notification/history/deduplication.md)).

### The inbox is a read of the same log

History is retained because Kizunia provides an inbox
([`experience/inbox.md`](../../../project/feature-specification/notification/experience/inbox.md)).
The inbox reads per user, newest first — a different access pattern from deduplication over the
same rows.

Both patterns are known up front, which is the right time to index for them. The repository already
demonstrates this reasoning: `CompetitionBookmark` carries an explicit
`@@index([userId, createdAt(sort: Desc)])` because its composite primary key cannot serve the
"newest first for this user" read.

---

## The shape: one record, several subjects

Resolved as **one record with a child collection of subjects**
([ND-H-11](../../../project/feature-specification/notification/decisions/history.md#nd-h-11--a-records-subject-set-is-a-child-collection-not-a-column)).

```text
notification            "4 competitions closing soon"
├─ target  competition A  rank 1
├─ target  competition B  rank 2
├─ target  competition C  rank 3
└─ target  competition D  rank 4
```

This satisfies all three requirements at once: the user sees one notification, history records
exactly which competitions it covered, and response state sits on the record the user actually
interacted with.

The alternative — several flat records sharing a presentation group — keeps deduplication a simple
lookup, but makes "the user saw one notification" a reconstruction the inbox has to perform
correctly every time rather than a fact the data states.

**Why not a JSON array of subjects on the record.** Deduplication asks "has this user already been
told about competition X?" on the hot path of every evaluation. Against a child table that is an
index scan; against a JSON array it is a scan of every one of the user's notifications.

Each subject row carries its **user** alongside its notification — denormalised, deliberately not a
foreign key — so that lookup needs no join. User deletion still reaches these rows through the
notification's cascade.

### Subject identity includes the occasion

A subject row identifies *what* the notification was about and *which occasion of it*
([ND-H-12](../../../project/feature-specification/notification/decisions/history.md#nd-h-12--subject-identity-includes-the-occasion-not-just-the-entity)).
For the deadline intent that is the deadline timestamp itself.

```text
competition A, deadline 2026-10-01T23:00Z   → notified
organizer moves it to 2026-10-08            → a different occasion, may notify again
deadline unchanged, sweep runs again        → same occasion, suppressed
```

Without an occasion in the key both available answers are wrong: suppress forever, and the user is
never warned about the deadline they can act on; ignore history, and every sweep re-notifies.

---

## Four tables, not one

| Table | Holds |
| --- | --- |
| `notification` | What the user is told, once. Title, body, action, snapshot payload, read and responded state |
| `notification_target` | What it is about — subject type, id, occasion, rank |
| `notification_delivery` | One row per (notification, channel, destination), with its own status, attempts and retry schedule |
| `notification_delivery_attempt` | The per-attempt audit trail: when, what outcome, what the provider said |

The split is what lets a delivery fail without touching the notification
([ND-D-01](../../../project/feature-specification/notification/decisions/delivery.md#nd-d-01--generation-and-delivery-are-separate-failure-domains)),
and what lets one user's three browsers have three independent outcomes while the user still has
one notification.

### Read, responded, and delivered are three different things

The Phase 1 vocabulary was existence, delivery and response. It is now four states across two
tables, because collapsing them lost information the product needs:

| State | Lives on | Answers |
| --- | --- | --- |
| Delivery status | `notification_delivery` | Did we get it out, and to where? |
| `readAt` | `notification` | Does this still need the user's attention? |
| `respondedAt` | `notification` | Did this notification achieve anything? |

Read and responded are independent
([ND-H-10](../../../project/feature-specification/notification/decisions/history.md#nd-h-10--read-and-responded-are-separate-states)),
and neither is evidence about delivery. Responding **implies** read (`markResponded` sets both, each
once), which is what clicking through a push banner or an inbox row produces (#93), so
unread-but-responded is not reachable through the API.

**Nothing in this model claims the user saw anything.** For push, the strongest available statement
is that the provider accepted the message. That is `SENT`, and it is deliberately not `DELIVERED`
([ND-D-03](../../../project/feature-specification/notification/decisions/delivery.md#nd-d-03--delivery-state-vocabulary)).

A notification suppressed by a preference change is left with its push delivery `SKIPPED` and a
stated reason; the notification itself stays in the inbox
([ND-P-14](../../../project/feature-specification/notification/decisions/preferences.md#nd-p-14--disabling-an-intent-suppresses-already-generated-notifications),
[ND-D-12](../../../project/feature-specification/notification/decisions/delivery.md#nd-d-12--preferences-are-re-checked-immediately-before-sending)).

---

## What must not be stored here

| Not stored | Where it belongs |
| --- | --- |
| Notification state on competition models | Here, keyed by subject ([`../module-boundaries.md`](../module-boundaries.md)) |
| A "has been notified" flag anywhere | Derived from the log; a flag cannot express per-intent scope |
| Copies of competition data | Read from the competition domain |
| The user's preferences at send time | Preferences are read current ([ND-H-05](../../../project/feature-specification/notification/decisions/history.md#nd-h-05--each-evaluation-uses-current-preferences)) |
| Relevance scores | Unless A-4 decides relevance is persisted ([`../recommendation/candidate-selection.md`](../recommendation/candidate-selection.md)) |

---

## Retention

Still open, and deliberately so — recorded as A-11.

What *is* decided: **nothing that participates in deduplication is pruned.** Deleting a delivered
record would make its subject eligible for discovery again and re-notify a user about something
they were already told. Only finished *job* rows are pruned, on a fixed horizon, because they carry
no product meaning once the notification exists.

The three tables age very differently — attempts fastest, notifications slowest — so a single
horizon is probably the wrong answer when this is picked up.
