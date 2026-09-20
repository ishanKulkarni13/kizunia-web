# `REGISTRATION_CLOSING`

> **Status:** Stable — Phase 1
>
> **Last Updated:** 2026-09-12
>
> **Rulings:** [ND-I-10](../decisions/intents.md#nd-i-10--registration_closing-targets-2-days-before-the-deadline)
> through [ND-I-14](../decisions/intents.md#nd-i-14--no-standalone-registration_closed-notification),
> [ND-P-13](../decisions/preferences.md#nd-p-13--registration_closing-exposes-a-user-configurable-maximum)

---

## Summary

| Element | Value |
| --- | --- |
| **Kind** | Deadline |
| **Purpose** | Give the user a chance to register before registration closes |
| **Trigger** | Scheduled deadline evaluation |
| **Timing** | 2 days before the actual registration deadline timestamp (temporary, simple rule — see below) |
| **User eligibility** | Intent enabled, required capability available |
| **Candidate rule** | Competition is **relevant to** or **bookmarked by** the user |
| **Exclusions** | User has marked the competition as Registered |
| **Selection** | Top 3 to 5, bounded by the user's configured maximum |
| **Aggregation** | One summary notification |
| **Dedup scope** | One notification per user per deadline event |
| **User preference** | On / Off, plus a maximum |

---

## Purpose

`REGISTRATION_CLOSING` is an actionable deadline notification. Its purpose is to give the user an
opportunity to register **before registration closes**.

Unlike `TOP_RELEVANT_COMPETITION`, it is not about discovery. The user may already know about the
competition — the point is the clock.

---

## Timing

The initial notification timing is **2 days before the actual registration deadline timestamp**.

The calculation is based on the real deadline timestamp, **not** simply the second-previous
calendar day. Measuring against the exact timestamp avoids the ambiguity calendar-day framing would
introduce for a deadline at 23:00 vs. one at 01:00.

**This is a temporary, simple rule** (ND-I-10), chosen because it is coarse enough for a daily
scheduled sweep to approximate without sub-day scheduling precision — not because 2 days is
inherently the right lead time. Notification timing may become dynamically/smartly determined later
without requiring a different persistence model; see [`future/README.md`](../future/README.md).

The deadline itself comes from the competition's `registrationDeadline`. Note that the competition
domain treats the deadline as exclusive — at the exact instant `now` equals the deadline,
registration is closed, not still open. See
[`lifecycle-automation.md`](../../../../architecture/workflows/competition/lifecycle-automation.md).

> **Open:** a scheduled job cannot fire at an arbitrary instant for every competition. The
> evaluation window that approximates T-2d — for example, "deadline falls within the next 2 to 3
> days, and no notification has been sent for this deadline event" — is **not decided** and must
> be resolved before implementation. See [`open-decisions.md`](../open-decisions.md).

---

## Recipient eligibility

A user can receive this notification when the competition is either:

- **relevant** to the user; **or**
- **bookmarked** by the user.

and the user has **not** marked the competition as Registered.

```text
Relevant                 ->  eligible
Bookmarked               ->  eligible
Relevant + Bookmarked    ->  eligible
Marked as Registered     ->  excluded
```

Being bookmarked is **not required** when the competition is already relevant to the user. The two
relationships are alternatives, not a conjunction.

### Why relevance counts, not just bookmarks

A bookmark is an explicit save: *"I want to come back to this."* Relevance is a computed match:
*"this looks like something you'd want."* Both are legitimate reasons to care about a closing
deadline, and restricting deadline notifications to bookmarks would mean Kizunia knew about a
matching opportunity and stayed quiet while it expired.

### Marked as Registered

Kizunia does not know whether a user actually registered for an external competition. It knows only
that the user **explicitly told Kizunia** they did.

A user who has marked a competition as Registered is excluded, because the notification's purpose —
prompting them to register — no longer applies to them.

This is a Kizunia-side, user-declared relationship. It must never be treated as verified external
registration data, and no "participants" or "registered users" recipient group may be inferred from
it
([ND-I-16](../decisions/intents.md#nd-i-16--recipient-rules-use-only-relationships-kizunia-knows)).
The data model enforces the same posture: `CompetitionRegistration` deliberately carries no
`source`, no `verifiedAt` and no status enum.

---

## Deduplication

If a user qualifies through more than one relationship, Kizunia generates **only one** user-facing
registration-closing notification for the same deadline event.

If a competition is both relevant and bookmarked:

- the user receives **one** notification;
- Kizunia must **not** send one because it is relevant and another because it is bookmarked.

The different eligibility relationships may be retained internally if useful — for analytics, or to
explain why the user received it — but they must not create duplicate user-facing notifications.

The user experiences one deadline, so they get one notification. Qualifying twice is a system
detail.

---

## Aggregation

Multiple competitions may satisfy the criteria at the same time. Rather than sending a separate
notification for every competition, Kizunia aggregates the strongest candidates into **one summary
notification**.

```text
Top 3 to 5 competitions
        │
One aggregated notification
```

For example:

> **Registration closing soon**
>
> 4 competitions relevant to you have registration deadlines approaching.

The exact presentation and wording, and whether a given batch contains 3, 4 or 5 depending on the
available qualified candidates, are UX and implementation details.

The governing principle still applies:

> **Relevance produces the ranking; notification policy determines how many ranked candidates are
> selected.**

The count is bounded by three things — the policy's target, the user's configured maximum, and how
many candidates clear the relevance floor. The floor is never lowered to fill the summary
([`relevance/threshold-and-selection.md`](../relevance/threshold-and-selection.md)).

---

## The full flow

```text
Eligible user
    │  intent enabled
    │  required capability available
    ▼
Competitions approaching their registration deadline
    ▼
Relevant to the user OR bookmarked by the user
    ▼
Exclude competitions marked as Registered
    ▼
Collapse multiple qualifying relationships to one
    ▼
Rank qualified competitions
    ▼
Apply minimum threshold
    ▼
Select top 3 to 5, bounded by the user's configured maximum
    ▼
Aggregate into one summary notification
    ▼
Queue
    ▼
Deliver
```

---

## No `REGISTRATION_CLOSED` notification

A standalone "registration has closed" notification is **not** implemented in Phase 1.

```text
Registration closing  ->  notify before closure
Registration closed   ->  no standalone notification
```

The purpose of the deadline notification is to let the user act while registration is still
available. After closure they can no longer register through the normal process, so a
"registration closed" message provides little actionable value.

---

## User preference

On / Off, plus a configurable **maximum** number of competitions in the summary.

One toggle covers both eligibility relationships. Splitting relevant-deadline and bookmark-deadline
into independent toggles is a plausible future refinement, recorded at
[R-03](../decisions/reconciliations.md#r-03--deadline-notification-preferences).

---

## Known gaps

- **The evaluation window** approximating T-2d is undecided (above, and in
  [`open-decisions.md`](../open-decisions.md)).
- **Where "relevant to the user" comes from** for this intent — recomputed at evaluation time, or
  read from stored relevance produced by the discovery pipeline — is undecided and has real cost
  and correctness consequences. See
  [`candidate-selection.md`](../../../../architecture/notifications/recommendation/candidate-selection.md).
- **Cancelled competitions.** Because Phase 1 does not re-validate competition state before
  delivery, a notification for a competition cancelled after generation is still sent
  ([ND-I-17](../decisions/intents.md#nd-i-17--competition-state-is-not-re-validated-before-delivery-in-phase-1)).
  This is deliberate, and is the canonical example of a future pipeline filter.
- **Deadline changes.** What happens if an organizer moves the deadline after a notification has
  been generated is not specified.
