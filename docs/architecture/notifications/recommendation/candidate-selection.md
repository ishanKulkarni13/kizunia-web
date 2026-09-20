# Candidate Selection

> **Status:** Design — open decisions attached
>
> **Last Updated:** 2026-09-12

Candidate selection produces the working set for one user's evaluation of one intent. It is the
stage with the most serious cost implications and the most unresolved questions.

---

## Per-intent candidate rules

| Intent | Candidates |
| --- | --- |
| `TOP_RELEVANT_COMPETITION` | Competitions whose registration is **currently open** |
| `REGISTRATION_CLOSING` | Competitions approaching their registration deadline that are **relevant to** or **bookmarked by** the user |

Candidate selection is per-intent behavior supplied through the intent contract
([`../intents/intent-contract.md`](../intents/intent-contract.md)), not a shared query with
branches.

---

## What the data model gives us

Verified against the schema rather than assumed:

| Available | Use |
| --- | --- |
| `Competition.status` (`CompetitionStatus`), indexed | Registration-open candidates |
| `Competition.registrationDeadline`, indexed | Deadline-window candidates |
| `Competition.registrationStartDate`, indexed | Actionability transitions |
| `CompetitionBookmark`, with `@@index([userId, createdAt])` | A user's bookmarks, efficiently |
| `CompetitionRegistration`, with `@@index([userId, markedAt])` | A user's self-declared registrations, efficiently |

Status is **derived** by the competition domain from lifecycle dates, by a pure function plus a
nightly sweep ([`lifecycle-automation.md`](../../workflows/competition/lifecycle-automation.md)).
Notifications reads it; it never derives or writes it
([`../module-boundaries.md`](../module-boundaries.md)).

### One subtlety worth carrying

`status` is a materialized value updated by a sweep, so between a deadline passing and the sweep
running, `status` can lag the dates. An intent that cares about the *exact* boundary — which
`REGISTRATION_CLOSING` does — should reason from the timestamps, not only from the enum. Which of
the two is authoritative for each candidate rule is part of the open evaluation-window decision
below.

---

## The cost problem

`TOP_RELEVANT_COMPETITION` runs daily for every eligible user. Naively:

```text
for each eligible user
    for each registration-open competition
        score it
```

is a product of two growing numbers, executed inside a single cron invocation, on a platform with
request time limits.

**This is unresolved.** The plausible directions, none chosen:

| Direction | Trade-off |
| --- | --- |
| Narrow candidates by hard constraints in the query itself | Cheapest, but pushes preference semantics into SQL and risks diverging from the scorer |
| Score only competitions that became actionable recently | Matches the freshness rule ([ND-I-08](../../../project/feature-specification/notification/decisions/intents.md#nd-i-08--freshness-means-newly-actionable-not-newly-created)), but "recently" is undefined |
| Precompute relevance periodically and read it at evaluation time | Fast reads, adds staleness and a storage model that does not exist |
| Batch users and spread the sweep across multiple invocations | Fits the cron constraint, complicates "daily at midnight" |

**Open:** recommendation freshness strategy, batching windows and how often relevance matching runs
are all recorded as open decisions
([`open-decisions.md`](../../../project/feature-specification/notification/open-decisions.md)).

---

## The blocking question: where does "relevant" come from?

`REGISTRATION_CLOSING` treats **relevance** as an eligibility relationship — a competition is a
candidate if it is relevant to the user *or* bookmarked by them
([ND-I-11](../../../project/feature-specification/notification/decisions/intents.md#nd-i-11--eligibility-is-relevant-or-bookmarked-excluding-marked-as-registered)).

Bookmarks are a table lookup. Relevance is not.

| Option | Consequence |
| --- | --- |
| **Recompute** relevance at deadline-evaluation time | Correct and current, but scores every near-deadline competition against every eligible user's profile — a second full scoring workload |
| **Read** stored relevance produced by the discovery pipeline | Cheap, but introduces staleness, and requires a persisted relevance model that this specification does not define |

**This is blocking** — item A-4 in
[`open-decisions.md`](../../../project/feature-specification/notification/open-decisions.md). It
cannot be deferred to implementation, because the two options imply different storage.

A related consequence worth noting: if relevance is stored, then
[ND-H-05](../../../project/feature-specification/notification/decisions/history.md#nd-h-05--each-evaluation-uses-current-preferences)
— every evaluation uses the user's *current* preferences — constrains how stale stored relevance
may be, and requires invalidation when a user edits their profile.

---

## The deadline evaluation window

`REGISTRATION_CLOSING` targets 2 days before the deadline timestamp
([ND-I-10](../../../project/feature-specification/notification/decisions/intents.md#nd-i-10--registration_closing-targets-2-days-before-the-deadline)
— a temporary, simple rule, amended from an originally-considered 24 hours), and a scheduled job
cannot fire at an arbitrary instant per competition.

The window that approximates it — and the guarantee that a given deadline event produces exactly
one notification per user regardless of how many times the job runs — is **blocking**, item A-1 in
[`open-decisions.md`](../../../project/feature-specification/notification/open-decisions.md).

Note the interaction with idempotency: whatever window is chosen, re-running the job must not
produce a second notification for the same deadline event
([`../cross-cutting/failure-and-idempotency.md`](../cross-cutting/failure-and-idempotency.md)).

---

## What candidate selection must not do

| Must not | Why |
| --- | --- |
| Apply relevance scoring | That is a later stage; filtering comes first ([ND-R-04](../../../project/feature-specification/notification/decisions/relevance.md#nd-r-04--candidate-filtering-runs-strictly-before-scoring)) |
| Encode exclusion rules that belong in filters | Exclusions are composable filters, so they can be reused and tested alone ([`../pipeline/filter-chain.md`](../pipeline/filter-chain.md)) |
| Reach into competition internals | Reads go through a defined boundary ([`../module-boundaries.md`](../module-boundaries.md)) |
| Assume the subject is a competition | The first non-competition intent must not need a new pipeline ([`../principles.md`](../principles.md)) |

The line between selection and filtering is pragmatic: selection is what the **query** can
efficiently express, filtering is what the **rules** require. A rule that happens to be
expressible in the query is still conceptually a filter, and must produce the same outcome either
way — which is what makes moving it later a performance change rather than a behavior change.

---

## Phase 0

[`docs/architecture/recommendation/candidate-selection.md`](../../recommendation/candidate-selection.md)
implements a first candidate-selection stage, but with a narrower rule than this document
recommends: it reads `Competition.status === REGISTRATION_OPEN` only, not the timestamp-based
reasoning above. This is an explicit, temporary product decision for a manually-triggered testing
surface — the sweep-lag concern this document raises is real and **unaddressed** by Phase 0. Phase
1's `TOP_RELEVANT_COMPETITION` intent, which runs unattended on a schedule, should not inherit this
simplification without re-deciding it. The cost problem and the blocking "where does relevant come
from" question below remain fully open; Phase 0 evaluates one user manually, not the daily
all-users case this document is about.
