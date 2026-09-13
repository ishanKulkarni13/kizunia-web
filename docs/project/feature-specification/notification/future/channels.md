# Future Channels and Clients

> **Status:** Direction only — none of this is implemented
>
> **Last Updated:** 2026-09-12
>
> **Ruling:** [ND-I-18](../decisions/intents.md#nd-i-18--the-notification-model-is-client-agnostic)

Phase 1 delivers notifications **in-app, on the web**, and nowhere else.

---

## The current scope

> **Web first, with future mobile/Expo support.**

Phase 1 is designed around the Kizunia web application, but the notification system must not be
conceptually tied to the web client. The notification model and notification-generation logic
remain independent of the client through which a notification is eventually delivered.

---

## Expected clients and channels

| Channel | Status | Note |
| --- | --- | --- |
| **In-app, web** | Phase 1 | [`experience/inbox.md`](../experience/inbox.md) |
| **Expo / mobile** | Future | Explicitly anticipated; the reason client independence is a Phase 1 constraint rather than a later refactor |
| **Email** | Future | Appeared in the superseded specification; no ruling exists |
| **Push** | Future | Requires a mobile or browser client first |
| **Browser notifications** | Future | No ruling exists |

Nothing above Phase 1 has defined behavior. In particular, no decision exists about whether
channels are independently configurable per intent, whether a notification can go to more than one
channel, or how channel failure interacts with delivery state.

---

## What makes this possible

Two Phase 1 properties do the work, and both must be preserved:

**Generation is separate from delivery.** A notification is generated first and delivered
afterwards. Deciding *whether a notification should exist* is not the same question as *how it
reaches the user*
([`generation-vs-delivery.md`](../../../../architecture/notifications/delivery/generation-vs-delivery.md)).

**A queue sits between them.** Conceptually:

```text
Notification decision -> Notification generation -> Queue -> Delivery
```

This separation is the foundation for asynchronous delivery, retries, additional channels, delivery
status tracking and future notification clients
([`queue.md`](../../../../architecture/notifications/delivery/queue.md)).

The exact queueing and delivery infrastructure remains intentionally open — and the repository
currently has **no** queue infrastructure at all, which is recorded as an open decision in
[`open-decisions.md`](../open-decisions.md).

---

## The trap to avoid

Client coupling is invisible until a second client exists, and expensive afterwards. The specific
failure to watch for is notification *content* or *linking* that assumes a web URL, a web session,
or a web-rendered component — decided at generation time rather than at delivery time.

A notification generated in Phase 1 should be presentable by a client that did not exist when it
was generated.
