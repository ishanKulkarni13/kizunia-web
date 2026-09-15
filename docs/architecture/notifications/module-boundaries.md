# Module Boundaries

> **Status:** Design
>
> **Last Updated:** 2026-09-12

Notifications exists as a **separately bounded module**. It communicates with other Kizunia domains
through well-defined boundaries rather than spreading notification-specific logic through
competitions, users and bookmarks.

---

## What the module owns

The notification subsystem has clear ownership of its own:

- domain concepts and terminology
- business rules
- notification intents and types
- preference handling
- candidate processing
- filtering
- relevance and ranking **integration** (not the competition domain's data)
- notification generation
- notification history
- delivery orchestration
- future analytics and tracking extensions

---

## What it must not do

> **Do not turn existing competition services or models into "notification services."**

The competition domain remains responsible for competitions. The notification domain **consumes**
the information it needs.

Specific prohibitions:

| Do not | Instead |
| --- | --- |
| Add notification fields or flags to competition models | Keep notification state in notification storage |
| Add notification methods to competition services | Read competition data through a defined boundary |
| Derive or write `CompetitionStatus` | Read it; the competition domain derives it ([`lifecycle-automation.md`](../workflows/competition/lifecycle-automation.md)) |
| Write to `CompetitionBookmark` or `CompetitionRegistration` | Read them as recipient relationships |
| Put notification rules inside a scheduled-job route handler | Routes are triggers; logic lives in the module ([`triggers/`](triggers/README.md)) |
| Let the frontend decide whether a notification should exist | Generation is a server-side domain decision |

---

## Module placement

The repository's module layout is `next/src/modules/<domain>/` — currently `assets`, `blogs`,
`common`, `competitions`, `links`, `locations`, `portfolio`, `projects`, `taxonomy`, `teams`,
`technologies`, `users`.

Notifications is a **sibling** of `competitions`, not a folder inside it.

> **Open:** the exact placement and internal layout is confirmed at implementation time — see
> [`open-decisions.md`](../../project/feature-specification/notification/open-decisions.md) item
> A-10.

---

## What the module reads from other domains

Every inbound dependency is a **read**, through a boundary the notification module defines and the
other domain does not know about.

| From | What | Why |
| --- | --- | --- |
| Competitions | Competition attributes, lifecycle dates, derived status | Candidate selection, relevance, intent eligibility |
| Competitions | `CompetitionBookmark` | `REGISTRATION_CLOSING` recipient eligibility |
| Competitions | `CompetitionRegistration` | `REGISTRATION_CLOSING` exclusion |
| Users | User identity | Recipient identity |
| Taxonomy / Locations | Category and location structures | Preference matching |
| Recommendations (Phase 0) | `userId -> RecommendationResult` | Relevance evaluation — see [`docs/architecture/recommendation/README.md`](../recommendation/README.md) |

The Recommendations dependency is different in kind from the others: it is not a raw data read but
a call into another capability's own public contract. Notifications should depend on
`RecommendationService` (or the pure engine directly) for relevance, not reimplement scoring or
ranking — see
[`docs/project/feature-specification/recommendation/phase-relationship.md`](../../project/feature-specification/recommendation/phase-relationship.md).
This is what "Relevance and ranking **integration** (not the competition domain's data)" in "What
the module owns" above now means concretely.

### The direction rule

Other domains do not call into Notifications to "send a notification". Notifications decides for
itself, on its own triggers, what should exist.

The one exception anticipated in future is an **admin-designated update**, where an explicit human
decision is the trigger. Even then, the trigger enters through the trigger layer
([`triggers/event-and-admin-triggers.md`](triggers/event-and-admin-triggers.md)) and the rules
still belong to the intent.

---

## What other domains may read from Notifications

The notification inbox surface, and nothing else. No other domain should need notification state to
do its job. If one does, that is a signal that a notification concern has leaked.

---

## Where the boundary is most at risk

Two places, worth naming so they are watched during implementation:

**1. Relevance needs a lot of competition data.** Scoring a candidate against a preference profile
touches categories, technologies, location, mode, fee and eligibility. The temptation is to reach
directly into competition internals or to build notification-shaped queries inside the competition
module. Neither is acceptable: the boundary is a defined read contract, and the shape of that
contract is part of the candidate-selection design
([`recommendation/candidate-selection.md`](recommendation/candidate-selection.md)).

**2. "Relevant to the user" is a notification concept that looks like a competition concept.** It
is computed from a preference profile owned by Notifications, using competition data. It must not
become a field on a competition, and it must not leak into the browsing experience — a notification
preference never changes what search returns
([`filters-vs-preferences.md`](../../project/feature-specification/notification/preferences/filters-vs-preferences.md)).

---

## Relationship to the Search subsystem

Search and Notifications both consume competition attributes and both have a concept of
preferences, and the [Search specification](../../project/feature-specification/search/README.md)
already separates Search, Filters, Saved Search, Preferences and Recommendations as five concepts
that must not collapse into one.

Notifications owns the Preferences and Recommendations halves for the notification use case. Search
owns retrieval. Where both need to answer the same question — most obviously *what does "in Pune"
mean* — they must agree rather than each growing a private answer. See
[`relevance/location-matching.md`](../../project/feature-specification/notification/relevance/location-matching.md).
