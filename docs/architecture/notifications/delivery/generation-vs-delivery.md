# Generation vs Delivery

> **Status:** Design
>
> **Last Updated:** 2026-09-12

The system distinguishes two questions:

> **Should a notification exist?**

from:

> **How is that notification delivered?**

Notification generation and notification delivery are separate stages. A notification may be
generated first and delivered asynchronously afterwards.

---

## Where the line is

**Generation** is the last stage of the decision pipeline. It creates the notification record — the
occurrence, with its subject, intent, creation time and initial states
([`../persistence/notification-storage.md`](../persistence/notification-storage.md)).

Everything **before** generation decides whether a notification should exist: eligibility,
candidate selection, filtering, preference matching, relevance, threshold, ranking, selection,
aggregation.

Everything **after** generation is about getting it to the user.

```text
[  decide whether it should exist  ]  [  get it to the user  ]
                                   ▲
                              generation
```

Crossing that line in either direction is the failure mode this document exists to prevent.

---

## Why it matters

**Client independence.** Kizunia is web-first and expects Expo/mobile later. A notification
generated today should be presentable by a client that did not exist when it was generated
([ND-I-18](../../../project/feature-specification/notification/decisions/intents.md#nd-i-18--the-notification-model-is-client-agnostic)).

**Channel addition.** Adding a channel becomes an adapter behind the boundary rather than a change
to the pipeline
([clients-and-channels.md](clients-and-channels.md)).

**Asynchrony and retries.** A generated notification can be delivered later, or retried, without
re-deriving the decision.

**Testability.** The decision logic can be tested without delivering anything, and delivery can be
tested without running an evaluation
([`../testing/test-surface.md`](../testing/test-surface.md)).

---

## The specific trap

The failure that actually happens in practice is not architectural — it is **content**.

A notification whose title, body or link is baked at generation time in a web-specific form couples
the whole subsystem to the web client without touching a single interface. The notification record
looks portable and is not.

Phase 1 has no notification content or template system; it is an open decision
([`open-decisions.md`](../../../project/feature-specification/notification/open-decisions.md)).
When it is designed, the question to answer first is *what does generation store, and what does the
client render?* — because the answer determines whether a second client is cheap or a rewrite.

---

## The one thing that crosses the line

The preference re-check. If a notification has been generated but the user disables that intent
before delivery, it is not sent
([ND-P-14](../../../project/feature-specification/notification/decisions/preferences.md#nd-p-14--disabling-an-intent-suppresses-already-generated-notifications)).

This is deliberately narrow: a check on the user's **current preference**, not a re-derivation of
the decision. It is left as `delivered = false`, with no separate suppression state.

The broader version — re-validating competition state before delivery — is explicitly **not** Phase
1, and when it arrives it arrives as a filter, not as logic inside the delivery layer
([`../pipeline/extension-points.md`](../pipeline/extension-points.md)).

---

## Consequences for delivery state

Because the two stages are separate, `delivered` is a real state that can be false indefinitely.

The subsystem treats that as ordinary rather than exceptional: an undelivered notification does not
consume its `(user, competition, intent)` triple, and a later evaluation may generate a new record
for the same competition
([ND-H-03](../../../project/feature-specification/notification/decisions/history.md#nd-h-03--delivered-consumes-the-triple-undelivered-does-not)).

That is **re-evaluation, not retry** — a new decision from current data, not another attempt at an
old one
([`history/re-evaluation.md`](../../../project/feature-specification/notification/history/re-evaluation.md)).
A genuine retry mechanism would belong to the delivery layer and does not exist in Phase 1.
