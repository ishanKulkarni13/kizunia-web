# Dimensions

> **Status:** Stable — Phase 0
>
> **Last Updated:** 2026-09-15

## The abstraction

```ts
interface RecommendationDimension {
  readonly id: DimensionId;
  extract(candidate: RecommendationCandidate): readonly string[] | null;
  match?(preference: DimensionPreference, candidate: RecommendationCandidate): DimensionSignal;
}
```

`extract` answers "what comparable values does this candidate carry for
this dimension" — `null` means the competition has no data. `match` is an
optional escape hatch; the engine defaults to plain set intersection
(`engine/dimensions/dimension.ts`'s `defaultSetMatch`) when a dimension
does not provide one.

The engine (`eligibility.ts`, `scoring.ts`, `pipeline.ts`) never branches on
*which* dimension it is evaluating — it iterates
`engine/dimensions/registry.ts`'s map generically. This is what keeps
"add a dimension" from becoming "add a conditional in three places".

## Registry — `engine/dimensions/registry.ts`

Thirteen dimensions, verified against `next/prisma/schema.prisma`:

| Dimension id | Shape | Implementation |
| --- | --- | --- |
| `mode` | scalar enum | `scalarDimension` |
| `categories` | list (relation slugs) | `listDimension` |
| `technologies` | list (relation slugs) | `listDimension` |
| `eligibilities` | list (enum) | `listDimension` |
| `location` | list (`SearchArea` ids) | `location.ts`, still `listDimension` underneath |
| `registrationPlatform` | scalar enum | `scalarDimension` |
| `registrationType` | scalar enum | `scalarDimension` |
| `registrationFeeType` | scalar enum | `scalarDimension` |
| `organizerType` | scalar enum | `scalarDimension` |
| `difficulty` | scalar enum | `scalarDimension` |
| `certificateType` | scalar enum | `scalarDimension` |
| `status` | scalar enum | `scalarDimension` |
| `teamSize` | two nullable ints | `team-size.ts`, custom `match` (containment) |

Nine of the thirteen are one call each to `scalarDimension`/`listDimension`
(`engine/dimensions/set-dimension.ts`) — no bespoke code. `location`
reuses the same generic list matcher; its file exists to document *why*
`searchAreaIds` is the right extraction (see
[`docs/project/feature-specification/recommendation/relevance/location-matching.md`](../../project/feature-specification/recommendation/relevance/location-matching.md)),
not because it needs different matching code. Only `team-size` overrides
`match`, because its question is containment, not set membership.

## The one exception to "missing = mismatch": team size

Every dimension above treats a `null` extraction as `MISSING` (a
mismatch). Team size is the deliberate exception: a competition with no
`minTeamSize`/`maxTeamSize` at all is defined, by the existing search
filter (`next/src/modules/competitions/search/team-size-clause.ts`), as
accepting any team size — that is evidence of a match, not an absence of
data. `engine/dimensions/team-size.ts` reuses that same containment
semantics (re-expressed in plain arithmetic, since the engine cannot
depend on a Prisma clause builder) rather than inventing a different rule
for recommendations. If the search-side rule for team size ever changes,
this needs to change with it.

## Deferred: temporal dimensions

`DimensionId` in `engine/types.ts` deliberately has no entry for
`startDate`, `endDate`, `registrationDeadline`, or `registrationStartDate`
— by explicit product direction, Phase 0 does not register them at all.
They are used only in `engine/ranking.ts`, as tiebreakers, via
`RecommendationCandidate.startDate`/`registrationDeadline`.

Reintroducing one later as a scored dimension is additive:

1. Add a `DimensionId` entry.
2. Implement `extract` (a day-bucket encoding was the leading candidate in
   an earlier draft, but is not implemented — see
   [`future.md`](future.md)).
3. Register it in `engine/dimensions/registry.ts`.
4. Add a system weight in `configuration.md`.

No change to `eligibility.ts`, `scoring.ts`, or `pipeline.ts` is required.

## Not available: `registrationFee`, `competitionType`

See
[`docs/project/feature-specification/recommendation/relevance/dimensions.md`](../../project/feature-specification/recommendation/relevance/dimensions.md)
for why. Neither has a registry entry; there is nothing to disable.
