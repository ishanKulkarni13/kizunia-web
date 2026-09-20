# Pipeline

> **Status:** Stable — Phase 0
>
> **Last Updated:** 2026-09-15

```text
userId
  |
  v
PreferenceProfileProvider.load(userId)     backend/preference-profile.provider.ts
  |
  v
normalizeProfile(entries)                  engine/profile.ts            PURE
  |
  v
CandidateService.selectOpen({ limit })     backend/candidate.service.ts  <- the only DB read
  |
  v
runRecommendationPipeline({ profile, candidates, config })   engine/pipeline.ts   PURE
  |
  +--> evaluateEligibility(...)            engine/eligibility.ts   hard constraints, BEFORE scoring
  +--> scorer.score(...)                   engine/scoring.ts       replaceable strategy
  +--> threshold                           engine/pipeline.ts
  +--> rankCandidates(...)                 engine/ranking.ts       deterministic
  +--> take(topN)                          engine/pipeline.ts
  |
  v
RecommendationResultDTO (+ optional diagnostics)   backend/recommendation.service.ts
```

## Module boundary: `engine/` vs `backend/`

`engine/` is pure: no Prisma import, no `next/server` import, no I/O of any
kind. Every function in it is a plain transformation from typed inputs
(`engine/types.ts`) to typed outputs. This mirrors an existing convention
in this codebase —
`next/src/modules/competitions/lifecycle/resolver.ts` is pure for the same
reason, and is the direct precedent this module follows.

`backend/` is where I/O happens: `candidate.repository.ts` is the module's
one Prisma query, `preference-profile.provider.ts` loads a profile,
`recommendation.service.ts` wires the two into the pure pipeline and maps
the result back to display DTOs.

This boundary is what makes precomputation, caching, or batching later a
change to `backend/` alone — the engine does not need to know its
candidates came from a fresh query versus a precomputed cache.

## Why candidate selection is its own stage, not part of the engine

The engine (`runRecommendationPipeline`) takes a candidate list as input; it
does not know how that list was produced. `CandidateService` is a thin
seam specifically so that a future optimization — narrowing further in
SQL, evaluating multiple users in one pass, reading from a cache — is a
change to one file, never to `engine/`. See
[`candidate-selection.md`](candidate-selection.md).

## Why eligibility runs before scoring, structurally

`engine/pipeline.ts` calls `evaluateEligibility` first for every candidate
and only proceeds to `config.scorer.score(...)` for candidates that pass.
This is not an optimization; it is the load-bearing rule from the existing
notification decisions (`ND-R-04`, candidate filtering runs strictly before
scoring) — a hard mismatch must never appear in a score, even a very low
one.

## No `now` parameter

Earlier drafts of this pipeline threaded a `now` timestamp through, for
temporal dimensions and timestamp-based candidate selection. Phase 0
removed both by explicit product direction (see
[`candidate-selection.md`](candidate-selection.md) and
[`dimensions.md`](dimensions.md)), so nothing in the current pipeline reads
the clock at all — `RecommendationService.generateForUser` only calls
`new Date()` once, to stamp `RecommendationResultDTO.generatedAt` for
display. If a temporal dimension is reintroduced later, `now` should be
threaded through explicitly again rather than read from the clock inside
`engine/`, to keep the engine's tests deterministic — see
[`future.md`](future.md).
