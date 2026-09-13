# Intents — Architecture

> **Status:** Design
>
> **Last Updated:** 2026-09-12

Notification intent is the subsystem's **extensibility boundary**. Adding a notification type
should primarily mean adding new behavior, not modifying a central service.

This area covers the implementation side. The product behavior of each intent — what it does and
why — lives in
[`feature-specification/notification/intents/`](../../../project/feature-specification/notification/intents/README.md)
and is not repeated here.

| Document | Contents |
| --- | --- |
| [intent-contract.md](intent-contract.md) | What every intent implementation provides |
| [adding-an-intent.md](adding-an-intent.md) | The checklist, and the anti-patterns to avoid |

---

## The rule

`TOP_RELEVANT_COMPETITION` and `REGISTRATION_CLOSING` are only the first notification types. The
system should eventually support competition lifecycle events, competition updates, admin-triggered
notifications, portfolio and platform notifications, and types nobody has designed yet.

Adding one should mean **adding the new behavior**.

Explicitly rejected as the fundamental extensibility mechanism:

```text
if type === TOP ... else if type === REGISTRATION ... else if type === ...
```

A service that accumulates top recommendations, registration deadlines, registration events,
cancellations, competition updates and future notifications becomes difficult to reason about and
impossible to change safely. See [`../principles.md`](../principles.md).

---

## Why intent, specifically

Intent is the right seam because it is already the unit of meaning everywhere else in the
subsystem:

- **deduplication** is keyed on `(user, competition, intent)`
  ([ND-H-06](../../../project/feature-specification/notification/decisions/history.md#nd-h-06--deduplication-is-keyed-on-user--competition--intent));
- **preferences** are per-intent
  ([ND-P-12](../../../project/feature-specification/notification/decisions/preferences.md#nd-p-12--notification-preferences-are-per-intent-and-separate));
- **independence** is guaranteed per-intent
  ([ND-H-07](../../../project/feature-specification/notification/decisions/history.md#nd-h-07--different-intents-are-independent));
- **triggers** differ per intent
  ([`../triggers/README.md`](../triggers/README.md)).

A boundary that already carries the product's meaning is a better seam than one invented for the
code.
