# Notifications Domain — Relationships

> **Status:** Design
>
> **Last Updated:** 2026-09-12

Where this domain ends and others begin.

---

## The map

```text
User
 │  owns
 ├─────────────▶ Competition Preference Profile     (Notifications)
 ├─────────────▶ Notification Preferences           (Notifications)
 └─────────────▶ Notification Records               (Notifications)
                          │ subject
                          ▼
                    Competition                     (Competition domain — read only)
                          ▲
     ┌────────────────────┼────────────────────┐
     │                    │                    │
CompetitionBookmark  CompetitionRegistration   status, dates
 (Competition)         (Competition)           (Competition)
     │                    │                    │
     └──── read by Notifications for eligibility ───┘
```

Every arrow crossing into Notifications is a **read**. Notifications writes only its own three
things.

---

## The three competition relationships

These are the only relationships recipient rules may use
([ND-I-16](../../../project/feature-specification/notification/decisions/intents.md#nd-i-16--recipient-rules-use-only-relationships-kizunia-knows)).

| Relationship | Source | Nature | Used for |
| --- | --- | --- | --- |
| **Relevant to the user** | Computed from the preference profile | Derived, not stored user action | `TOP` candidacy; `CLOSING` eligibility |
| **Bookmarked** | `CompetitionBookmark` | Explicit user action | `CLOSING` eligibility |
| **Marked as Registered** | `CompetitionRegistration` | Self-declared, **unverified** | `CLOSING` exclusion |

### Relevance is the odd one out

Bookmark and registration are stored rows; relevance is computed. It behaves like a relationship in
the eligibility rules but has no table behind it.

This is the source of open item A-4 — whether `REGISTRATION_CLOSING` recomputes relevance at
evaluation time or reads it from somewhere
([`candidate-selection.md`](../../notifications/recommendation/candidate-selection.md)).

It is also a boundary risk: relevance must **not** become a field on a competition, and must not
leak into the browsing experience. A notification preference never changes what search returns
([`filters-vs-preferences.md`](../../../project/feature-specification/notification/preferences/filters-vs-preferences.md)).

### Marked as Registered is not registration data

Kizunia is a discovery platform, not the organizer, and has no channel to confirm any of it.

The existing model already encodes this posture deliberately: `CompetitionRegistration` carries no
`source`, no `verifiedAt` and no status enum, because each would imply a verification pipeline that
does not exist and is not planned.

Consequences for this domain, both permanent:

- there is **no** "participants" or "registered users" recipient group, and none may be inferred;
- nothing may present a self-declared mark as organizer-confirmed.

Also relevant: a registration row is never removed by lifecycle. It survives every status including
`COMPLETED` and `CANCELLED` — *"I registered for that"* stays true after the event ends.

---

## Competition data that is read, not owned

| Read | Used for |
| --- | --- |
| `status` (`CompetitionStatus`) | Registration-open candidacy |
| `registrationDeadline` | Deadline window; the exact T-24h target |
| `registrationStartDate` | When a competition becomes actionable |
| `startDate`, `endDate` | Lifecycle context |
| Categories, technologies, eligibility, mode, fee | Preference matching |
| Location | Geographic matching |

`status` is **derived** by the competition domain from lifecycle dates, by a pure function plus a
nightly sweep
([`lifecycle-automation.md`](../../workflows/competition/lifecycle-automation.md)). Notifications
reads it and never derives or writes it.

One subtlety carried forward: because `status` is materialized by a sweep, it can lag the
timestamps near a boundary. An intent that cares about the exact instant — `REGISTRATION_CLOSING`
does — should reason from the dates, not only the enum.

---

## Relationship to Search

Both Search and Notifications consume competition attributes, and both have a concept of
preferences. The [Search specification](../../../project/feature-specification/search/README.md)
already separates Search, Filters, Saved Search, Preferences and Recommendations as five concepts
that must not collapse into one.

Notifications owns Preferences and Recommendations for the notification use case; Search owns
retrieval. Where both must answer the same question — most obviously *what does "in Pune" mean* —
they agree rather than each growing a private answer
([`location-matching.md`](../../../project/feature-specification/notification/relevance/location-matching.md)).

---

## The direction rule

Other domains do **not** call into Notifications to send a notification. Notifications decides for
itself, on its own triggers, what should exist.

The one anticipated exception is an admin-designated update, where an explicit human decision is
the trigger — and even then it enters through the trigger layer, with the rules still belonging to
the intent
([`event-and-admin-triggers.md`](../../notifications/triggers/event-and-admin-triggers.md)).

---

## What must never happen

| Never | Instead |
| --- | --- |
| A notification field or flag on a competition model | Notification state lives in notification records |
| A notification method on a competition service | Notifications reads through a defined boundary |
| Notifications writing bookmarks or registrations | Read only |
| Notifications deriving competition status | Read it |
| A recipient group backed by assumed external data | Only the three relationships above |
