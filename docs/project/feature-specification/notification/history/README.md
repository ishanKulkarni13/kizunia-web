# Notification History

> **Status:** Stable
>
> **Last Updated:** 2026-09-12

Notification history does two jobs at once, and both matter:

1. **It is the user's inbox.** Past notifications remain meaningful — a user revisits an
   opportunity they scrolled past last week.
2. **It constrains the future.** What has already been delivered determines what may be sent next.

Because history serves both, it is modelled as an append-only log of **occurrences**, not as a
status flag on a competition.

---

## Documents

| Document | Contents |
| --- | --- |
| [notification-record.md](notification-record.md) | What a record is and what it contains |
| [deduplication.md](deduplication.md) | What suppresses a future notification, and what does not |
| [re-evaluation.md](re-evaluation.md) | Why a later notification is a new record rather than a retry |
| [user-response.md](user-response.md) | What "responded" means in Phase 1 |

---

## The four rules

**Records are occurrences.** A record says *a notification happened*, with a time. It is not a flag
meaning *this competition has been notified about*
([ND-H-01](../decisions/history.md#nd-h-01--a-notification-record-is-an-occurrence)).

**History is never overwritten.** A later notification creates a **new** record. The previous one
stays exactly as it was
([ND-H-02](../decisions/history.md#nd-h-02--history-is-retained-and-never-overwritten)).

**Delivery is what suppresses.** `delivered = true` consumes the
`(user, competition, intent)` triple. `delivered = false` does not
([ND-H-03](../decisions/history.md#nd-h-03--delivered-consumes-the-triple-undelivered-does-not)).

**Intent is the key.** Deduplication is scoped to the intent, never to the competition alone
([ND-H-06](../decisions/history.md#nd-h-06--deduplication-is-keyed-on-user--competition--intent)).

---

## What history does not do

History does not affect **relevance**. A competition already notified about may still be highly
relevant and still appears in rankings; it is excluded at the candidate-filtering layer for that
one intent, not scored down
([ND-H-09](../decisions/history.md#nd-h-09--previously-notified-competitions-may-still-rank)).

History is also not re-interpreted against past preferences. Each evaluation uses the user's
current profile, and old records are left alone
([ND-H-05](../decisions/history.md#nd-h-05--each-evaluation-uses-current-preferences)).

---

## Related

- The user-facing surface: [`experience/inbox.md`](../experience/inbox.md)
- Storage concerns:
  [`notification-storage.md`](../../../../architecture/notifications/persistence/notification-storage.md)
- Rulings: [`decisions/history.md`](../decisions/history.md)
