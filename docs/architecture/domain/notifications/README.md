# Notifications Domain

> **Status:** Implemented — see [architecture/notifications/IMPLEMENTATION-STATUS.md](../../notifications/IMPLEMENTATION-STATUS.md)
>
> **Last Updated:** 2026-09-12

The conceptual domain model for Notifications: what exists in this domain, and where its edges are.

| Document | Contents |
| --- | --- |
| [overview.md](overview.md) | The domain in one page |
| [entities.md](entities.md) | Conceptual entities and their contracts |
| [relationships.md](relationships.md) | Boundaries with Competition, User, Bookmark and Registration |

---

## Scope of these documents

A domain model answers *what information exists and how it relates*. It does not answer:

| Question | Where |
| --- | --- |
| What does the system do, and why? | [`feature-specification/notification/`](../../../project/feature-specification/notification/README.md) |
| How is it built to keep changing? | [`architecture/notifications/`](../../notifications/README.md) |
| How is it stored? | [`architecture/notifications/persistence/`](../../notifications/persistence/README.md) |

This mirrors the split already used for [`assets/`](../assets/overview.md).

---

## Status

The domain is **conceptual**. Several storage-shaping decisions are still open — the aggregated
notification shape, the legacy preference model, and whether relevance is persisted — so these
documents describe the entities and their contracts rather than a schema. See
[`open-decisions.md`](../../../project/feature-specification/notification/open-decisions.md).
