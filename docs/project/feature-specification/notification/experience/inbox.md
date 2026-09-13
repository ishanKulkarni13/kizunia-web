# Notification Inbox

> **Status:** Stable — Phase 1
>
> **Last Updated:** 2026-09-12
>
> **Stories:** US-01 to US-04

The inbox is the in-app surface where a user's notifications live. It is the reason notification
history is retained at all
([`history/README.md`](../history/README.md)).

---

## What the inbox provides

| Capability | Story | Behavior |
| --- | --- | --- |
| **Receive notifications** | US-01 | The user receives notifications relevant to them, so they do not miss opportunities on Kizunia |
| **View notifications in one place** | US-02 | Past and current notifications are listed together |
| **Distinguish unread** | US-03 | Unread notifications are visually distinct from ones already seen, so the user can identify what needs attention |
| **Open the related resource** | US-04 | Each notification links to its subject — the competition — so the user can act directly |

---

## Unread and responded

Phase 1 has one interaction concept: clicking or opening a notification marks it **responded**
([`history/user-response.md`](../history/user-response.md)).

The inbox's unread indicator is a presentation of that same interaction. Phase 1 does not define a
separate "read" state that could diverge from `responded` — for example, a notification marked read
by being scrolled past without being opened.

Whether the two should ever diverge is an open question, recorded in
[`open-decisions.md`](../open-decisions.md). Until it is answered, the inbox should not invent a
second state.

---

## What the inbox shows for an aggregated notification

`REGISTRATION_CLOSING` produces one summary notification covering several competitions
([`intents/registration-closing.md`](../intents/registration-closing.md)). The inbox shows it as a
single entry:

> **Registration closing soon**
>
> 4 competitions relevant to you have registration deadlines approaching.

Opening it leads to the covered competitions. Exact presentation is a UX decision; the binding
product rules are that the user sees **one** notification, and that history accurately records
which competitions it covered.

---

## What is not in Phase 1

| Capability | Status |
| --- | --- |
| Archiving or deleting notifications | Not specified |
| Muting or snoozing a notification | Future — see [`future/README.md`](../future/README.md) |
| Filtering the inbox by intent or category | Not specified |
| Notification expiry or retention limits | Open — see [`open-decisions.md`](../open-decisions.md) |
| Grouping across intents | Not specified |
| Any channel other than in-app | Future — see [`future/channels.md`](../future/channels.md) |

These are absent because no decision was made about them, not because they were rejected. Adding
any of them requires a ruling in [`decisions/`](../decisions/README.md) first.

---

## Client independence

The inbox is the Phase 1 surface, delivered through the Kizunia web application. The notification
model itself is **not** tied to it: the same notifications must be presentable through a future
Expo/mobile client or another channel without changing how they are generated
([ND-I-18](../decisions/intents.md#nd-i-18--the-notification-model-is-client-agnostic)).

See
[`clients-and-channels.md`](../../../../architecture/notifications/delivery/clients-and-channels.md).
