# Notifications

> **Status:** Superseded — 2026-09-12
>
> **Superseded by:** [`notification/`](notification/README.md)

---

The Notifications specification has moved. It is now a modular documentation set rather than a
single document, because Notifications is a substantial subsystem rather than a small feature.

**Start here:** [`notification/README.md`](notification/README.md)

| Looking for | Go to |
| --- | --- |
| Why Notifications exists, and its terminology | [`notification/overview/`](notification/overview/README.md) |
| Finalized behavioral decisions | [`notification/decisions/`](notification/decisions/README.md) |
| Preferences and relevance | [`notification/preferences/`](notification/preferences/README.md), [`notification/relevance/`](notification/relevance/README.md) |
| The notification types themselves | [`notification/intents/`](notification/intents/README.md) |
| Notification history and the inbox | [`notification/history/`](notification/history/README.md), [`notification/experience/`](notification/experience/README.md) |
| What is and is not in Phase 1 | [`notification/phase-1/`](notification/phase-1/README.md) |
| Future direction | [`notification/future/`](notification/future/README.md) |
| What is still undecided | [`notification/open-decisions.md`](notification/open-decisions.md) |
| Technical architecture | [`architecture/notifications/`](../../architecture/notifications/README.md) |
| Domain model | [`architecture/domain/notifications/`](../../architecture/domain/notifications/README.md) |

---

## What happened to the previous content

This document previously described a different subsystem, written before the notification design
decisions were finalized. Its content is **not** carried forward as current behavior.

| Previous element | Disposition |
| --- | --- |
| Hackathon terminology | Superseded by **Competition** |
| Team and project notification categories | Never designed; no ruling exists. Not carried forward |
| Priority levels (Critical / High / Normal / Low) | No ruling exists. Not carried forward |
| Email, push and browser channels | [`notification/future/channels.md`](notification/future/channels.md) |
| Digests, smart scheduling, quiet hours, calendar integration | [`notification/future/`](notification/future/README.md) |
| Technology-based matching (documented as not implemented) | Still not implemented. See [`technology.md`](../../architecture/domain/technology.md) |

The reasoning is recorded in
[`notification/decisions/reconciliations.md`](notification/decisions/reconciliations.md#r-06--the-previous-notifications-feature-specification-is-superseded).

The filename is retained so existing links continue to resolve.
