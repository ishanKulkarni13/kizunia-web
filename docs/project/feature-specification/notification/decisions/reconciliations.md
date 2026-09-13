# Reconciliations

> **Status:** Live
>
> **Last Updated:** 2026-09-12

The source material for this specification was a set of working documents written over several
design sessions. It contained genuine contradictions, superseded passages and terminology drift.

Each is recorded here with its resolution, so that a future reader who finds the original notes
can see which reading was adopted and why — rather than concluding the specification lost
something.

Source documents: `docs/temp/notificatio-decisions.md`,
`docs/temp/notofication-User-stories.md`, `docs/temp/codebase-recommendation.md`.
`docs/temp/` is a scratch directory and is **not** authoritative.

---

## R-01 — Deduplication is keyed on delivery, not on generation

**Conflict.** One passage stated that once a competition has been surfaced to a user through
`TOP_RELEVANT_COMPETITION`, it can never independently trigger that notification again — with no
qualifier. A later passage stated that `delivered = true` excludes the competition while
`delivered = false` leaves it eligible for future evaluation.

**Resolution.** The later, delivery-qualified rule is authoritative. The unqualified passage
describes the ordinary case, in which the notification was delivered.

**Recorded as:** [ND-H-03](history.md#nd-h-03--delivered-consumes-the-triple-undelivered-does-not),
with [ND-H-04](history.md#nd-h-04--re-evaluation-creates-a-new-record-and-is-not-a-retry).

**Why this reading.** The delivery-qualified statement is more specific, appears later, and is
accompanied by explicit worked examples and a rationale. Reading it the other way would mean a
notification the user never received could permanently deny them that recommendation, which
contradicts the subsystem's stated purpose.

---

## R-02 — `TOP_RELEVANT_COMPETITION` selection count

**Conflict.** The decisions document specified a maximum of one competition, with an on/off
control only. The user stories described aggregating multiple relevant competitions into one
notification ("5 new competitions match your interests", US-06) and a user-configurable
recommendation volume (US-08, US-25).

**Resolution.** Confirmed by product: **Phase 1 selects exactly one.** A multi-competition summary
is a **separate future intent**, not a volume setting on this one.

**Recorded as:** [ND-I-06](intents.md#nd-i-06--top_relevant_competition-selects-exactly-one-competition).
The future digest intent is described in
[`future/notification-intents.md`](../future/notification-intents.md).

**Consequence.** US-06, US-08 and US-25 are classified as future scope in
[`experience/user-stories.md`](../experience/user-stories.md). They are not lost; they are not
Phase 1.

---

## R-03 — Deadline notification preferences

**Conflict.** The decisions document defined one `REGISTRATION_CLOSING` intent with one on/off
toggle, covering both relevant and bookmarked competitions, deduplicated into a single
notification. The user stories described two separately controllable preferences: bookmark
deadline notifications (US-12) and relevant-competition deadline notifications (US-14).

**Resolution.** Confirmed by product: **one intent, one toggle.** Eligibility is "relevant OR
bookmarked", deduplicated into one user-facing notification.

**Recorded as:** [ND-I-11](intents.md#nd-i-11--eligibility-is-relevant-or-bookmarked-excluding-marked-as-registered),
[ND-I-12](intents.md#nd-i-12--one-notification-per-deadline-event),
[ND-P-12](preferences.md#nd-p-12--notification-preferences-are-per-intent-and-separate).

**Consequence.** Independently switchable eligibility relationships remain a plausible future
refinement, recorded in [`future/README.md`](../future/README.md). Splitting them later does not
require restructuring the intent.

---

## R-04 — Bookmark, not wishlist

**Conflict.** The user stories used "wishlist" and "waitlist" interchangeably with "bookmark",
while also instructing that the bookmark terminology be used.

**Resolution.** **Bookmark** throughout. The feature is implemented as `CompetitionBookmark`;
"wishlist" and "waitlist" do not appear in this specification except in this note.

**Recorded as:** [`overview/glossary.md`](../overview/glossary.md#terms-that-are-deliberately-not-used).

---

## R-05 — Explicit non-goals, not deferrals

**Conflict.** The user stories listed several capabilities in the same lists as future work, but
annotated some of them as things that will not be built.

**Resolution.** The following are **non-goals**, not deferred work:

| Item | Source | Status |
| --- | --- | --- |
| US-21 — Mark competition as participated | Annotated "wont impliment"; only "mark as registered" will exist | **Will not build** |
| US-18 — Competition started notification | Annotated as not being implemented | **Will not build** |
| Competition completed notification | Annotated "intentionally excluded" | **Will not build** |

**Recorded as:** [`experience/user-stories.md`](../experience/user-stories.md) and
[`phase-1/boundaries.md`](../phase-1/boundaries.md).

**Why this distinction matters.** A deferred item is a commitment with no date. A non-goal is a
decision. Filing non-goals under "future" would quietly turn them back into roadmap.

---

## R-06 — The previous Notifications feature specification is superseded

**Conflict.** `docs/project/feature-specification/notifications.md` described a different
subsystem: hackathon terminology, team and project notification categories, priority levels
(Critical/High/Normal/Low), delivery channels including email and push as near-term, and a future
list including digests, smart scheduling and calendar integration.

**Resolution.** That document is superseded by this directory and has been replaced with a pointer
to it. Its content is **not** carried forward as current behavior.

Specifically:

| Element of the old spec | Disposition |
| --- | --- |
| Team and project notification categories | Not in Phase 1; no ruling exists. Not carried forward |
| Priority levels | No ruling exists. Not carried forward |
| Email / push / browser channels | [`future/channels.md`](../future/channels.md) |
| Digests, smart scheduling, quiet hours, calendar integration | [`future/`](../future/README.md) |
| "Hackathon" as the entity name | Superseded by **Competition** |

**Why.** The old specification predates every decision recorded here and describes intents that
were never designed. Keeping it alongside this set would leave two documents claiming to describe
the same subsystem.

---

## R-07 — Documentation path

**Conflict.** The engineering requirements specified `docs/project/feature-specs/notification/`.
The repository's existing convention is `docs/project/feature-specification/`.

**Resolution.** Confirmed by product: the repository convention wins. The documentation lives at
`docs/project/feature-specification/notification/`. No `feature-specs/` directory is created.

---

## R-08 — Structural duplication in the source document

**Observation, not a conflict.** The decisions document contained duplicated section numbering
(two separate blocks numbered 19 through 24), a placeholder heading of keyboard noise, and several
decisions restated in more than one place with slightly different emphasis.

**Resolution.** Every decision was extracted once, given a stable ID, and placed in exactly one
owning document. Where two passages stated the same rule, the more specific and later formulation
was used; where they genuinely disagreed, the disagreement is recorded above.

No decision from the source material was dropped. The traceability mapping is in
[README.md](README.md#source-traceability) and
[`experience/user-stories.md`](../experience/user-stories.md).
