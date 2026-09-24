# Configuration

> **Status:** Stable — Phase 0
>
> **Last Updated:** 2026-09-15

Every tunable number lives in `next/src/modules/recommendations/config/recommendation-config.ts`
— one file, code-owned, no admin UI and no database-stored algorithm
configuration (explicit product direction). Changing a weight, the
threshold, or Top-N is a one-line edit there.

## System weights

Independent of any individual user's own weighting
(`DimensionPreference.userStrength`); the two multiply in `scoring.ts`.

| Dimension | Weight | Rationale |
| --- | --- | --- |
| `categories` | 1.00 | What the competition is *about* — the strongest topical signal. |
| `technologies` | 0.90 | Topical, but noisier — stacks are often partially listed. |
| `location` | 0.80 | Feasibility — a real, practical barrier for offline events. |
| `eligibilities` | 0.80 | Feasibility, and often genuinely disqualifying. |
| `competitionType` | 0.80 | What *kind* of competition this is — as strong a topical signal as category, not a feasibility one. |
| `mode` | 0.70 | Feasibility, coarser-grained than location/eligibility. |
| `registrationFeeType` | 0.60 | Real constraint for many users, but only three possible values. |
| `difficulty` | 0.50 | Fit signal, weaker and more often unset. |
| `registrationType` | 0.50 | Fit signal, weaker and more often unset. |
| `teamSize` | 0.50 | Fit signal, weaker and more often unset. |
| `status` | 0.40 | Mostly redundant with candidate selection (already `REGISTRATION_OPEN`). |
| `organizerType` | 0.30 | Weak preference signal. |
| `registrationPlatform` | 0.30 | Weak preference signal. |
| `certificateType` | 0.20 | Least discriminating — the "matters less than category" case. |

These are a first-version, engineering-judgment starting point, not derived
from data. Expected to move once real usage exists.

## Threshold

Default `0.5` — a candidate must clear at least half of the weighted
preference mass the user expressed. See
[`docs/project/feature-specification/recommendation/relevance/threshold-and-selection.md`](../../project/feature-specification/recommendation/relevance/threshold-and-selection.md)
for the product rule (never relaxed to fill Top-N).

Swapping the default scoring strategy for another one means re-deriving
this value — see [`scoring-strategy.md`](scoring-strategy.md)'s
comparability requirement.

## Top-N

Default `5`.

## Candidate limit

`500` — a Phase 0 cost guard on the one candidate query, not a product
decision. See [`candidate-selection.md`](candidate-selection.md).

## Enabled dimensions

All fourteen registered dimensions are enabled by default
(`ENABLED_DIMENSIONS` = every `DimensionId`). Disabling one is removing its
id from this set — no code deletion required, and re-enabling it is
re-adding the id.

## Overriding at the edges

`RecommendationService.generateForUser` accepts optional `threshold`,
`topN`, and `enabledDimensions` overrides, used only by the internal
testing route's tuning inputs (`schemas/generate-recommendations.ts`).
Production/default calls use `defaultRecommendationConfig()` unmodified.
