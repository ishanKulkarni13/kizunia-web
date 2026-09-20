# Recommendation Dimensions

> **Status:** Stable — Phase 0
>
> **Last Updated:** 2026-09-15
>
> **Rulings:** [RD-05](../decisions/README.md#rd-05), [RD-06](../decisions/README.md#rd-06)

Every dimension below was verified against the actual `Competition` model
in `next/prisma/schema.prisma` — none are invented. See
[`../../../architecture/recommendation/dimensions.md`](../../../architecture/recommendation/dimensions.md)
for the technical mapping and the abstraction that lets a dimension be
added without touching the engine.

## Implemented in Phase 0

| Dimension | Domain source |
| --- | --- |
| `mode` | `Competition.mode` |
| `categories` | `Competition.categories` (via `Category.slug`) |
| `technologies` | `Competition.technologies` (via `Technology.slug`) |
| `eligibilities` | `Competition.eligibilities` (`EligibilityType`) |
| `location` | `Competition.locations` -> `Location` -> reachable `SearchArea`s |
| `registrationPlatform` | `Competition.registrationPlatform` |
| `registrationType` | `Competition.registrationType` |
| `registrationFeeType` | `Competition.registrationFeeType` |
| `organizerType` | `Competition.organizerType` |
| `difficulty` | `Competition.difficulty` |
| `certificateType` | `Competition.certificateType` |
| `status` | `Competition.status` |
| `teamSize` | `Competition.minTeamSize` / `maxTeamSize` (containment, not exact match) |
| `competitionType` | `Competition.types` (via `CompetitionType`, `CompetitionTypeRelation`) |

## Deferred (temporarily) — temporal dimensions

`startDate`, `endDate`, `registrationDeadline`, `registrationStartDate` all
exist on `Competition`, but by explicit product direction are **not**
recommendation dimensions in Phase 0. They remain ordinary fields and are
used only as a deterministic ranking tiebreaker (see
[`threshold-and-selection.md`](threshold-and-selection.md)). Reintroducing
one as a scored dimension later is additive: one extractor, one registry
entry, one system weight — see
[`../../../architecture/recommendation/future.md`](../../../architecture/recommendation/future.md).

## Not available — needs a domain decision first

| Requested | Why it is unavailable |
| --- | --- |
| `registrationFee` | `Competition.registrationFee` is a free-text `String?` (max 50 chars), not a numeric amount with a currency. There is no parser for it and inventing one is a product/domain decision, not a Phase 0 one. |

`competitionType` (Hackathon / Ideathon / Quiz / DSA / CP / …) was listed
here as unavailable when this document was last written; the `CompetitionType`
enum and `CompetitionTypeRelation` table were added shortly after, and it is
now implemented — see the table above.

## What "eligibilities has sparse data" means in practice

`CompetitionEligibility` has no write path in the current admin editor —
organizers cannot currently set it. The dimension works correctly (missing
data is a mismatch, as documented in
[`../preferences/missing-data.md`](../preferences/missing-data.md)), but
real competitions will mostly show `MISSING` for it until a write path
exists. This is a data-completeness gap, not an engine limitation.
