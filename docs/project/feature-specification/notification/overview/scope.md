# Scope

> **Status:** Stable
>
> **Last Updated:** 2026-09-12

## What Notifications owns

The Notifications subsystem owns, end to end:

- **Notification intents** — the named business purposes that can produce a notification, and
  their rules.
- **Notification preferences** — which intents a user wants, and their per-intent settings.
- **Competition preference profile** — the user's statement of what they care about, used to
  compute relevance. (Owned here because it exists *for* recommendation; see the caveat below.)
- **Candidate evaluation** — selecting, filtering, scoring, ranking and selecting what a given
  notification will be about.
- **Aggregation** — combining multiple qualifying items into one user-facing notification.
- **Notification records** — the history of every notification occurrence, its delivery state and
  its response state.
- **Delivery orchestration** — deciding that a notification should go out, and handing it to
  whatever delivers it.

## What Notifications does not own

| Not owned | Owner |
| --- | --- |
| Competitions: their data, lifecycle, status derivation | The Competition domain — see [`lifecycle-automation.md`](../../../../architecture/workflows/competition/lifecycle-automation.md) |
| Bookmarks and self-declared registrations | The Competition domain (`CompetitionBookmark`, `CompetitionRegistration`) |
| Search, filtering and sorting surfaces | The [Search subsystem](../../search/README.md) |
| Identity, sessions, authorization | Users and [Authorization](../../../../architecture/authorization/README.md) |
| Messaging, chat, real-time conversation | Not a Kizunia feature |
| Subscription and billing | Future scope — see [`future/entitlements.md`](../future/entitlements.md) |

Notifications **consumes** competition information; it does not extend competition services into
notification services. The competition domain stays responsible for competitions. This boundary
is structural, not stylistic — see
[`module-boundaries.md`](../../../../architecture/notifications/module-boundaries.md).

### On the competition preference profile

The preference profile describes competition attributes, so it is tempting to file it under
Competitions. It is owned by Notifications because its only purpose is to drive relevance for
recommendation, and because it must never leak into the competition browsing experience. A user's
notification preferences do not change what their search results look like. See
[`preferences/filters-vs-preferences.md`](../preferences/filters-vs-preferences.md).

## What Kizunia can and cannot know

This bounds every recipient rule in the subsystem.

Kizunia **can** know:

- That a user bookmarked a competition.
- That a user told Kizunia they registered for a competition.
- That a competition is relevant to a user, as computed from that user's preference profile.

Kizunia **cannot** know:

- Whether a user actually registered with the external organizer.
- Whether a user participated, submitted, or placed.

Therefore there is no "participants" or "registered users" recipient group backed by external
data. *Marked as Registered* is a self-declared Kizunia-side relationship and must never be
presented as organizer-confirmed. This is already enforced in the data model, which deliberately
carries no `source`, no `verifiedAt` and no status enum on `CompetitionRegistration`.

If verified registration data ever becomes available through a trusted integration, that is a new
capability with its own decision — not an assumption the current rules may borrow against.

## Phase 1 scope

Phase 1 implements two intents: `TOP_RELEVANT_COMPETITION` and `REGISTRATION_CLOSING`.

The full in/out list is in [`phase-1/boundaries.md`](../phase-1/boundaries.md). Everything else
discussed during design is recorded in [`future/`](../future/README.md) and is not implemented.
