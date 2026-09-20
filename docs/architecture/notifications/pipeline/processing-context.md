# The Processing Context

> **Status:** Design
>
> **Last Updated:** 2026-09-12

The pipeline has a well-defined **notification processing context** that carries information
accumulated during processing.

This document is short and mostly prohibitions, because the context is the part of this design most
likely to rot. A shared mutable object that every stage can write to is the easiest thing in the
world to build and the hardest to remove.

---

## What a stage may do

**Read existing context** — use information produced by previous stages.

**Add context** — make useful information available to later stages.

**Make a decision** — allow, reject or modify processing, according to its responsibility.

---

## What the context must not become

> Do not create an untyped or unstructured "god object" containing arbitrary data from every
> subsystem.

The context must have clear ownership and contracts so that it remains understandable as the
pipeline grows.

Concretely:

| Prohibited | Why |
| --- | --- |
| An untyped bag (`Record<string, unknown>`, `any`) | Nothing can be reasoned about, and every stage becomes coupled to every other by accident |
| Arbitrary reads and writes by any stage | Ownership disappears; a change in one stage silently breaks another |
| Convenience data from unrelated subsystems | The context becomes a cache, then a dependency, then a coupling surface |
| Service handles or repositories stored on the context | Stages get their collaborators from injection, not by rummaging in context |
| Mutating another stage's contribution | A stage owns what it adds; later stages read it |

---

## Ownership rules

**Every piece of context has exactly one producing stage.** That stage is responsible for its
shape and meaning. Other stages read it.

**Context grows in one direction.** A stage may add; it may not remove or rewrite what an earlier
stage contributed. A stage that needs a transformed view produces a new contribution rather than
overwriting the old one.

**Context is typed, and its type reflects what is actually known at that point.** A field that only
exists after relevance scoring should not be readable — or `undefined`-checked everywhere — by
stages that run before it. Whether this is expressed by progressive types, discriminated phases, or
a simpler convention is an implementation choice; the requirement is that a stage cannot silently
depend on something that has not happened yet.

---

## What belongs in the context

Roughly, the accumulated result of the stages in
[stages.md](stages.md):

| Contributed by | Content |
| --- | --- |
| Context initialization | The intent being evaluated, the evaluation timestamp, run identity |
| User eligibility | The user, and the resolved eligibility outcome |
| Candidate selection | The candidate set |
| Candidate filtering | The surviving set, and why candidates were removed |
| Preference matching | Per-candidate match information |
| Relevance scoring | Per-candidate score |
| Ranking and selection | The ordered, selected set |
| Aggregation | The user-facing grouping |

Note the fourth row. **Why a candidate was removed** is context worth carrying, not a detail to
discard: it is what makes a pipeline run explainable, and it is the raw material for the future
analytics vocabulary — filtered, suppressed, ranking position, recommendation reason
([`../cross-cutting/analytics-and-tracking.md`](../cross-cutting/analytics-and-tracking.md)).

Carrying it is cheap. Reconstructing it after the fact is not possible.

---

## The evaluation timestamp

Worth calling out separately: "now" belongs in the context, established once at initialization.

A pipeline that reads the clock at several stages can decide a deadline is 2 days away during
candidate selection and a few hours closer during generation. Time is an input to this subsystem,
and inputs belong in the context.

---

## Scope of a context

One context corresponds to one **evaluation for one user for one intent**. It is not shared across
users and not shared across intents.

This matters for the daily discovery sweep, which evaluates many users: that is many contexts, not
one context with a user field that changes. A per-user context is what allows a single user's
evaluation to fail, be tested, or be traced in isolation.

---

## The test that keeps this honest

If a stage cannot be tested by constructing a context, running the stage and asserting on the
result — without a database, without the rest of the pipeline, and without knowing which stages
come after it — the context has become coupling rather than communication.

See [`../testing/test-surface.md`](../testing/test-surface.md).
