# Testing

> **Status:** Stable — Phase 0
>
> **Last Updated:** 2026-09-15

Follows the repository's existing convention
(`next/docs/testing/{README,conventions,database}.md`): Vitest, two tiers
by filename suffix, co-located next to source, no Prisma mocking.

## Unit tier (`*.test.ts`) — the pure engine

No database, no network. Located under
`next/src/modules/recommendations/engine/`:

| File | Covers |
| --- | --- |
| `profile.test.ts` | No preference, weight 0, soft, hard, hard-constraint dominance, multiple values, hard+soft in one dimension |
| `eligibility.test.ts` | Hard match/mismatch/missing, soft mismatch survives, filtering before scoring |
| `scoring.test.ts` | Match raises score, mismatch/missing lower it, user weight, system weight, inactive dimensions don't penalize, `[0, 1]` bound, zero active dimensions |
| `dimensions/location.test.ts` | Match, different area, missing location, containment via `searchAreaIds`, no coordinate/distance code reachable |
| `dimensions/set.test.ts`, `dimensions/team-size.test.ts` | The two dimension factories; team size's unconstrained-means-match exception |
| `ranking.test.ts` | Higher score ranks first; deterministic tie-break chain |
| `pipeline.test.ts` | Threshold include/exclude; threshold never lowered to fill Top-N; Top-N caps; disabled dimension excluded from scoring; diagnostics counts reconcile |
| `scenario.test.ts` | The controlled scenario below |

## Integration tier (`*.integration.test.ts`) — real Postgres

`backend/recommendation.service.integration.test.ts`: seeds a user,
categories, technologies, a location with search areas, and several
competitions; asserts `userId -> ranked RecommendationResult` end to end
using the dummy profile; asserts candidate selection includes only
`status = REGISTRATION_OPEN` and excludes deleted/non-public rows; asserts
no notification-related table is touched. `SessionService` is stubbed per
the repository's testing conventions where a controller-level test is
added; the service-level integration test calls `RecommendationService`
directly and needs no session stub.

## The controlled scenario

Used to validate the algorithm conceptually (`scenario.test.ts`), matching
the dummy profile (`preference-profile.provider.ts`):

```text
Profile:  AI -> 0.9 (soft, deliberately not 1.0 — see phase-0-dummy-profile.md),
          Web Dev -> 0.4, Python -> 0.6,
          Free -> 0.8, Intermediate -> 0.5, Undergraduate -> 1.0 (hard)

A: AI, Hackathon-flavored, Free, Intermediate, Pune, UG           -> strongest
B: AI, Free, Intermediate, Mumbai, UG                             -> strong, below A
C: Web only, Paid, UG                                              -> moderate/low
D: AI, Free, Pune, PG-only                                         -> hard-rejected (UG constraint)
E: unrelated categories/technologies entirely                      -> below threshold or rejected
```

Expected: `A` ranks above `B` above `C`; `D` never appears in `items` and
is counted under `rejectedByHardConstraint`; `E` either fails to clear the
threshold or is absent.

## The internal testing route

`/internal/notification/top-competition` —
`next/src/app/(dashboard)/internal/notification/top-competition/`.
Authenticated (via `SessionService.getActor`), not admin-gated. Always
generates for the caller's own session `userId` — `RecommendationController`
has no code path that accepts a caller-supplied user id (the request
schema has no such field). Calls
`POST /api/v1/me/recommendations/competitions` and renders `items` plus
`diagnostics`. Contains no scoring/ranking logic itself. Creates no
notification, writes no history, touches no queue.
