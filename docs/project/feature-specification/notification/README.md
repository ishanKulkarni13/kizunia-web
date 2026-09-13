# Kizunia Notifications

> **Status:** Specification — approved decisions, no implementation started
>
> **Version:** 1.0
>
> **Audience:** Product, Backend, Frontend, Contributors
>
> **Last Updated:** 2026-09-12

---

## What this is

Notifications is the subsystem that decides **whether Kizunia should tell a user something, what
it should tell them, and when** — and then records that it did.

It is deliberately not scoped as "competition reminders." Phase 1 ships two competition
notification types, but the subsystem is a general notification platform: intents, preferences,
candidate evaluation, relevance, ranking, aggregation, history and delivery are all first-class
concepts that exist independently of competitions.

This directory is the **product specification**: what Notifications does and why.
The technical architecture lives separately, in
[`docs/architecture/notifications/`](../../../architecture/notifications/README.md).

---

## Read this first

If you read only one thing, read [`overview/glossary.md`](overview/glossary.md). Several terms in
this subsystem look interchangeable and are not — *filter* vs *preference*, *relevance* vs
*filtering*, *notification* vs *notification occurrence*, *delivered* vs *responded*. Confusing
any of these pairs produces a wrong implementation.

Suggested reading order:

| # | Document | Why |
| --- | --- | --- |
| 1 | [`overview/purpose.md`](overview/purpose.md) | Why the subsystem exists at all |
| 2 | [`overview/glossary.md`](overview/glossary.md) | The vocabulary everything else assumes |
| 3 | [`phase-1/scope.md`](phase-1/scope.md) | What is actually being built first |
| 4 | [`preferences/README.md`](preferences/README.md) | How the user controls what they get |
| 5 | [`relevance/README.md`](relevance/README.md) | How Kizunia decides what is worth sending |
| 6 | [`intents/README.md`](intents/README.md) | The two Phase 1 notification types in full |
| 7 | [`history/README.md`](history/README.md) | What is recorded and how it constrains the future |

---

## Documentation areas

| Area | Owns |
| --- | --- |
| [`overview/`](overview/README.md) | Purpose, scope boundary, canonical terminology |
| [`decisions/`](decisions/README.md) | The authoritative register of finalized rulings |
| [`preferences/`](preferences/README.md) | Competition preference profile and notification preferences |
| [`relevance/`](relevance/README.md) | Candidate filtering, scoring, thresholds, selection |
| [`intents/`](intents/README.md) | Notification types and their behavioral contracts |
| [`history/`](history/README.md) | Notification records, deduplication, re-evaluation, response |
| [`experience/`](experience/README.md) | Inbox behavior and the full user-story register |
| [`phase-1/`](phase-1/README.md) | The consolidated Phase 1 model and its hard boundaries |
| [`future/`](future/README.md) | Direction only — nothing here is implemented |
| [`open-decisions.md`](open-decisions.md) | What is deliberately not decided yet |
| [`STRUCTURE.md`](STRUCTURE.md) | What every folder and file owns, and where a change belongs |

---

## Where things are **not**

| Looking for | Go to |
| --- | --- |
| Pipeline stages, processing context, filter chain | [`architecture/notifications/pipeline/`](../../../architecture/notifications/pipeline/README.md) |
| Module boundaries, replaceable algorithms | [`architecture/notifications/`](../../../architecture/notifications/README.md) |
| Storage shape, delivery mechanics, triggers | [`architecture/notifications/`](../../../architecture/notifications/README.md) |
| Domain entities and their relationships | [`architecture/domain/notifications/`](../../../architecture/domain/notifications/README.md) |
| Competition status derivation | [`workflows/competition/lifecycle-automation.md`](../../../architecture/workflows/competition/lifecycle-automation.md) |
| How scheduled jobs are invoked in this repo | [`workflows/internal-jobs.md`](../../../architecture/workflows/internal-jobs.md) |

---

## Status

**Specification complete for Phase 1. No implementation started.**

The behavioral decisions recorded in [`decisions/`](decisions/README.md) are finalized and should
not be reinterpreted without an explicit product decision. The items in
[`open-decisions.md`](open-decisions.md) are genuinely open and must be resolved before or during
architecture work.

---

## Keeping this live

This is a living specification, not a snapshot.

- When notification **behavior** changes, update the owning document **and** add or amend the
  ruling in [`decisions/`](decisions/README.md) in the same change.
- When notification **architecture** changes, update
  [`docs/architecture/notifications/`](../../../architecture/notifications/README.md) — not here.
- When something moves from idea to commitment, move it out of [`future/`](future/README.md)
  rather than duplicating it.
- Code and documentation are expected not to drift. A behavior change that ships without its
  documentation change is an incomplete change.

[`STRUCTURE.md`](STRUCTURE.md) contains a "where does my change go?" guide for exactly this.
