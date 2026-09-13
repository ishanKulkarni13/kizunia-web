# Clients and Channels

> **Status:** Design
>
> **Last Updated:** 2026-09-12
>
> **Ruling:** [ND-I-18](../../../project/feature-specification/notification/decisions/intents.md#nd-i-18--the-notification-model-is-client-agnostic)

Phase 1 is designed around the Kizunia web application. The notification system must not be
conceptually tied to it.

> **Web first, with future mobile/Expo support.**

---

## Client vs channel

Worth separating before either is built, because they are not the same axis:

| | Meaning | Examples |
| --- | --- | --- |
| **Client** | The application a user reads notifications in | Web app, future Expo/mobile app |
| **Channel** | The mechanism by which a notification reaches a user | In-app inbox, email, push, browser notification |

One client may support several channels; one channel may serve several clients. Phase 1 has one of
each: the web client, and the in-app inbox.

---

## Status

| | Status |
| --- | --- |
| Web client, in-app inbox | Phase 1 |
| Expo / mobile client | Future — explicitly anticipated |
| Email | Future — no ruling |
| Push | Future — requires a mobile or browser client |
| Browser notifications | Future — no ruling |

Nothing beyond Phase 1 has defined behavior. In particular, no decision exists about whether
channels are configurable per intent, whether one notification can go to several channels, or how
channel failure interacts with delivery state.

See
[`future/channels.md`](../../../project/feature-specification/notification/future/channels.md).

---

## What keeps this possible

The generation/delivery split
([generation-vs-delivery.md](generation-vs-delivery.md)) and the queue seam
([queue.md](queue.md)). A notification is decided and recorded without reference to how it travels.

A channel is then an adapter behind that boundary: it takes a generated notification and delivers
it. Adding one must not touch generation, the pipeline, or any intent
([`../pipeline/extension-points.md`](../pipeline/extension-points.md)).

---

## The coupling that actually happens

Not interfaces — **content**.

The realistic way this subsystem becomes web-coupled is a notification whose title, body or link is
baked at generation time in a form only the web client can render: a site-relative URL, a
pre-rendered string, an assumed layout.

The record looks portable. It is not. And nothing in the type system notices.

Phase 1 has no notification content or template system — it is an open decision
([`open-decisions.md`](../../../project/feature-specification/notification/open-decisions.md)).
When it is designed, the first question is **what does generation store, and what does the client
render?** A record that stores *what happened* and lets each client render it stays portable; one
that stores *what to display* does not.

---

## The legacy channel toggles

The existing `NotificationPreference` model already carries `emailNotifications` and
`pushNotifications` fields
([`../persistence/preference-storage.md`](../persistence/preference-storage.md)).

Neither channel exists. Those toggles must not be surfaced as though they work — a preference that
controls nothing is a promise the product does not keep. Their disposition is part of blocking open
item A-2.

---

## What Phase 1 should avoid, concretely

| Avoid | Because |
| --- | --- |
| Notification content rendered at generation time | Locks the notification to one client's presentation |
| Absolute or site-relative URLs stored on the record | A mobile client needs a different route to the same resource |
| Delivery code that assumes a session or a browser | Push and email have neither |
| A per-channel branch in the pipeline | Channels belong behind the delivery boundary |

None of these cost anything to avoid now. All of them are expensive to undo once a second client
exists.
