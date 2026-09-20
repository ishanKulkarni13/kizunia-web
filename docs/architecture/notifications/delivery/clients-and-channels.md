# Clients and Channels

> **Status:** Implemented — web client, in-app and web push
>
> **Last Updated:** 2026-09-18
>
> **Ruling:** [ND-I-18](../../../project/feature-specification/notification/decisions/intents.md#nd-i-18--the-notification-model-is-client-agnostic)

Kizunia's notification system is built around its web application. The model itself must not be
conceptually tied to it.

> **Web first, with future mobile/Expo support.**

---

## Client vs channel

Worth separating before either is built, because they are not the same axis:

| | Meaning | Examples |
| --- | --- | --- |
| **Client** | The application a user reads notifications in | Web app, future Expo/mobile app |
| **Channel** | The mechanism by which a notification reaches a user | In-app inbox, email, push, browser notification |

One client may support several channels; one channel may serve several clients. Today there is one
client — the web app — and two channels: the in-app inbox, and browser push.

---

## Status

| | Status |
| --- | --- |
| Web client, in-app inbox | **Built** |
| Browser push, through FCM | **Built** |
| Expo / mobile client | Future — explicitly anticipated |
| Email | Future — no ruling |
| WhatsApp, SMS | Future — no ruling |

Two of the three questions this section used to list as undecided now have answers, because
building a second channel forced them:

- **one notification can go to several channels**, and to several destinations within one channel —
  a delivery row per (notification, channel, destination), each with independent state
  ([ND-D-11](../../../project/feature-specification/notification/decisions/delivery.md#nd-d-11--a-notification-may-have-several-deliveries-the-user-still-has-one-notification));
- **channel failure does not interact with the notification at all.** A push that fails retries the
  push; the inbox record is never touched
  ([ND-D-01](../../../project/feature-specification/notification/decisions/delivery.md#nd-d-01--generation-and-delivery-are-separate-failure-domains)).

Still open: whether channels become configurable per intent. Today a user chooses *what* they hear
about, not *how* — and with two channels, one of which is the inbox everything lands in regardless,
there is not yet a meaningful choice to offer.

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

The first question it raised — **what does generation store, and what does the client render?** —
has been answered, and not by dodging it.

---

## What was actually done about content

The trade-off was taken deliberately rather than avoided, because push forced it: **a push has to
carry its own words.** There is no client to render it, so a notification whose text only exists
once someone opens the inbox cannot be pushed at all.

History is the second reason. A competition renamed next week must not change what the user was
told today
([ND-H-02](../../../project/feature-specification/notification/decisions/history.md#nd-h-02--history-is-retained-and-never-overwritten)),
which a render-at-read-time design cannot promise.

So content is rendered at generation, and the warning above is answered by storing **both**
representations:

| Stored | For |
| --- | --- |
| `title`, `body` | The push, and the web inbox |
| `actionPath` | The web client. Site-relative only, enforced by a `CHECK` constraint as well as by validation |
| `payload` + typed target rows | *What happened*, structurally — what a future client re-renders from |

That is two representations of one fact, which is a real cost. It is the price of being able to
push at all, and it is paid explicitly rather than discovered later.

---

## What to keep avoiding

| Avoid | Because |
| --- | --- |
| Storing an **absolute** URL as a notification's action | A mobile client needs a different route to the same resource. Site-relative is the compromise, and the `CHECK` constraint is what enforces it |
| Dropping the structured payload once the rendered strings exist | The strings are the web client's view. The payload is what makes a second client possible at all |
| Delivery code that assumes a session or a browser | Push has neither, and email will have neither |
| A per-channel branch in the pipeline | Channels belong behind the delivery boundary. Adding one must not touch generation |

The first two are the ones that would quietly undo this. A record can look portable, fail to be,
and have nothing in the type system notice.
