# Notifications Domain — Overview

> **Status:** Design
>
> **Last Updated:** 2026-09-12

---

## The domain in one page

Notifications decides whether Kizunia should tell a user something, records that it did, and
tracks what became of it.

Three things exist in this domain:

```text
Notification Intent          a named business purpose that can produce a notification
Notification Record          the fact that a notification happened
Preferences                  what the user cares about, and what they want to hear about
```

Everything else the domain reasons about — competitions, bookmarks, self-declared registrations,
users — belongs to other domains and is **read**, never owned.

---

## The shape

```text
User
 │
 ├── Competition Preference Profile        what competitions matter to me
 │
 ├── Notification Preferences              what notifications I want
 │
 └── Notification Records                  what I was actually told, and when
          │
          ├── Intent                       why I was told
          └── Subject                      what I was told about  ──▶ Competition (read)
```

---

## Why intent is a first-class concept

Intent is not a label on a notification; it is the unit the whole domain is keyed on:

- **deduplication** is `(user, subject, intent)`, never `(user, subject)`;
- **preferences** are per intent;
- **independence** is guaranteed per intent — one intent's notification never suppresses another's;
- **triggers** differ per intent.

Two notifications about the same competition for different reasons are two legitimate,
unrelated facts. A domain model that keyed on the competition alone could not express that.

---

## Why a record is an occurrence

A notification record says *at this moment, for this reason, Kizunia told this user about this
thing.* It is not a status on a competition and not a flag on a relationship.

Consequences that follow directly from that framing:

- history is **append-only** — a later notification is a new record, never an update;
- the inbox is a read of the same log that deduplication reads;
- a notification that was never delivered is still a recorded fact, and is visibly distinct from
  one that was.

---

## What the domain deliberately does not know

**Whether a user actually registered for an external competition.** Kizunia is a discovery
platform, not the organizer, and has no channel to confirm it. It knows only what a user
explicitly told it, and that must never be presented as verified.

This is not a temporary gap — it is a permanent constraint on what recipient rules may express, and
it is already enforced in the data model, which deliberately carries no `source`, no `verifiedAt`
and no status enum on self-declared registrations. See [relationships.md](relationships.md).

---

## What the domain deliberately does not own

| Not owned | Owner |
| --- | --- |
| Competitions, their data and lifecycle status | Competition domain |
| Bookmarks and self-declared registrations | Competition domain |
| Search, filtering, sorting | [Search subsystem](../../../project/feature-specification/search/README.md) |
| Identity and authorization | Users, [Authorization](../../authorization/README.md) |
| Subscriptions and billing | Does not exist |

---

## Where to go next

- Entity contracts: [entities.md](entities.md)
- Boundaries: [relationships.md](relationships.md)
- Product behavior:
  [`feature-specification/notification/`](../../../project/feature-specification/notification/README.md)
- Architecture: [`architecture/notifications/`](../../notifications/README.md)
