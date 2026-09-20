# Glossary

> **Status:** Stable
>
> **Last Updated:** 2026-09-12

Canonical terminology for the Notifications subsystem. These meanings are binding: if a document,
a ticket, a schema field or a function name uses one of these words, it means what this page says
it means.

---

## The distinctions that matter most

Four pairs of terms look interchangeable and are not. Collapsing any of them produces a wrong
implementation.

### 1. Filter vs Notification preference

Both use the same competition attributes. They answer different questions.

| | Question | Behavior |
| --- | --- | --- |
| **Filter** | "What competitions do I want to see *right now*?" | Strict retrieval constraint |
| **Notification preference** | "What makes a competition interesting enough that Kizunia should consider telling me?" | Weighted relevance signal |

`Mode = Online` as a filter *excludes* offline competitions from results. `Online → 0.8` as a
preference means offline competitions are less preferred but can still be recommended if other
characteristics make them compelling. Full treatment:
[`preferences/filters-vs-preferences.md`](../preferences/filters-vs-preferences.md).

### 2. Competition preference vs Notification preference

| Term | Determines |
| --- | --- |
| **Competition preference profile** | *Which competitions are relevant to this user* |
| **Notification preference** | *Which types of notification this user wants to receive* |

These are separate systems with separate settings. Turning off a notification type does not erase
the user's competition preferences, and configuring competition preferences does not opt the user
into any notification.

### 3. Relevance vs Filtering

| Term | Nature | When |
| --- | --- | --- |
| **Filtering** | Binary. Removes candidates that cannot participate in this decision at all | Before scoring |
| **Relevance** | Continuous. Produces a ranking signal among surviving candidates | After filtering |

Filtering answers *can this be considered?* Relevance answers *how good is it?* Filtering always
runs first — both for correctness and so scoring is not spent on impossible candidates. See
[`relevance/candidate-filtering.md`](../relevance/candidate-filtering.md).

### 4. Delivered vs Responded

| Term | Meaning |
| --- | --- |
| **Delivered** | The notification actually reached the user |
| **Responded** | The user clicked or opened the notification |

A notification can be created and never delivered. A delivered notification may never be
responded to. These are independent states on the same record, and `delivered` — not merely
"created" — is what suppresses future notifications of the same intent. See
[`history/deduplication.md`](../history/deduplication.md).

---

## Core terms

**Notification intent** *(also: notification type, notification reason)*
A named business purpose that can produce a notification, with its own trigger, eligibility rules,
candidate rules, selection policy, aggregation policy and user preference. Phase 1 intents:
`TOP_RELEVANT_COMPETITION`, `REGISTRATION_CLOSING`. Intent is the subsystem's extensibility
boundary — new notification behavior arrives as a new intent, not as a new branch inside a central
service.

**Notification record / notification occurrence**
The persisted fact that a notification happened for a user at a point in time. Conceptually
carries user, subject (the competition), intent, creation time, delivery state and response state.
Records are never overwritten: a later notification about the same competition and intent creates
a **new** record. See [`history/notification-record.md`](../history/notification-record.md).

**Candidate**
A competition being considered for a particular notification decision, for a particular user,
before it has been scored. Candidates that cannot participate are removed by candidate filtering.

**Eligibility**
Whether a *user* may receive a given intent at all: preferences enabled, required capability
available, preference profile present where the intent needs one. Distinct from candidate
filtering, which is about *competitions*.

**Relevance**
A continuous ranking signal expressing how well a competition matches a user's competition
preference profile. Relevance is not a verdict; the notification policy decides what to do with
the ranking. The scoring formula is deliberately undecided — see
[`open-decisions.md`](../open-decisions.md).

**Minimum relevance threshold**
A floor. A candidate must clear it to be considered at all. It is never lowered to satisfy a
requested quantity.

**Hard constraint**
A preference with weight `1`. The competition must satisfy it to remain eligible. Applied before
relevance scoring. A missing competition value fails a hard constraint.

**Soft preference**
A preference with weight strictly between `0` and `1`. Influences relevance; never excludes.

**No preference**
Either nothing selected for a field, or weight `0`. Both mean *the user does not care about this
attribute* — explicitly **not** *the user dislikes this value*.

**Notification policy**
The per-intent rule for how many ranked candidates to take, and how to present them.
`TOP_RELEVANT_COMPETITION` takes exactly one; `REGISTRATION_CLOSING` takes several and aggregates.

**Aggregation**
Combining multiple qualifying items into a single user-facing notification, so a user gets one
"registration closing soon" summary rather than four separate notifications.

**Deduplication**
Suppressing a notification that has already been delivered for the same *(user, competition,
intent)* triple. Deduplication is scoped to the intent, never to the competition alone.

**Re-evaluation**
A later scheduled run reconsidering a competition that was previously notified about but not
delivered, producing a **new** record. This is not a delivery retry. See
[`history/re-evaluation.md`](../history/re-evaluation.md).

**Discovery notification**
A notification that introduces something to a user for the first time.
`TOP_RELEVANT_COMPETITION` is a discovery notification — not a recurring reminder about something
the user has already seen.

**Deadline notification**
A notification whose purpose is to let a user act before a time limit.
`REGISTRATION_CLOSING` is a deadline notification.

**Notification inbox**
The in-app surface where a user's past and current notifications are listed, with unread state
and links to the related resource.

**Trigger**
Whatever caused an evaluation to run — a scheduled job, an admin action, or a future domain
event. The trigger is not part of the business logic's contract; the same logic must be runnable
from any trigger.

---

## Competition relationship terms

**Relevant to the user**
Computed from the user's competition preference profile. Not a stored user action.

**Bookmarked**
The user explicitly saved the competition. Backed by `CompetitionBookmark`.

**Marked as Registered**
The user told Kizunia they registered with the external organizer. Self-declared and
**unverified**; backed by `CompetitionRegistration`. Never presented as organizer-confirmed.

**Registration open**
Registration is currently accepting entries. Independent of whether the competition itself has
started — an `ONGOING` competition with open registration still counts as registration-open.

---

## Terms that are deliberately not used

| Do not use | Use instead | Why |
| --- | --- | --- |
| Wishlist, waitlist | **Bookmark** | The feature is called bookmark and `CompetitionBookmark` already exists |
| Participants, registered users | **Marked as Registered** | Kizunia has no verified external registration data |
| Hackathon (when meaning the entity) | **Competition** | The domain entity is `Competition` |
| Subscriber, follower | *(no equivalent)* | No such relationship exists in this subsystem |
