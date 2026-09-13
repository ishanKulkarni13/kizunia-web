# Phase 1 Boundaries

> **Status:** Stable
>
> **Last Updated:** 2026-09-12
>
> **Ruling:** [ND-I-01](../decisions/intents.md#nd-i-01--phase-1-implements-exactly-two-intents)

---

## Included in Phase 1

| Capability | Specification |
| --- | --- |
| `TOP_RELEVANT_COMPETITION` | [`intents/top-relevant-competition.md`](../intents/top-relevant-competition.md) |
| `REGISTRATION_CLOSING` | [`intents/registration-closing.md`](../intents/registration-closing.md) |
| Competition preference profile | [`preferences/competition-preference-profile.md`](../preferences/competition-preference-profile.md) |
| Per-intent notification preferences | [`preferences/notification-preferences.md`](../preferences/notification-preferences.md) |
| Relevance, filtering, threshold, selection | [`relevance/README.md`](../relevance/README.md) |
| Notification records and history | [`history/README.md`](../history/README.md) |
| Notification inbox, in-app, web | [`experience/inbox.md`](../experience/inbox.md) |
| Binary response tracking | [`history/user-response.md`](../history/user-response.md) |

---

## Not implemented in Phase 1

Wanted, not designed, not built. Each is recorded in [`future/`](../future/README.md).

### Notification intents

- `REGISTRATION_OPENED`
- `REGISTRATION_CLOSED`
- `COMPETITION_CANCELLED`
- Admin-designated competition updates, with admin-chosen recipients
- A multi-competition relevant-competition digest, with a configurable volume
- Portfolio contact notifications
- Platform feature and promotional notifications
- Subscription notifications

### Capabilities

- Additional delivery channels — email, push, browser
- Expo/mobile client
- Paid-plan entitlements and feature flags
- Extended analytics and tracking vocabulary
- ML-based or experiment-varied relevance
- Cross-intent notification volume limits
- Quiet hours, snoozing, digests, smart scheduling
- A pre-delivery competition-state validation filter
- A defined retry or re-delivery strategy
- Notification expiry or retention policy

---

## Explicit non-goals

These are **decisions**, not deferrals. They should not reappear as roadmap items without a new
product decision.

| Non-goal | Why |
| --- | --- |
| `COMPETITION_STARTED` notification (US-18) | Explicitly declined during design |
| `COMPETITION_COMPLETED` notification | Intentionally excluded |
| "Mark as participated" (US-21) | Only "mark as registered" will exist |
| A "participants" or "registered users" recipient group | Kizunia has no verified external registration data, and must not imply it has ([ND-I-16](../decisions/intents.md#nd-i-16--recipient-rules-use-only-relationships-kizunia-knows)) |
| Messaging or real-time chat | Not a Kizunia feature ([`overview/scope.md`](../overview/scope.md)) |

See [R-05](../decisions/reconciliations.md#r-05--explicit-non-goals-not-deferrals).

---

## The obligation the boundary creates

Limiting Phase 1 behavior does **not** license a narrow implementation.

The architecture must support future notification intents without requiring the Phase 1 foundation
to be redesigned. Specifically, adding any item from the "not implemented" list above should mean
*adding new behavior*, not restructuring what already exists.

The converse obligation is equally binding:

> Do not implement future functionality simply because the architecture supports it.

An intent that is not in the "included" table above must not appear in the code, in the database
enum, or in the user interface — even as a placeholder — until it has its own specification and its
own ruling.

See [`architecture/notifications/principles.md`](../../../../architecture/notifications/principles.md).
