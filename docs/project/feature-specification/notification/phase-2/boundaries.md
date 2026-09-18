# Phase 2 Boundaries

> **Status:** Live
>
> **Last Updated:** 2026-09-17

Phase 1's boundary rule still governs, with its scope updated rather than its principle:

> Do not implement future functionality simply because the architecture supports it.

The architecture built in Phase 2 supports a great deal more than Phase 2 implements. That is the
point of it, and it is not a licence.

---

## Not implemented

### Intents

- `REGISTRATION_OPENED`, `REGISTRATION_CLOSED`, `COMPETITION_CANCELLED`
- Competition updates with admin-chosen recipients
- A multi-competition discovery digest with a configurable volume
- Portfolio contact notifications
- Promotional and subscription notifications
- Account and security notifications

Each would be a policy file, a renderer, an enum value and a default. None requires a structural
change — which is the property being preserved, not a reason to add them.

### Channels

- Email, WhatsApp, SMS
- Mobile push through a native or Expo client

The channel abstraction exists and is exercised by two channels. A third is an adapter plus an
enum value.

### Capabilities

- Audience segmentation or targeting rules for announcements
- Per-channel notification preferences
- A content template or localization system
- Quiet hours, snoozing, digests, smart or per-user timing
- Paid-plan entitlements and feature flags
- Extended analytics and tracking vocabulary
- ML-based or experiment-varied relevance
- Cross-intent notification volume limits
- A pre-delivery competition-state validation filter
  ([ND-I-17](../decisions/intents.md#nd-i-17--competition-state-is-not-re-validated-before-delivery-in-phase-1)
  still stands)
- A retention policy for anything that participates in deduplication (see A-11)
- Archiving, deleting, or filtering the inbox

### Infrastructure

- **Kafka.** The dispatch boundary exists so Kafka can replace the Postgres queue later. Nothing in
  the notification domain knows how work is stored or claimed. That is the whole preparation, and
  it is deliberately all of it.
- Redis, RabbitMQ, or any other broker
- An always-running worker process

---

## Explicit non-goals

Unchanged from Phase 1, and still decisions rather than deferrals:

| Non-goal | Why |
| --- | --- |
| `COMPETITION_STARTED` / `COMPETITION_COMPLETED` notifications | Declined during design |
| "Mark as participated" | Only "mark as registered" will exist |
| A "participants" or "registered users" recipient group | Kizunia has no verified external registration data ([ND-I-16](../decisions/intents.md#nd-i-16--recipient-rules-use-only-relationships-kizunia-knows)) |
| Messaging or real-time chat | Not a Kizunia feature |
| A marketing campaign or audience-segmentation platform | [ND-I-21](../decisions/intents.md#nd-i-21--feature_announcement-is-an-admin-authored-scheduled-broadcast) keeps announcements a flat broadcast on purpose |
| Exactly-once delivery | Not achievable across a provider boundary; claiming it would be a lie in the type system ([ND-D-05](../decisions/delivery.md#nd-d-05--at-least-once-never-exactly-once)) |

---

## The obligation this boundary creates

Adding anything on the "not implemented" list should mean **adding behavior**, not restructuring
what exists. Specifically:

| Adding | Should require |
| --- | --- |
| An intent | A policy file, a renderer, an enum value, a default, a handler branch |
| A channel | A provider adapter and an enum value |
| A push provider | One adapter implementing the existing port |
| A broker | One implementation of the existing work-queue port |
| A trigger | A caller of the existing scheduler service |

If any of those turns out to require changing notification persistence, the pipeline, or an
unrelated intent, the boundary has been violated somewhere and the design needs revisiting — not
the requirement.
