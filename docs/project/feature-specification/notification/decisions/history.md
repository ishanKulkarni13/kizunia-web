# Decisions — History, Deduplication and Response

> **Status:** Live
>
> **Last Updated:** 2026-09-17

Rulings covering notification records, what suppresses future notifications, and how user response
is tracked. Explanatory treatment lives in [`history/`](../history/README.md).

---

## ND-H-01 — A notification record is an occurrence

**Status:** Accepted

A notification record represents an **actual notification occurrence** for a user. Conceptually it
carries:

- user
- competition
- notification intent
- creation date/time
- delivery state
- user response state

**Rationale:** Modelling "has this competition been notified about?" as a flag on the competition
or the relationship would lose the timeline, which the inbox needs. An occurrence log answers both
"what did we send?" and "what should we suppress?".

---

## ND-H-02 — History is retained and never overwritten

**Status:** Accepted

Notification history is retained because Kizunia provides a notification inbox where past
notifications remain meaningful to the user.

Historical records are **not** overwritten when a later notification for the same competition is
generated.

```text
Monday    Competition A   TOP_RELEVANT_COMPETITION   delivered = false
Tuesday   Competition A   TOP_RELEVANT_COMPETITION   new record
```

The Monday record remains.

> A later notification is a new notification occurrence and creates a new record. It does not
> update or replace the previous notification record.

**Rationale:** An inbox is a history. Mutating past entries would make it lie.

---

## ND-H-03 — Delivered consumes the triple; undelivered does not

**Status:** Accepted

Notification history affects future candidate eligibility according to the intent. For the Phase 1
discovery intent:

```text
Previous notification exists
├── delivered = true    -> exclude this competition for the same intent
└── delivered = false   -> competition remains eligible for future evaluation
```

An undelivered notification does not permanently consume the competition for that intent.

**Rationale:** Suppression exists to avoid telling a user the same thing twice. A notification the
user never received has not told them anything.

