# Event and Admin Triggers

> **Status:** Direction only — not implemented
>
> **Last Updated:** 2026-09-12

Phase 1 has scheduled triggers only. Other trigger sources are anticipated, and the design
constraint is that they reuse the **same** evaluation logic.

---

## Anticipated trigger sources

| Source | Example | Status |
| --- | --- | --- |
| Scheduled job | Daily discovery, deadline evaluation | Phase 1 |
| Admin action | "Notify users about this competition update" (US-22, US-23) | Future |
| Admin action | Re-run an evaluation on demand, or backfill after an algorithm change | Future |
| Domain event | A competition is cancelled (US-19) | Future |
| Another future trigger | Not designed | Future |

---

## The requirement

The same underlying business logic must be reusable regardless of which of these initiated
execution. A new trigger is an adapter over unchanged logic — never a second copy of the rules.

This is already the repository's position: a domain service is *"exactly as callable from a future
admin UI as it is from a cron request"*
([`workflows/internal-jobs.md`](../../workflows/internal-jobs.md)).

---

## What differs between trigger types

Only the boundary layer, and two things it must establish.

**Authorization.** A cron trigger authenticates with a shared secret and has **no actor** — it sits
outside Kizunia's session-based authorization model. An admin trigger has a real actor and goes
through the ordinary [authorization architecture](../../authorization/README.md). These are
different entry points with different security models, feeding the same service.

**Scope.** A scheduled sweep evaluates all eligible users. An admin trigger evaluates a named set.
An event trigger evaluates whatever the event names. Scope is an **input** to the evaluation, not a
property of the trigger — which is what keeps one evaluation service serving all three.

---

## Admin-designated competition updates

The most concretely anticipated non-scheduled trigger (US-22, US-23).

The design position already recorded:

- the **admin** decides whether an update warrants a notification, so the system never has to judge
  whether an arbitrary field change is important;
- the admin also determines the recipients;
- recipients may only be drawn from relationships Kizunia actually knows — bookmarked users, users
  who marked themselves registered, relevant users — never an assumed set of external registrants
  ([ND-I-16](../../../project/feature-specification/notification/decisions/intents.md#nd-i-16--recipient-rules-use-only-relationships-kizunia-knows)).

This intent inverts the usual flow: the recipient set is **supplied** rather than computed, and
there is no relevance ranking. It is therefore a genuine test of whether scope is really an input —
see
[`../intents/intent-contract.md`](../intents/intent-contract.md).

Everything else about it — the admin surface, recipient-group semantics, preference controls — is
undecided
([`future/notification-intents.md`](../../../project/feature-specification/notification/future/notification-intents.md)).

---

## Domain events

No domain event infrastructure exists in this repository. Competition status changes, for example,
are produced by a nightly sweep rather than published as events
([`workflows/competition/lifecycle-automation.md`](../../workflows/competition/lifecycle-automation.md)).

Introducing events is a platform-level decision well beyond Notifications. The constraint here is
narrower: **do not build notification logic that could only ever be reached by a schedule.** If an
event source appears later, it should be a new adapter.

Note that Phase 1 deliberately avoids needing one. A competition becoming registration-open is
picked up by the next discovery evaluation rather than by an event
([ND-I-09](../../../project/feature-specification/notification/decisions/intents.md#nd-i-09--becoming-registration-open-needs-no-separate-lifecycle-notification)).

---

## What must not happen

| Anti-pattern | Why |
| --- | --- |
| Rules living in the cron route handler | The next trigger has to copy them |
| An admin path that re-implements eligibility or filtering | Two implementations, guaranteed to drift |
| A trigger that writes notification records directly | Generation belongs to the pipeline ([`../pipeline/stages.md`](../pipeline/stages.md)) |
| A trigger that bypasses preference checks | The user's preference is authoritative regardless of who started the run |

That last row deserves emphasis: an admin-initiated notification still respects the recipient's
notification preferences. An admin decides *what is worth sending*, not *who has consented to
receive it*.
