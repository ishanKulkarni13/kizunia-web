# Non-Goals

> **Status:** Stable — Phase 0
>
> **Last Updated:** 2026-09-15

Phase 0 does **not** implement any of the following. Most of these belong to
Phase 1 Notifications (specified in [`../notification/`](../notification/README.md));
a few are recorded as future work in
[`../../../architecture/recommendation/future.md`](../../../architecture/recommendation/future.md).

## Notification concerns (Phase 1)

Notification creation, notification history, notification delivery (email,
push, in-app), a notification inbox, a notification queue, cron/scheduled
execution, daily digests, retry mechanisms, delivery channels, notification
deduplication, or any notification persistence. Phase 0 produces a
`RecommendationResult` and stops.

## Location

Distance calculation, radius scoring, kilometers, or any geographic
proximity scoring. Phase 0's location dimension is match/mismatch only —
see [`relevance/location-matching.md`](relevance/location-matching.md).

## Scale / performance

User clustering, similar-user recommendations, recommendation caching,
large-scale precomputation, distributed processing, batch recommendation
generation across users, or parallel recommendation execution. Phase 0
evaluates one user at a time.

## Preference persistence

A real, persisted, weighted preference model. No schema migration adds one
in Phase 0 — see
[`preferences/phase-0-dummy-profile.md`](preferences/phase-0-dummy-profile.md)
and open decision A-2 in
[`../notification/open-decisions.md`](../notification/open-decisions.md),
which Phase 0 deliberately leaves open. A preference-editing UI is likewise
out of scope.

## Temporal dimensions

`startDate`, `endDate`, `registrationDeadline` and `registrationStartDate`
are not recommendation dimensions in Phase 0 — they are not matched against
user preferences or scored. They remain ordinary competition fields, used
only as a ranking tiebreaker. See
[`relevance/dimensions.md`](relevance/dimensions.md) and
[`../../../architecture/recommendation/future.md`](../../../architecture/recommendation/future.md).

## Configuration surface

An admin configuration UI, database-stored algorithm configuration, or any
dynamic user-defined pipeline. Phase 0's configuration
(`config/recommendation-config.ts`) is code, owned by developers.

## ML

Any machine-learning relevance signal. The architecture is built so one
could be introduced later without a rewrite — see
[`../../../architecture/recommendation/extensibility.md`](../../../architecture/recommendation/extensibility.md)
— but none exists in Phase 0.
