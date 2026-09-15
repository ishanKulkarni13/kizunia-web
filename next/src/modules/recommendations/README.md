# Recommendations Module

## Purpose

Phase 0 of Kizunia's recommendation capability: `userId -> RecommendationResult`.
Answers "which of the competitions currently open for registration are most
relevant to this user" as a standalone, reusable domain capability — not as
part of the notification system. See
[`docs/architecture/recommendation/README.md`](../../../../docs/architecture/recommendation/README.md)
for the full architecture and
[`docs/project/feature-specification/recommendation/README.md`](../../../../docs/project/feature-specification/recommendation/README.md)
for product scope.

## Folder Structure

```
recommendations/
├── README.md
├── index.ts                 public API (engine, config, DTOs, client — NOT backend/, see index.ts)
├── engine/                   PURE. No Prisma, no I/O.
│   ├── types.ts
│   ├── profile.ts
│   ├── dimensions/
│   ├── eligibility.ts
│   ├── scoring.ts
│   ├── ranking.ts
│   └── pipeline.ts
├── config/
│   └── recommendation-config.ts
├── backend/
│   ├── candidate.repository.ts
│   ├── candidate.service.ts
│   ├── preference-profile.provider.ts
│   ├── recommendation.service.ts
│   ├── mapper.ts
│   └── controller.ts
├── schemas/
│   └── generate-recommendations.ts
├── types/
│   └── recommendation.dto.ts
└── api/
    └── recommendation-api.ts
```

`engine/` is deliberately outside `backend/`, mirroring
`competitions/lifecycle/resolver.ts`: it has no Prisma import and no
server-only dependency. It is a pure function from a normalized preference
profile and a candidate list to a ranked result. `backend/recommendation.service.ts`
is its only real caller in this module; it owns the database access
(`candidate.repository.ts`) and preference loading.

## Phase 0 vs Phase 1

This module implements **Phase 0 only**: recommendation evaluation. It has
no notification creation, history, delivery, queue, or scheduling — see
[`docs/project/feature-specification/recommendation/non-goals.md`](../../../../docs/project/feature-specification/recommendation/non-goals.md).
Phase 1 Notifications is expected to call `RecommendationService`
(or the pure engine directly, if it needs a different candidate source) as
a dependency rather than reimplementing scoring or ranking. See
[`docs/architecture/recommendation/README.md#phase-relationship`](../../../../docs/architecture/recommendation/README.md).

## Phase 0 simplifications (deliberate, temporary)

- **Preference profile is a hardcoded dummy**, the same for every user
  (`DummyPreferenceProfileProvider`). No weighted preference storage exists
  yet; see open decision A-2 in the notification spec. The
  `PreferenceProfileProvider` port is the seam a real, persisted adapter
  will plug into later without changing the engine.
- **No temporal dimensions.** `startDate`, `endDate`, `registrationDeadline`,
  `registrationStartDate` are not scored — they remain ordinary competition
  fields, used only as ranking tiebreakers.
- **Candidate selection reads `Competition.status` only** (`REGISTRATION_OPEN`),
  not timestamps. A documented, deliberate deviation from the notification
  spec's timestamp-based guidance — acceptable for a manual testing surface,
  revisited before Phase 1's cron-driven evaluation relies on it.

## Internal testing route

`/internal/notification/top-competition` — see
[`docs/architecture/recommendation/testing.md`](../../../../docs/architecture/recommendation/testing.md).
Authenticated, not admin-gated; always uses the caller's own session
`userId`.
