# Open Decisions

> **Status:** Live
>
> **Last Updated:** 2026-09-12

Decisions that are **deliberately not made yet**. This is not a backlog of things nobody got to —
it is a register of questions that were recognized, left open on purpose, and must be answered
before the work they block can proceed.

**How to use this document.** Answering an item means writing a ruling in
[`decisions/`](decisions/README.md), updating the document that explains the behavior, and
**deleting the item from here**. An answered question does not stay on this page.

Items marked **Blocking** must be resolved before implementation of the named area.

---

## A. Found during specification — not present in the source material

These were surfaced while writing this specification and have no answer in the design notes.

### A-1. The `REGISTRATION_CLOSING` evaluation window — **Blocking**

`REGISTRATION_CLOSING` targets exactly 24 hours before the actual deadline timestamp
([ND-I-10](decisions/intents.md#nd-i-10--registration_closing-targets-24-hours-before-the-deadline)).
A scheduled job cannot fire at an arbitrary instant for every competition.

**Needs deciding:** the evaluation window that approximates T-24h — for example "the deadline falls
within the next 24 to 48 hours and no notification has been sent for this deadline event" — or a
finer schedule, or per-competition scheduling.

**Blocks:** `REGISTRATION_CLOSING` implementation entirely.

**Related:** the repository's scheduled jobs run through Vercel Cron
([`internal-jobs.md`](../../../architecture/workflows/internal-jobs.md)), which constrains the
achievable granularity.

### A-2. The legacy `NotificationPreference` model — **Blocking**

A `NotificationPreference` model already exists in the Prisma schema, carrying `emailNotifications`,
`pushNotifications` and an untyped `preferences` JSON field. It presupposes channels Phase 1 does
not have and a preference shape this specification does not describe.

**Needs deciding:** extend it, replace it, or leave it orphaned and introduce a new model.

**Blocks:** preference persistence.

**See:**
[`preference-storage.md`](../../../architecture/notifications/persistence/preference-storage.md).

**Phase 0 note:** the Competition Recommendation Engine
([`docs/architecture/recommendation/README.md`](../../../architecture/recommendation/README.md))
needed a preference profile before this decision could be made, and deliberately did not make it
for the notification subsystem — it uses a hardcoded dummy profile
(`DummyPreferenceProfileProvider`), not `NotificationPreference` and not `User.interests` (which
has been removed from the domain rather than repurposed as a preference source). This decision
remains open and unaffected. See
[`recommendation/preferences/phase-0-dummy-profile.md`](../recommendation/preferences/phase-0-dummy-profile.md).

### A-3. What "queue" means, given there is no queue — **Blocking**

The architecture requires generation and delivery to be separate, with a queue between them
([`queue.md`](../../../architecture/notifications/delivery/queue.md)). The repository has **no**
queue or job infrastructure: every scheduled or background task is a plain synchronous service
invoked by an authenticated HTTP request.

**Needs deciding:** whether Phase 1's queue is a persisted table plus a sweep, or a purely
conceptual seam with synchronous delivery behind it.

**Blocks:** delivery implementation.

### A-4. Where "relevant to the user" comes from for `REGISTRATION_CLOSING` — **Blocking**

`REGISTRATION_CLOSING` treats relevance as an eligibility relationship. Relevance is otherwise
computed during the discovery pipeline.

**Needs deciding:** whether relevance is recomputed for this intent at evaluation time, or read
from a stored relevance result produced elsewhere.

**Why it matters:** recomputation is expensive across all users and all near-deadline competitions;
stored relevance introduces staleness and a storage model this specification does not define.

**Blocks:** `REGISTRATION_CLOSING` implementation and the candidate-selection design.

**See:**
[`candidate-selection.md`](../../../architecture/notifications/recommendation/candidate-selection.md).

**Phase 0 note:** a recommendation engine now exists
([`docs/architecture/recommendation/README.md`](../../../architecture/recommendation/README.md))
and makes "recompute relevance on demand" a cheap, real option — Phase 0's whole design is a
synchronous, on-demand `userId -> RecommendationResult` call. That does not resolve this decision
by itself: Phase 0 evaluates one user manually, not "all near-deadline competitions against all
eligible users" inside a single scheduled invocation, which is the actual cost problem this item
describes. This remains open for Phase 1 to decide with that engine as an available building
block, not as a pre-made answer.

### A-5. Storage shape for an aggregated notification

`REGISTRATION_CLOSING` produces one user-facing notification covering several competitions, while
history must account for each competition's `(user, competition, intent)` triple.

**Needs deciding:** one record with several subjects, or several records sharing a presentation
group.

**See:** [`history/notification-record.md`](history/notification-record.md).

### A-6. Timezone handling for the daily evaluation

`TOP_RELEVANT_COMPETITION` runs "daily at midnight"
([ND-I-04](decisions/intents.md#nd-i-04--daily-midnight-evaluation-with-the-trigger-separated-from-the-logic)).

**Needs deciding:** whether that is one global run or per-user local midnight.

### A-7. Deadline changes after generation

**Needs deciding:** what happens if an organizer moves a registration deadline after a
`REGISTRATION_CLOSING` notification has been generated but before it is delivered.

Phase 1 does not re-validate competition state before delivery
([ND-I-17](decisions/intents.md#nd-i-17--competition-state-is-not-re-validated-before-delivery-in-phase-1)),
which implies the notification is sent regardless — but that implication has not been confirmed as
a decision.

### A-8. Read versus responded

Phase 1 has one interaction bit: responded
([ND-H-08](decisions/history.md#nd-h-08--response-is-binary)). The inbox shows unread state
([`experience/inbox.md`](experience/inbox.md)).

**Needs deciding:** whether a separate "read" state should ever exist — for example, a notification
seen in a list but never opened.

### A-9. Whether Phase 1 leaves a concrete entitlement seam

**Needs deciding:** whether Phase 1 builds a capability check with a permissive default, or simply
avoids designs that would obstruct one later.

**See:** [`future/entitlements.md`](future/entitlements.md).

### A-10. Notification module placement

`next/src/modules/notifications/` is the obvious home given the existing module layout.

**Needs confirming** at architecture time, along with its boundary surface to the competition
module.

---

## B. Left open in the source material

Recorded as intentionally undecided during the design sessions. Both "still open" lists from the
source documents are merged here, deduplicated.

### Relevance and recommendation

| Open decision | Blocks |
| --- | --- |
| The exact relevance scoring formula | Any recommendation implementation |
| Whether different competition fields have inherent importance | The scoring formula |
| How relevance weights are normalized | The scoring formula |
| The exact minimum relevance threshold value | Meaningful tuning; depends on the formula's output distribution |
| Whether the threshold is global, per-intent or per-user | Threshold implementation |
| How much a `null` is penalized relative to a mismatch under a soft preference | The scoring formula — see [`relevance/missing-data.md`](relevance/missing-data.md) |
| The exact location-matching algorithm | Location relevance — see [`relevance/location-matching.md`](relevance/location-matching.md) |
| How often relevance matching runs, beyond the Phase 1 daily job | Cost planning |
| Recommendation freshness strategy | Candidate selection |
| Recommendation batching windows and behavior | Candidate selection |
| Recommendation notification limits | Volume controls |
| Re-notification behavior when a competition's relevance changes | Discovery rules |

### Notification platform

| Open decision | Blocks |
| --- | --- |
| The exact notification persistence model | Storage |
| Recommendation lifecycle and state tracking | Analytics |
| Idempotency and retry behavior | Delivery reliability |
| Notification aggregation rules beyond the Phase 1 target | Aggregation policy |
| Notification expiration | Inbox and retention |
| Read/unread behavior | Inbox — see A-8 |
| Notification inbox behavior beyond the Phase 1 stories | Inbox |
| Quiet hours | Timing controls |
| Notification content and template system | Copy authoring and localization |
| Delivery channels and notification infrastructure | Anything beyond in-app web |

### Product and commercial

| Open decision | Blocks |
| --- | --- |
| Notification preference UX, including individual weight configuration | Preference surface |
| How notification preferences interact with subscription entitlements | Entitlements |
| Subscription entitlement behavior | Paid capabilities |
| Future lifecycle notification rules | Future intents |
| Admin notification rules | Admin-triggered notifications |

---

## What is *not* open

For clarity, since "not yet decided" and "deliberately decided to be minimal" are easy to confuse:

| Sometimes mistaken for open | Actually decided |
| --- | --- |
| Whether `TOP_RELEVANT_COMPETITION` sends more than one competition | Decided: exactly one ([ND-I-06](decisions/intents.md#nd-i-06--top_relevant_competition-selects-exactly-one-competition)) |
| Whether deadline preferences are split in two | Decided: one intent, one toggle ([R-03](decisions/reconciliations.md#r-03--deadline-notification-preferences)) |
| Whether undelivered notifications block future ones | Decided: they do not ([ND-H-03](decisions/history.md#nd-h-03--delivered-consumes-the-triple-undelivered-does-not)) |
| Whether competition state is checked before delivery | Decided: it is not, in Phase 1 ([ND-I-17](decisions/intents.md#nd-i-17--competition-state-is-not-re-validated-before-delivery-in-phase-1)) |
| Whether "mark as participated" is coming | Decided: it is not ([R-05](decisions/reconciliations.md#r-05--explicit-non-goals-not-deferrals)) |