**Reconciliation:** an earlier passage in the source material read as "once surfaced, never
again", without the delivery qualifier. This ruling is the refined and authoritative form — see
[reconciliations.md](reconciliations.md#r-01--deduplication-is-keyed-on-delivery-not-on-generation).

---

## ND-H-04 — Re-evaluation creates a new record and is not a retry

**Status:** Accepted

If a competition with an undelivered notification becomes the best candidate again in a later
evaluation, Kizunia may generate a **new** notification record. This is re-evaluation, not a
direct delivery retry.

The retry / re-delivery strategy is a separate implementation concern and may evolve
independently.

**Rationale:** The later evaluation re-derived the recommendation from current data and current
preferences. That is a new decision, and it deserves its own record. Reusing the old record would
misdate it and conflate two distinct mechanisms.

---

## ND-H-05 — Each evaluation uses current preferences

**Status:** Accepted

Every scheduled evaluation uses the user's **current** competition preference profile. Past
preference configurations do not affect the current evaluation.

```text
Monday    preferences: AI 0.9
Tuesday   user changes to: Design 0.9
Tuesday's evaluation uses Design 0.9
```

Historical notification records remain preserved independently.

**Rationale:** Relevance is a statement about what the user cares about *now*. Versioning
preferences and replaying history against past configurations would add significant complexity for
no user-visible benefit.

---

## ND-H-06 — Deduplication is keyed on user + competition + intent

**Status:** Accepted

Notification identity is conceptually:

```text
(user, competition, notification intent)
```

and **not**:

```text
(user, competition)
```

A previous discovery notification does not prevent a later deadline notification for the same
competition.

**Rationale:** The competition is the subject, not the reason. "We found Competition A" and
"Competition A's registration closes tomorrow" are different messages serving different purposes.

---

## ND-H-07 — Different intents are independent

**Status:** Accepted

The same competition may generate notifications for different intents, including on the same day
when each intent's conditions are satisfied:

```text
10:00   Competition A   TOP_RELEVANT_COMPETITION
14:00   Competition A   REGISTRATION_CLOSING
```

This is intentional and acceptable.

> A notification for one reason does not suppress a notification for another reason.

**Rationale:** Each intent owns its own rules. Cross-intent suppression would couple intents
together and break the extensibility boundary that makes new intents cheap to add.

**Note:** cross-intent volume limits are a legitimate future capability, but they are a *limit*,
not a *dedup rule*, and are not in Phase 1 — see [`future/README.md`](../future/README.md).

---

## ND-H-08 — Response is binary

**Status:** Accepted

For Phase 1, notification interaction is intentionally simple. Clicking or opening a notification
marks it responded.

```text
Notification created  -> responded = false
User clicks           -> responded = true
```

No more granular interaction model is required, and the system does not distinguish kinds of
interaction at this stage.

**Rationale:** One bit answers the only Phase 1 question — did this notification do anything? A
richer event vocabulary is a future analytics concern and is listed in
[`future/personalization.md`](../future/personalization.md).

---

## ND-H-09 — Previously notified competitions may still rank

**Status:** Accepted

ND-H-03 prevents a delivered competition from generating another notification for the same intent.
It does **not** remove that competition from relevance ranking.

A previously surfaced competition may still appear in a user's current ranking if it remains
sufficiently relevant, and may still appear inside another intent's aggregated selection.

```text
Previous discovery prevents a repeated discovery notification.
Previous discovery does not make the competition irrelevant.
```

**Rationale:** Relevance and notification eligibility are different questions. Deleting past
recommendations from the ranking would corrupt the ranking itself and would leak discovery history
into every other intent that consumes relevance.

---

## ND-H-10 — Read and responded are separate states

**Status:** Accepted — resolves open item A-8, extends [ND-H-08](#nd-h-08--response-is-binary)

A notification carries two independent interaction timestamps:

| State | Set when | Answers |
| --- | --- | --- |
| **Read** | The user has seen it in the inbox, or marked it read | "Is this still demanding attention?" |
| **Responded** | The user opened the notification's action | "Did this notification do anything?" |

Neither implies the other, and neither is implied by delivery. All four combinations are real and
meaningful:

```text
unread,  unresponded   the normal state of a new notification
read,    unresponded   seen and dismissed — the notification did not land
read,    responded     the notification worked
unread,  responded     clicked straight through from a push banner
```

> **Amended by #93:** clicking through a push banner acknowledges it with `responded`, which also
> marks it read (as opening it from the inbox always did) — otherwise the badge keeps counting
> something the user already opened. The fourth combination is therefore not produced by the API;
> the two bits remain independent otherwise (`read` alone never implies `responded`).

**Rationale:** A-8 asked whether these should ever diverge. They must: the inbox needs "what needs
my attention?", which is read state, while the product needs "did this notification achieve
anything?", which is response. Collapsing them means either the unread badge lies after a user
glances at the list, or every scroll-past is counted as a notification that worked. ND-H-08 stands
unchanged — response is still one bit, with no richer interaction vocabulary; this ruling adds a
second, differently-scoped bit rather than making response granular.

---

## ND-H-11 — A record's subject set is a child collection, not a column

**Status:** Accepted — resolves open item A-5

An aggregated notification is **one** record with **several** subject rows attached to it.

```text
notification  "4 competitions closing soon"
├── subject  competition A  rank 1
├── subject  competition B  rank 2
├── subject  competition C  rank 3
└── subject  competition D  rank 4
```

This satisfies all three requirements A-5 imposed: the user sees one notification
([ND-I-12](intents.md#nd-i-12--one-notification-per-deadline-event)), history records exactly which
competitions were covered, and response state sits on the record the user actually interacted with.

**Alternative rejected:** several flat records sharing a presentation group. It keeps deduplication
a simple lookup, but makes "the user saw one notification" a reconstruction the inbox has to
perform correctly every time rather than a fact the data states.

**Why not a JSON array of subjects on the record:** deduplication asks "has this user already been
told about competition X?" on the hot path of every evaluation. Against a child collection that is
an index scan; against a JSON array it is a scan of every one of the user's notifications.

Each subject row carries its user alongside its notification, so that deduplication lookup needs no
join.

---

## ND-H-12 — Subject identity includes the occasion, not just the entity

**Status:** Accepted — resolves open item A-7

A subject row identifies *what the notification was about* and *which occasion of it*. For the
deadline intent, the occasion is the deadline timestamp itself.

```text
competition A, deadline 2026-10-01T23:00Z   ->  notified
organizer moves the deadline to 2026-10-08  ->  a different occasion, may notify again
deadline unchanged, sweep runs again        ->  same occasion, suppressed
```

**Rationale:** A-7 asked what happens when an organizer moves a deadline after a notification was
generated. Without an occasion in the key, the two available answers are both wrong: suppress
forever, and the user is never told about the deadline they can actually act on; ignore history,
and every sweep re-notifies. Versioning the subject makes "the deadline moved" a genuinely new
event and "the sweep ran twice" a duplicate, which is exactly the distinction the product needs.

This generalizes past the deadline intent: any future intent whose subject can recur gets the same
mechanism without a schema change. An intent whose subject cannot recur simply leaves the occasion
empty.
