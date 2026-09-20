# Future Notification Intents

> **Status:** Direction only — none of these are implemented
>
> **Last Updated:** 2026-09-12

Intents Kizunia expects to want. Each entry records what was already decided during design, so that
a future implementation starts from the discussion rather than repeating it.

**None of these exist.** They must not appear in code, in an enum, or in the user interface until
each has its own specification in [`intents/`](../intents/README.md) and its own ruling in
[`decisions/intents.md`](../decisions/intents.md).

---

## Competition discovery digest

**Story:** US-06, US-08, US-25

A second discovery intent that aggregates several relevant competitions into one summary, in the
shape of *"5 new competitions match your interests"*, with a user-configurable volume.

**Why it is a separate intent, not a setting.** Phase 1's `TOP_RELEVANT_COMPETITION` surfaces
exactly one competition and has no volume control
([ND-I-06](../decisions/intents.md#nd-i-06--top_relevant_competition-selects-exactly-one-competition)).
A single confidently chosen recommendation and a digest are different products with different
cadences, different selection policies and different deduplication implications. Bolting a count
onto the Phase 1 intent would blur both.

**Already established:** aggregation mechanics are proven by `REGISTRATION_CLOSING`
([ND-I-13](../decisions/intents.md#nd-i-13--registration_closing-aggregates-into-one-summary)),
and the relevance floor still applies — a digest is never padded to reach its target
([ND-R-02](../decisions/relevance.md#nd-r-02--the-minimum-threshold-is-a-floor-never-lowered-for-quota)).

**Undecided:** cadence, how it interacts with the single-competition intent's discovery history,
and whether both intents can be enabled at once.

---

## `REGISTRATION_OPENED`

**Story:** US-15 · **Ruling:** [ND-I-15](../decisions/intents.md#nd-i-15--registration_opened-is-outside-phase-1)

Notify when registration opens for a competition relevant to the user or one they are tracking.

**Already established:** Phase 1 gets the practical outcome without it — a competition becoming
registration-open naturally becomes eligible for the next discovery evaluation
([ND-I-09](../decisions/intents.md#nd-i-09--becoming-registration-open-needs-no-separate-lifecycle-notification)).

**Undecided:** behavior, recipient rules, timing and preference controls. The architecture must
remain able to support it without redesigning the core notification model.

---

## `REGISTRATION_CLOSED`

**Story:** US-17 · **Ruling:** [ND-I-14](../decisions/intents.md#nd-i-14--no-standalone-registration_closed-notification)

Notify when registration closes for a tracked competition.

**Already established:** deliberately not built in Phase 1, because after closure the user can no
longer register and the notification carries little actionable value. If it is ever built, it would
be an informational notification for tracked competitions only, and disabled by default.

---

## `COMPETITION_CANCELLED`

**Story:** US-19

Notify when a tracked competition is cancelled.

**Relevance to Phase 1:** this is the intent that would make the
[pre-delivery validation filter](README.md) matter less — but the two are independent. Phase 1
currently sends a `REGISTRATION_CLOSING` notification even for a competition cancelled after
generation
([ND-I-17](../decisions/intents.md#nd-i-17--competition-state-is-not-re-validated-before-delivery-in-phase-1)).

**Undecided:** recipients, timing, and whether cancellation suppresses other pending notifications
for the same competition.

---

## Admin-designated competition updates

**Stories:** US-22, US-23

An admin decides that a competition update is important enough to notify about, and chooses who
receives it.

**Already established as the design position:**

- The **admin** decides whether an update warrants a notification. This deliberately avoids making
  the notification system understand whether an arbitrary field change is important.
- The admin also determines the recipients.
- Recipients may only be drawn from relationships Kizunia actually knows — bookmarked users, users
  who marked themselves registered, relevant users. Kizunia must **not** assume it knows who
  registered externally
  ([ND-I-16](../decisions/intents.md#nd-i-16--recipient-rules-use-only-relationships-kizunia-knows)).

**Undecided:** the admin surface, recipient-group semantics, and how an admin-triggered evaluation
reuses the same pipeline — see
[`event-and-admin-triggers.md`](../../../../architecture/notifications/triggers/event-and-admin-triggers.md).

---

## Portfolio contact notification

**Story:** US-27

Notify a user when someone submits a contact form through their portfolio.

**Significance:** this would be the **first non-competition intent**, and is therefore the real
test of whether the subsystem is a notification platform or a competition feature with extra steps.
It has no relevance scoring, no ranking and no aggregation — just an event and a recipient — which
exercises a very different path through the pipeline.

**Also noted:** identified as a potentially paid capability — see
[entitlements.md](entitlements.md).

---

## Platform notifications

**Stories:** US-28 (feature announcements), US-29 (promotional)

Announcements about new Kizunia functionality, and promotional communication the user can decline.

**Undecided:** everything, including whether these are per-user notifications at all or a
broadcast surface. Promotional notifications in particular carry consent implications that have not
been considered.

---

## Subscription notifications

**Story:** US-30

Notifications about the user's own subscription, such as expiry.

**Position:** architectural space should be left for them without designing the subscription domain
now. See [entitlements.md](entitlements.md).

---

## What every future intent must do

Whatever gets built, it answers the same contract as the two existing intents — purpose, kind,
trigger, user eligibility, candidate rule, exclusions, selection policy, aggregation, dedup scope,
user preference — before any code is written. See [`intents/README.md`](../intents/README.md).
