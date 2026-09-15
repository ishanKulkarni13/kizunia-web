# Candidate Selection

> **Status:** Stable — Phase 0, deliberate simplification
>
> **Last Updated:** 2026-09-15

Implementation: `backend/candidate.repository.ts` + `backend/candidate.service.ts`.

## The query

```ts
prisma.competition.findMany({
  where: { visibility: "PUBLIC", deletedAt: null, status: "REGISTRATION_OPEN" },
  orderBy: [{ registrationDeadline: "asc" }, { id: "asc" }],
  take: candidateLimit,   // default 500, see configuration.md
  include: { /* categories, technologies, eligibilities, locations, assets */ },
})
```

Not user-specific — Phase 0 evaluates every user against the same candidate
universe. Per-user narrowing (excluding what a user already registered
for, say) is Phase 1 territory.

## Phase 0's deliberate simplification: `status` only

The existing notification spec
(`docs/architecture/notifications/recommendation/candidate-selection.md`)
documents that `Competition.status` is a sweep-materialized value that can
lag the raw `registrationStartDate`/`registrationDeadline` timestamps, and
recommends reasoning from timestamps for the exact "is registration open
right now" boundary.

**By explicit product direction, Phase 0 does not do this.** Candidate
selection reads `status === "REGISTRATION_OPEN"` only. This is accepted
because Phase 0's only consumer is a manually-triggered internal testing
route — not the unattended daily cron path Phase 1's
`TOP_RELEVANT_COMPETITION` intent will need. **Phase 1 must revisit this**
before relying on it for real notification delivery; the sweep-lag concern
the existing spec raises is real and unaddressed here.

## Why hard constraints are NOT pushed into this query

Eligibility (hard preference constraints) is evaluated by the engine
(`engine/eligibility.ts`), not by adding `WHERE` clauses here. This follows
the existing distinction between selection and filtering: *"selection is
what the query can efficiently express, filtering is what the rules
require... moving a filter into the query must produce the same outcome
either way"* — see
[`docs/architecture/notifications/recommendation/candidate-selection.md`](../notifications/recommendation/candidate-selection.md).
Keeping hard constraints in the engine means filtering and scoring can
never diverge, and pushing a specific constraint into SQL later (as a
performance optimization) is a change that must be provably identical, not
a design change.

## Why this is its own module, not a call into `CompetitionRepository`

`docs/architecture/notifications/module-boundaries.md` establishes that a
consumer needing competition data defines its own read contract rather
than reaching into competition internals or borrowing its repository. This
module follows the same rule even though it is not itself the notification
module: `CandidateRepository` is its own query, independent of
`competitions/backend/repository.ts`.

## The cost guard

`candidateLimit` (default 500, see [`configuration.md`](configuration.md))
bounds the one query. This is an engineering guard for Phase 0's scale, not
an answer to the batching/precomputation cost problem the existing
notification spec raises for `TOP_RELEVANT_COMPETITION` running daily for
every user — that remains open, and is explicitly Phase 1's problem to
solve (see [`future.md`](future.md)).
