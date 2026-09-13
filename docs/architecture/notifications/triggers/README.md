# Triggers

> **Status:** Design
>
> **Last Updated:** 2026-09-12

Different notification intents use different trigger mechanisms:

```text
TOP_RELEVANT_COMPETITION          ->  scheduled discovery
REGISTRATION_CLOSING              ->  scheduled deadline evaluation
Future admin or event-driven      ->  event or administrative trigger
```

| Document | Contents |
| --- | --- |
| [scheduled-evaluation.md](scheduled-evaluation.md) | The Phase 1 mechanism, following the repository's cron convention |
| [event-and-admin-triggers.md](event-and-admin-triggers.md) | Future trigger sources on the same logic |

---

## The rule

> **The trigger mechanism must remain separate from the underlying notification logic.**

The same business logic must be reusable regardless of whether execution was initiated by:

- a scheduled job;
- an admin action;
- a domain event;
- another future trigger.

A scheduled job is **only a trigger**. The recommendation logic must remain independent of the
scheduler so it can later be invoked through other mechanisms **without duplicating business
logic**
([ND-I-04](../../../project/feature-specification/notification/decisions/intents.md#nd-i-04--daily-midnight-evaluation-with-the-trigger-separated-from-the-logic)).

---

## Why this is stated so firmly

Triggers change far more often than rules. Over this subsystem's expected life:

- the daily discovery sweep may need to be split into batches;
- an admin will want to run an evaluation on demand;
- lifecycle changes may become domain events;
- a backfill will be needed after a scoring change;
- a test will need to run one user's evaluation directly.

Every one of those is a new trigger over **unchanged** logic. If the rules live inside the job
handler, each becomes a copy — and copies drift.

---

## This repository's existing position

Kizunia already treats this as settled architecture, documented in
[`workflows/internal-jobs.md`](../../workflows/internal-jobs.md):

```text
Scheduler
    ↓
Internal Job HTTP Endpoint      the only place infrastructure exists
    ↓
Domain / Application Service    has no idea Vercel, cron, or HTTP exist
    ↓
Repository / Database
```

> The endpoint is the entire boundary between "something invoked this" and "the domain logic runs."

A domain service never imports anything Vercel-specific, never reads scheduling configuration, and
is exactly as callable from a future admin UI as from a cron request — **the invocation mechanism
is not part of its contract.**

Notifications follows this convention rather than inventing one. The existing
`CompetitionLifecycleService` and `AssetReconciliationService` are the precedent.

---

## Consequence: a run is not a reason

Because the trigger is not the logic, a scheduled evaluation running is not itself a reason to
notify. If no candidate qualifies, nothing is generated
([ND-I-05](../../../project/feature-specification/notification/decisions/intents.md#nd-i-05--a-scheduled-run-is-not-a-reason-to-notify)).

The trigger's only job is to say *evaluate now*.
