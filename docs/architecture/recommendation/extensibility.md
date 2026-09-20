# Extensibility

> **Status:** Stable — Phase 0
>
> **Last Updated:** 2026-09-15

Phase 0 is deliberately not over-engineered: no generic workflow engine, no
plugin framework, no dependency-injection container. Extensibility comes
from a small number of clean seams, matching what the codebase already does
elsewhere (`CompetitionRepository`/`CompetitionService`'s static-method
classes, no DI).

## Adding a dimension

1. Implement `extract` (and `match`, only if it is not plain set
   intersection) in `engine/dimensions/`.
2. Add one entry to `engine/dimensions/registry.ts`.
3. Add one system weight in `config/recommendation-config.ts`.

Nothing in `eligibility.ts`, `scoring.ts`, `pipeline.ts`, or `ranking.ts`
changes. See [`dimensions.md`](dimensions.md) for the two dimension
factories (`scalarDimension`, `listDimension`) that make most additions a
one-liner.

## Disabling a dimension

Remove its id from `ENABLED_DIMENSIONS` in
`config/recommendation-config.ts`. No code deletion; re-enabling is
re-adding the id. `pipeline.test.ts` covers that a disabled dimension is
excluded from both the eligibility check and the score's numerator/
denominator.

## Replacing the scoring strategy

Implement `ScoringStrategy` (`engine/types.ts`) and set it as
`config/recommendation-config.ts`'s `scorer`. See
[`scoring-strategy.md`](scoring-strategy.md) for the constraints a
replacement must honor and why swapping it means re-deriving the
threshold.

## Replacing the preference source

Implement `PreferenceProfileProvider` (`backend/preference-profile.provider.ts`)
and use it in place of `DummyPreferenceProfileProvider` in
`recommendation.service.ts`. This is the seam Phase 1 (or a resolved open
decision A-2) is expected to use — see
[`docs/project/feature-specification/recommendation/preferences/phase-0-dummy-profile.md`](../../project/feature-specification/recommendation/preferences/phase-0-dummy-profile.md).

## Replacing/extending candidate selection

`CandidateService.selectOpen` is the one seam. A different candidate rule
(e.g. Phase 1's `REGISTRATION_CLOSING` deadline window) is a new method
here, or a new service entirely — the pure engine
(`runRecommendationPipeline`) accepts any `RecommendationCandidate[]` and
does not care where it came from.

## Future ML relevance

The scoring strategy boundary is what would let a deterministic score be
combined with (or replaced by) an ML relevance signal later — see
[`future.md`](future.md). Nothing in Phase 0 depends on a particular ML
provider, and nothing needs to, since none exists yet.
