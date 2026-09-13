# Kizunia Notifications Architecture

> **Status:** Design — no implementation started
>
> **Version:** 1.0
>
> **Audience:** Backend Developers, Contributors
>
> **Last Updated:** 2026-09-12

---

## What this is

This directory describes **how** the Notifications subsystem is built so that it can keep
changing.

It is the technical counterpart to the product specification at
[`docs/project/feature-specification/notification/`](../../project/feature-specification/notification/README.md),
which describes **what** Notifications does and why. Behavioral rules are stated there and
referenced here; they are not restated.

---

## The premise

Phase 1 ships two notification types. That is not the thing being designed.

> The Notifications system should be treated as a first-class, independently maintainable
> subsystem of Kizunia. The Phase 1 behavior is small, but the architecture must be designed for
> substantial future evolution.

The list of changes this subsystem is expected to absorb is long and specific: new and removed
notification types, replaced relevance and ranking algorithms, an ML model at any stage, new
delivery mechanisms and channels, changed aggregation rules, paid features, feature flags,
analytics, detailed tracking, changed limits, changed eligibility rules, new filtering stages,
changed priorities between types, event-driven notifications, new clients such as Expo, and changed
presentation.

None of those should require rewriting the subsystem.

> The architecture should optimize for **changeability**, not merely today's functionality.

---

## Reading order

| # | Document | Why |
| --- | --- | --- |
| 1 | [principles.md](principles.md) | The rules everything else follows |
| 2 | [module-boundaries.md](module-boundaries.md) | What this module owns and what it may touch |
| 3 | [pipeline/README.md](pipeline/README.md) | The processing model — the core of the design |
| 4 | [intents/README.md](intents/README.md) | The extensibility boundary |
| 5 | [recommendation/README.md](recommendation/README.md) | Replaceable algorithms |
| 6 | [triggers/README.md](triggers/README.md) | How evaluations start |
| 7 | [persistence/README.md](persistence/README.md) | What is stored |
| 8 | [delivery/README.md](delivery/README.md) | How notifications leave the system |
| 9 | [cross-cutting/README.md](cross-cutting/README.md) | Flags, entitlements, analytics, failure |
| 10 | [testing/README.md](testing/README.md) | What must be independently testable |

---

## Areas

| Area | Owns |
| --- | --- |
| [`pipeline/`](pipeline/README.md) | Stage sequence, processing context, filter chain, extension points |
| [`recommendation/`](recommendation/README.md) | Candidate selection, scoring strategy, ranking, aggregation |
| [`intents/`](intents/README.md) | The intent contract and how to add one |
| [`triggers/`](triggers/README.md) | Scheduled, event and admin invocation |
| [`persistence/`](persistence/README.md) | Notification and preference storage |
| [`delivery/`](delivery/README.md) | Generation/delivery split, the queue seam, clients and channels |
| [`cross-cutting/`](cross-cutting/README.md) | Feature flags, entitlements, analytics, failure and idempotency |
| [`testing/`](testing/README.md) | Testing strategy and the required test surface |

Related, outside this directory:

| Document | Contents |
| --- | --- |
| [`domain/notifications/`](../domain/notifications/README.md) | The conceptual domain model and its boundaries |
| [`decisions/notifications-subsystem.md`](../decisions/notifications-subsystem.md) | The founding architectural decision record |
| [`workflows/internal-jobs.md`](../workflows/internal-jobs.md) | The repository's scheduled-job convention, which triggers must follow |
| [`workflows/competition/lifecycle-automation.md`](../workflows/competition/lifecycle-automation.md) | How competition status is derived — consumed, not owned, by this subsystem |

---

## Environment facts this design must respect

Verified against the repository, not assumed:

| Fact | Consequence |
| --- | --- |
| **There is no queue or job infrastructure.** Every scheduled task is a plain synchronous service invoked by an authenticated HTTP `GET` with a `CRON_SECRET` bearer token, registered in `vercel.json` | The queue between generation and delivery is a seam to design, not a component to configure. See [`delivery/queue.md`](delivery/queue.md) |
| Modules live at `next/src/modules/<domain>/` | Notifications is a sibling module, not a folder inside competitions |
| `CompetitionBookmark` and `CompetitionRegistration` already exist, keyed `(competitionId, userId)` | Recipient relationships are reads against existing tables, not new state |
| `CompetitionStatus` is derived from lifecycle dates by a pure function plus a nightly sweep | Notifications reads competition state; it never derives or writes it |
| A legacy, unused `NotificationPreference` model exists | Its disposition is an open, blocking decision. See [`persistence/preference-storage.md`](persistence/preference-storage.md) |
| Tests use Vitest, with established integration-test configuration and patterns | Testing follows existing conventions; no parallel system. See [`testing/strategy.md`](testing/strategy.md) |

---

## Status

**Design only. No implementation started.**

Several blocking decisions must be resolved before implementation — the `REGISTRATION_CLOSING`
evaluation window, the legacy preference model, what the queue actually is, and where relevance
comes from for the deadline intent. They are listed in
[`open-decisions.md`](../../project/feature-specification/notification/open-decisions.md).

---

## Keeping this live

When notification architecture changes, the owning document here changes in the same commit. When
notification *behavior* changes, the product specification changes instead — and a ruling is
recorded in its
[decision register](../../project/feature-specification/notification/decisions/README.md).

> Code and documentation should not intentionally drift apart.
