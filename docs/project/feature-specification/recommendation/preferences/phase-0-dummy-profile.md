# Phase 0's Preference Source: A Dummy Profile

> **Status:** Stable — Phase 0, explicitly temporary
>
> **Last Updated:** 2026-09-15
>
> **Rulings:** [RD-04](../decisions/README.md#rd-04)

## The problem

`userId -> RecommendationResult` needs a preference profile to score
against, and no weighted preference storage exists anywhere in the schema.
`NotificationPreference` is legacy, untyped (`preferences Json?`), and
flagged as blocking open decision A-2 in
[`../../notification/open-decisions.md`](../../notification/open-decisions.md) —
Phase 0 does not resolve that decision.

## The decision

Phase 0 does **not** derive a preference profile from `User.interests`,
`UserCategory`, portfolio data, or any other existing user field. By
explicit product direction, `interests`/`UserCategory` has been **removed**
from the domain entirely (see the schema migration
`remove_user_category_interests`) rather than repurposed as a preference
signal — using an interests list designed for a different purpose as a
stand-in for a weighted preference profile would answer open decision A-2
by accident, with a shape nobody chose on purpose.

Instead, every user gets the same **hardcoded, representative** profile
from `DummyPreferenceProfileProvider`:

```text
categories:            AI -> 0.9, Web Dev -> 0.4     (soft — see note below)
technologies:          Python -> 0.6
registrationFeeType:   Free -> 0.8
difficulty:            Intermediate -> 0.5
eligibilities:         Undergraduate -> 1.0           (hard constraint)
```

`AI` is `0.9`, not `1.0`, deliberately: a weight of exactly `1` would trigger
hard-constraint dominance (see
[`weights-and-constraints.md`](weights-and-constraints.md)) and make
`categories` a hard dimension where only `AI` is acceptable — silently
excluding every non-AI competition, including ones that should still
surface at a lower score for their `Web Dev` match. `Undergraduate` *is*
meant as a genuine hard constraint (the scenario's `D` case exists
specifically to exercise hard rejection), so it correctly stays at `1.0`.

This is deliberately the same profile used to validate the engine's
behavior conceptually — see the controlled scenario in
[`../../../architecture/recommendation/testing.md`](../../../architecture/recommendation/testing.md).

## Why this is acceptable for Phase 0

The stated goal of Phase 0 is a reusable **engine**, validated end-to-end
against a real `userId`, real candidate competitions, and a real pipeline
run — not a personalization feature. A fixed profile exercises every stage
(profile normalization, eligibility, dimension matching, scoring,
threshold, ranking, Top-N) exactly as a real one would; only the
*source* of the profile is temporary.

## The seam for what replaces it

`PreferenceProfileProvider` (`backend/preference-profile.provider.ts`) is a
port:

```ts
interface PreferenceProfileProvider {
  load(userId: string): Promise<PreferenceProfile>;
}
```

When a real, persisted preference model exists (resolving A-2), a new
adapter implements this interface and replaces `DummyPreferenceProfileProvider`
in `RecommendationService`. Nothing in the engine, candidate selection, or
scoring changes — this is precisely the kind of substitution the port
exists to make cheap.
