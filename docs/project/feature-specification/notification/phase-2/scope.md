# Phase 2 Scope

> **Status:** Live
>
> **Last Updated:** 2026-09-17

---

## Included

| Capability | Specification |
| --- | --- |
| Notification records, subjects and history | [`history/README.md`](../history/README.md), [ND-H-11](../decisions/history.md#nd-h-11--a-records-subject-set-is-a-child-collection-not-a-column) |
| Notification inbox, in-app, web | [`experience/inbox.md`](../experience/inbox.md) |
| Read and responded state | [ND-H-10](../decisions/history.md#nd-h-10--read-and-responded-are-separate-states) |
| Durable work queue with leases and crash recovery | [`decisions/delivery.md`](../decisions/delivery.md) |
| Scheduled evaluation for both competition intents | [ND-I-19](../decisions/intents.md#nd-i-19--the-deadline-evaluation-window-is-a-daily-band-not-an-instant), [ND-I-23](../decisions/intents.md#nd-i-23--the-daily-evaluation-is-one-global-run-at-a-configured-hour) |
| `TOP_RELEVANT_COMPETITION`, end to end | [`intents/top-relevant-competition.md`](../intents/top-relevant-competition.md) |
| `REGISTRATION_CLOSING`, end to end | [`intents/registration-closing.md`](../intents/registration-closing.md) |
| `FEATURE_ANNOUNCEMENT`, admin-authored and scheduled | [`intents/feature-announcement.md`](../intents/feature-announcement.md) |
| Web push delivery through FCM | [ND-D-03](../decisions/delivery.md#nd-d-03--delivery-state-vocabulary) |
| Multiple push subscriptions per user | [ND-D-11](../decisions/delivery.md#nd-d-11--a-notification-may-have-several-deliveries-the-user-still-has-one-notification) |
| Invalid-subscription deactivation | [ND-D-09](../decisions/delivery.md#nd-d-09--an-invalid-push-subscription-is-deactivated-on-first-proof) |
| Bounded, classified retry with backoff | [ND-D-08](../decisions/delivery.md#nd-d-08--retries-are-bounded-backed-off-and-classified) |
| Delivery tracking and per-attempt audit | [ND-D-03](../decisions/delivery.md#nd-d-03--delivery-state-vocabulary) |

---

## What must be true when Phase 2 ships

- [ ] A user with preferences and the discovery intent enabled receives a notification in their
      inbox from a scheduled run, without anyone invoking anything by hand.
- [ ] A user with no eligible recommendation receives nothing. Silence remains a valid outcome
      ([ND-I-05](../decisions/intents.md#nd-i-05--a-scheduled-run-is-not-a-reason-to-notify)).
- [ ] Running the scheduler twice for the same occasion produces one notification, not two.
- [ ] A worker that dies mid-job leaves work that another worker picks up.
- [ ] Two workers running concurrently never process the same unit of work.
- [ ] A push failure retries the push. It never re-runs recommendation generation.
- [ ] A push failure never removes or alters the inbox record.
- [ ] A dead push token is deactivated and never retried.
- [ ] A user with three browsers gets one notification and three independent delivery records.
- [ ] Disabling an intent stops future pushes and leaves past notifications intact.
- [ ] A user cannot read or modify another user's notifications, preferences or subscriptions.
- [ ] Only an authorized administrator can create an announcement.
- [ ] An announcement scheduled for later is not delivered before then.
- [ ] Announcement fan-out interrupted halfway resumes rather than restarting or double-sending.
- [ ] Every delivery state means exactly what
      [ND-D-03](../decisions/delivery.md#nd-d-03--delivery-state-vocabulary) says it means, and
      nothing claims the user saw anything.

---

## Scale this must hold at

At least **2,000 users**, with several notifications each, and no single execution that processes
the entire population synchronously.

This is not a performance target so much as a shape requirement: work is per-user and independent,
so the population size determines how many units of work exist, not how long any one execution
runs. An architecture that needs re-designing at 2,000 users would need re-designing again at
20,000; one that treats each user as an independent, resumable unit does not.
