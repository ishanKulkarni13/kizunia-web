# Notification Storage

> **Status:** Design — open decisions attached
>
> **Last Updated:** 2026-09-12

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

## Blocking: the aggregated notification shape

`REGISTRATION_CLOSING` produces **one** user-facing notification covering several competitions,
while deduplication reads a per-competition triple. Two shapes are possible and neither is chosen —
open item **A-5**.

| Shape | Gains | Costs |
| --- | --- | --- |
| One record, several subjects | Matches what the user saw; response state sits at the right level | Dedup must look inside a subject set; the record is no longer a flat row |
| Several records, shared presentation group | Dedup stays a simple lookup; flat rows | The inbox must reconstruct the grouping; response state needs a defined level |

Requirements either shape must satisfy:

- the user sees one notification
  ([ND-I-12](../../../project/feature-specification/notification/decisions/intents.md#nd-i-12--one-notification-per-deadline-event));
- history records which competitions were included;
- response state is meaningful where the user actually interacts.

---

## Delivery and response states

Both start false. Both move forward only.

`delivered` is the load-bearing one — it is what consumes a triple. Its exact semantics and the
underlying mechanism are deliberately left open
([`../delivery/README.md`](../delivery/README.md)), but **whatever definition is adopted must be
consistent with that consequence**: a notification counted as delivered is one the user is presumed
to have been told.

Phase 1 needs no separate suppression or cancellation state. A notification suppressed by a
preference change is simply left `delivered = false`
([ND-P-14](../../../project/feature-specification/notification/decisions/preferences.md#nd-p-14--disabling-an-intent-suppresses-already-generated-notifications)).

The tracking vocabulary is deliberately minimal: existence, delivery, response. Richer states are
future work that must not require contaminating this model
([`../cross-cutting/analytics-and-tracking.md`](../cross-cutting/analytics-and-tracking.md)).

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

Undecided. Whether history is kept indefinitely, and whether notifications age out of the inbox, is
an open item — and it interacts with deduplication: **pruning a delivered record would make a
competition eligible for discovery again.** Any retention policy has to reckon with that, not just
with storage size.
