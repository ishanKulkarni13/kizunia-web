# Implementation Plan

> **Status:** Stable — Phase 0, written before implementation
>
> **Last Updated:** 2026-09-15

This records the plan the implementation was built against, and is kept
afterward as the record of what was decided and why — not deleted once the
code exists.

## Existing code reused

| Reused | From | For |
| --- | --- | --- |
| `CompetitionCardDTO` | `modules/competitions/types/dto.ts` | The result contract's display shape |
| `competitionLocationMapper.toSummaryDTOs` | `modules/competitions/backend/competition-location.mapper.ts` | Building the card DTO's `locations` field |
| `SearchArea` containment model | `modules/locations/`, `domain/location.md` | The location dimension's entire semantics |
| Team-size containment semantics | `modules/competitions/search/team-size-clause.ts` | The team-size dimension's `match` (re-expressed in pure arithmetic, since the engine has no query builder) |
| `SessionService.getActor`/`getStrictActor` | `lib/auth/session.ts` | The internal route's and controller's authentication |
| `Route.execute` / `ApiResponse` / error handling | `lib/http/`, `lib/errors/` | The one new API route |
| Rate-limit policy registry pattern | `lib/rate-limit/policies.ts` | `RECOMMENDATIONS_GENERATE` policy |
| Static-method service/repository/controller/mapper layering | `modules/competitions/backend/` | The whole `backend/` layer of this module |
| Pure-module-outside-`backend/` precedent | `modules/competitions/lifecycle/resolver.ts` | The `engine/` boundary |
| `PageWrapper`, `Skeleton`, `Empty*`, `sonner` toast | `components/`, existing admin pages | The internal testing route's UI |
| Vitest two-tier testing convention | `next/docs/testing/` | This module's test layout |

## New code

`next/src/modules/recommendations/` in full: `engine/` (pure), `config/`,
`backend/`, `schemas/`, `types/`, `api/`. One new API route
(`app/api/v1/me/recommendations/competitions/route.ts`) and one new UI
route (`app/(dashboard)/internal/notification/top-competition/`).

## Schema change

One: `interests UserCategory[]` removed from `User`, `users UserCategory[]`
removed from `Category`, and the `UserCategory` model dropped entirely —
per explicit product direction, not for recommendation storage. No table
was added for recommendations; the preference profile is a hardcoded
adapter (`DummyPreferenceProfileProvider`), not a persisted model. See
[`docs/project/feature-specification/recommendation/preferences/phase-0-dummy-profile.md`](../../project/feature-specification/recommendation/preferences/phase-0-dummy-profile.md).

## Configuration

`config/recommendation-config.ts` — system weights, threshold, Top-N,
candidate limit, enabled dimensions, all in one file. See
[`configuration.md`](configuration.md).

## Interfaces/contracts connecting the stages

- `PreferenceProfileProvider.load(userId)` — profile source.
- `RecommendationCandidate` — the engine's input shape for one competition.
- `RecommendationDimension.extract`/`match` — one dimension's evaluation.
- `ScoringStrategy.score(...)` — the replaceable scoring contract.
- `RecommendationConfig` — everything the pipeline needs to run.
- `PipelineResult` (`ranked` + `diagnostics`) — the pure engine's output.
- `RecommendationResultDTO` — the backend's mapped, display-ready output.

## Testing strategy

See [`testing.md`](testing.md) in full.

## Temporary route

See [`testing.md`](testing.md)'s "The internal testing route" section.

## Documentation

New: this tree (`docs/architecture/recommendation/`) and
`docs/project/feature-specification/recommendation/`. Edited: the existing
notification architecture/spec docs, to link outward to Phase 0 rather than
restate anything — see the "Phase relationship" sections in both new
READMEs, and the notification tree's own edits recorded in its documents'
"Phase 0" cross-reference sections.

## Deviations from the original design pass, and why

Two decisions changed after initial review, both by explicit product
direction, both recorded as rulings:

- Temporal dimensions removed from Phase 0 entirely, rather than
  implemented via a day-bucket encoding (RD-06).
- Candidate selection reads `status` only, not timestamps (RD-09) — a
  documented, temporary deviation from the existing notification spec's
  own guidance, acceptable for a manual testing surface, flagged for Phase
  1 to revisit.

Both are recorded in
[`docs/project/feature-specification/recommendation/decisions/README.md`](../../project/feature-specification/recommendation/decisions/README.md)
rather than silently implemented without a trace.
