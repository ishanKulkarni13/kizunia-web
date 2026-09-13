# Future Direction

> **Status:** Direction only — nothing in this area is implemented
>
> **Last Updated:** 2026-09-12

Everything in this area is **unbuilt**. It is recorded so that the architecture can leave room for
it, and so that ideas raised during design are not lost — not because any of it is committed.

**Nothing here may be presented as current behavior, appear in the user interface, or be
implemented because "the architecture supports it."** See
[`phase-1/boundaries.md`](../phase-1/boundaries.md).

---

## Documents

| Document | Contents |
| --- | --- |
| [notification-intents.md](notification-intents.md) | Intents we expect to want, and their known design positions |
| [personalization.md](personalization.md) | ML relevance, experiments, behavioral signal, richer preferences |
| [entitlements.md](entitlements.md) | Paid plans, feature flags, subscription notifications |
| [channels.md](channels.md) | Email, push, browser, Expo/mobile |

---

## Other future capabilities

Raised during design, not yet assigned a home because they need a decision before they need a
document.

| Capability | Note |
| --- | --- |
| **Cross-intent volume limits** | A cap on total notification activity (US-26). The meaning is undefined — per batch, per day, or another period. This is a *limit*, distinct from deduplication ([`history/deduplication.md`](../history/deduplication.md)) |
| **Separate deadline preference toggles** | Splitting relevant-deadline and bookmark-deadline into independent controls. Does not require restructuring the intent — see [R-03](../decisions/reconciliations.md#r-03--deadline-notification-preferences) |
| **Pre-delivery validation filter** | Re-checking competition state immediately before delivery, so a cancelled competition's notification is suppressed. The canonical example of a future pipeline filter ([ND-I-17](../decisions/intents.md#nd-i-17--competition-state-is-not-re-validated-before-delivery-in-phase-1)) |
| **Retry and re-delivery strategy** | Phase 1 re-evaluates rather than retries. A genuine retry mechanism is a delivery-layer concern ([`history/re-evaluation.md`](../history/re-evaluation.md)) |
| **Quiet hours, snoozing, digests, smart scheduling** | Timing controls. None specified |
| **Notification expiry and retention** | How long history is kept, and whether notifications age out of the inbox |
| **Archiving, deleting, filtering the inbox** | Inbox management beyond read/unread |
| **Notification content and template system** | How notification copy is authored and localized |
| **Priority levels** | Appeared in the superseded specification; no ruling exists ([R-06](../decisions/reconciliations.md#r-06--the-previous-notifications-feature-specification-is-superseded)) |
| **Team and project notifications** | Appeared in the superseded specification; never designed |

---

## The rule for this area

An item graduates out of `future/` by acquiring:

1. a **specification** in the owning product area, and
2. a **ruling** in [`decisions/`](../decisions/README.md).

Until both exist, it stays here. Moving something out means deleting it from this area, not
duplicating it.
