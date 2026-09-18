# Kizunia Notifications Architecture

> **Status:** Implemented — see [IMPLEMENTATION-STATUS.md](IMPLEMENTATION-STATUS.md)
>
> **Version:** 1.0
>
> **Audience:** Backend Developers, Contributors
>
> **Last Updated:** 2026-09-18

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
| 9 | [jobs/README.md](jobs/README.md) | How work is scheduled, claimed, retried and recovered |
| 10 | [cross-cutting/README.md](cross-cutting/README.md) | Flags, entitlements, analytics, failure |
| 11 | [testing/README.md](testing/README.md) | What must be independently testable |

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
| [`jobs/`](jobs/README.md) | The work model, claiming and leases, execution on Vercel |
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
| **There was no queue or job infrastructure.** Scheduled work is invoked by an authenticated HTTP `GET` with a `CRON_SECRET` bearer token, registered in `vercel.json` | A durable job table plus a sweep now sits between generation and delivery, invoked through that same convention. See [`jobs/README.md`](jobs/README.md) |
| **Vercel's Hobby plan allows two cron entries, daily** — and both were already used | One tick endpoint dispatches a registry of tasks, each with its own cadence. Cadence is configuration, not structure |
| Modules live at `next/src/modules/<domain>/` | Notifications is a sibling module, not a folder inside competitions |
| `CompetitionBookmark` and `CompetitionRegistration` already exist, keyed `(competitionId, userId)` | Recipient relationships are reads against existing tables, not new state |
| `CompetitionStatus` is derived from lifecycle dates by a pure function plus a nightly sweep | Notifications reads competition state; it never derives or writes it |
| `NotificationPreference` is one row per `(user, intent)`, opt-in by default | Per-intent defaults are decided per intent, not globally (ND-P-16). See [`persistence/preference-storage.md`](persistence/preference-storage.md) |
| Tests use Vitest, with established integration-test configuration and patterns | Testing follows existing conventions; no parallel system. See [`testing/strategy.md`](testing/strategy.md) |

---

## Status

**Implemented**, end to end: three intents, two channels, a durable work queue with lease-based
crash recovery, bounded retry, an inbox, and admin announcements.

Every blocking decision this document previously listed has been resolved and recorded as a ruling.
Current state, remaining environment configuration and known issues are in
[IMPLEMENTATION-STATUS.md](IMPLEMENTATION-STATUS.md); what is still deliberately undecided is in
[`open-decisions.md`](../../project/feature-specification/notification/open-decisions.md).

---

## Keeping this live

When notification architecture changes, the owning document here changes in the same commit. When
notification *behavior* changes, the product specification changes instead — and a ruling is
recorded in its
[decision register](../../project/feature-specification/notification/decisions/README.md).

> Code and documentation should not intentionally drift apart.
