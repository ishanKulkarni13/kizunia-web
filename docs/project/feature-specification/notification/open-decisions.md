# Open Decisions

> **Status:** Live
>
> **Last Updated:** 2026-09-17

Decisions that are **deliberately not made yet**. This is not a backlog of things nobody got to —
it is a register of questions that were recognized, left open on purpose, and must be answered
before the work they block can proceed.

**How to use this document.** Answering an item means writing a ruling in
[`decisions/`](decisions/README.md), updating the document that explains the behavior, and
**deleting the item from here**. An answered question does not stay on this page.

Items marked **Blocking** must be resolved before implementation of the named area.

---

## A. Found during specification — not present in the source material

### A-9. Whether the delivery phase leaves a concrete entitlement seam

**Needs deciding:** whether a capability check with a permissive default is built, or designs that
would obstruct one later are simply avoided.

**See:** [`future/entitlements.md`](future/entitlements.md).

**Note:** the delivery work did not force this. Notification preferences are read through one
service, and the send path already consults it immediately before dispatch
([ND-D-12](decisions/delivery.md#nd-d-12--preferences-are-re-checked-immediately-before-sending)) —
which is the natural place a capability check would sit. Nothing currently prevents adding one.

### A-11. Retention and the deduplication interaction

**Needs deciding:** how long notification history, delivery records and delivery attempts are kept.

**Why it matters:** this is not only a storage-size question. Deduplication reads delivered records
([ND-H-03](decisions/history.md#nd-h-03--delivered-consumes-the-triple-undelivered-does-not)), so
**pruning a delivered record makes its subject eligible for discovery again.** Any retention policy
has to reckon with that.

The three tables age very differently — delivery attempts accumulate fastest, notifications
slowest — so a single horizon is probably wrong.

**Blocks:** nothing yet. Completed job rows are pruned on a fixed horizon because they carry no
product meaning; nothing that participates in deduplication is pruned at all.

---

## B. Left open in the source material

Recorded as intentionally undecided during the design sessions.

### Relevance and recommendation

| Open decision | Blocks |
| --- | --- |
| The exact relevance scoring formula | Tuning; the engine currently ships a weighted-coverage scorer |
| Whether different competition fields have inherent importance | The scoring formula |
| How relevance weights are normalized | The scoring formula |
| The exact minimum relevance threshold value | Meaningful tuning; depends on the formula's output distribution |
| Whether the threshold is global, per-intent or per-user | Threshold implementation |
| How much a `null` is penalized relative to a mismatch under a soft preference | The scoring formula — see [`relevance/missing-data.md`](relevance/missing-data.md) |
| The exact location-matching algorithm | Location relevance — see [`relevance/location-matching.md`](relevance/location-matching.md) |
| Recommendation freshness strategy | Candidate selection |
| Recommendation batching windows and behavior | Candidate selection |
| Cross-intent notification volume limits | Volume controls |
| Re-notification behavior when a competition's relevance changes | Discovery rules |

### Notification platform

| Open decision | Blocks |
| --- | --- |
| Richer lifecycle and state tracking beyond the current vocabulary | Analytics — see [`cross-cutting/analytics-and-tracking.md`](../../../architecture/notifications/cross-cutting/analytics-and-tracking.md) |
| Notification aggregation rules beyond the deadline summary | Aggregation policy |
| Notification expiration in the inbox | Inbox and retention — see A-11 |
| Notification inbox behavior beyond the current stories | Inbox |
| Quiet hours, snoozing, digests | Timing controls |
| A content template and localization system | Copy authoring beyond per-intent renderers |
| Email, WhatsApp and mobile-push channels | Anything beyond in-app and web push |
| Whether channels become configurable per intent | Per-channel preferences |

### Product and commercial

| Open decision | Blocks |
| --- | --- |
| Notification preference UX, including individual weight configuration | Preference surface |
| How notification preferences interact with subscription entitlements | Entitlements — see A-9 |
| Subscription entitlement behavior | Paid capabilities |
| Future lifecycle notification rules | Future intents |
| Admin notification rules beyond a flat broadcast | Audience targeting |

---

## Recently answered

Kept briefly for orientation, since several of these were long-standing blockers. They are rulings
now, not open questions.

| Was | Answered by |
| --- | --- |
| A-1 The `REGISTRATION_CLOSING` evaluation window | [ND-I-19](decisions/intents.md#nd-i-19--the-deadline-evaluation-window-is-a-daily-band-not-an-instant) |
| A-2 The legacy preference model | [ND-P-15](decisions/preferences.md#nd-p-15--notification-and-competition-preference-persistence) |
| A-3 What "queue" means, given there is no queue | [ND-D-02](decisions/delivery.md#nd-d-02--the-queue-is-a-persisted-table-plus-a-sweep) |
| A-4 Where relevance comes from for `REGISTRATION_CLOSING` | [ND-I-20](decisions/intents.md#nd-i-20--deadline-relevance-is-recomputed-per-user-not-stored) |
| A-5 Storage shape for an aggregated notification | [ND-H-11](decisions/history.md#nd-h-11--a-records-subject-set-is-a-child-collection-not-a-column) |
| A-6 Timezone handling for the daily evaluation | [ND-I-23](decisions/intents.md#nd-i-23--the-daily-evaluation-is-one-global-run-at-a-configured-hour) |
| A-7 Deadline changes after generation | [ND-H-12](decisions/history.md#nd-h-12--subject-identity-includes-the-occasion-not-just-the-entity) |
| A-8 Read versus responded | [ND-H-10](decisions/history.md#nd-h-10--read-and-responded-are-separate-states) |
| A-10 Notification module placement | Confirmed at `next/src/modules/notifications/` |
| The exact notification persistence model | [ND-H-11](decisions/history.md#nd-h-11--a-records-subject-set-is-a-child-collection-not-a-column), [ND-D-03](decisions/delivery.md#nd-d-03--delivery-state-vocabulary) |
| Idempotency and retry behavior | [ND-D-06](decisions/delivery.md#nd-d-06--idempotency-is-enforced-by-the-database-not-by-a-check), [ND-D-08](decisions/delivery.md#nd-d-08--retries-are-bounded-backed-off-and-classified) |
| Read/unread behavior | [ND-H-10](decisions/history.md#nd-h-10--read-and-responded-are-separate-states) |

---

## What is *not* open

For clarity, since "not yet decided" and "deliberately decided to be minimal" are easy to confuse:

| Sometimes mistaken for open | Actually decided |
| --- | --- |
| Whether `TOP_RELEVANT_COMPETITION` sends more than one competition | Decided: exactly one ([ND-I-06](decisions/intents.md#nd-i-06--top_relevant_competition-selects-exactly-one-competition)) |
| Whether deadline preferences are split in two | Decided: one intent, one toggle ([R-03](decisions/reconciliations.md#r-03--deadline-notification-preferences)) |
| Whether undelivered notifications block future ones | Decided: they do not ([ND-H-03](decisions/history.md#nd-h-03--delivered-consumes-the-triple-undelivered-does-not)) |
| Whether competition state is checked before delivery | Decided: it is not ([ND-I-17](decisions/intents.md#nd-i-17--competition-state-is-not-re-validated-before-delivery-in-phase-1)). The user's own preference *is* ([ND-D-12](decisions/delivery.md#nd-d-12--preferences-are-re-checked-immediately-before-sending)) |
| Whether "mark as participated" is coming | Decided: it is not ([R-05](decisions/reconciliations.md#r-05--explicit-non-goals-not-deferrals)) |
| Whether exactly-once delivery is a goal | Decided: it is not achievable and is not claimed ([ND-D-05](decisions/delivery.md#nd-d-05--at-least-once-never-exactly-once)) |
| Whether admin announcements need audience segmentation | Decided: flat broadcast only ([ND-I-21](decisions/intents.md#nd-i-21--feature_announcement-is-an-admin-authored-scheduled-broadcast)) |
