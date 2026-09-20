# Decisions — Intents

> **Status:** Live
>
> **Last Updated:** 2026-09-17

Rulings covering the notification types themselves. Full per-intent behavior is written out in
[`intents/`](../intents/README.md).

---

## ND-I-01 — Phase 1 implements exactly two intents

**Status:** Accepted

The initial notification implementation is intentionally limited to `TOP_RELEVANT_COMPETITION` and
`REGISTRATION_CLOSING`. Additional notification capabilities come later.

The architecture must support future intents without requiring the Phase 1 foundation to be
redesigned.

**Rationale:** Two intents are enough to prove the platform is genuinely general — one discovery,
one deadline, with different triggers, different eligibility rules and different selection
policies — while keeping the surface small enough to get right.

**See:** [`phase-1/boundaries.md`](../phase-1/boundaries.md).

---

## ND-I-02 — `TOP_RELEVANT_COMPETITION` is a discovery notification

**Status:** Accepted

Its purpose is to introduce a competition to a user when Kizunia determines it is sufficiently
relevant to their preferences. It is not a recurring reminder about a competition the user has
already been shown.

**Rationale:** Discovery and reminding are different jobs with different dedup rules. Merging them
would make "have I told you about this?" unanswerable.

---

## ND-I-03 — `TOP_RELEVANT_COMPETITION` requires registration to be currently open

**Status:** Accepted

A competition can be considered only while its registration is open. Whether the competition
itself has started is irrelevant — an `ONGOING` competition with open registration is still a
valid candidate.

```text
Registration not yet open    cannot be recommended
Registration open            can be recommended
Registration closed          cannot be recommended
```

**Rationale:** The notification exists to produce an action the user can actually take. A
competition the user cannot enter is not an opportunity.

---

## ND-I-04 — Daily midnight evaluation, with the trigger separated from the logic

**Status:** Accepted

`TOP_RELEVANT_COMPETITION` is evaluated by a scheduled discovery job, initially once per day at
midnight.

The schedule is only a trigger. The recommendation logic must remain independent of the scheduler,
so it can later be invoked by other mechanisms without duplicating business logic.

**Rationale:** Triggers change far more often than rules. Admin-initiated runs, event-driven
evaluation and backfills must all reuse the same logic.

**Amended:** the hour is now configuration rather than literally midnight, and the run is one
global run rather than per-user local time — see
[ND-I-23](#nd-i-23--the-daily-evaluation-is-one-global-run-at-a-configured-hour). The cadence and
the trigger/logic separation this ruling establishes are unchanged.

**See:** [`scheduled-evaluation.md`](../../../../architecture/notifications/triggers/scheduled-evaluation.md).

---

## ND-I-05 — A scheduled run is not a reason to notify

**Status:** Accepted

A daily evaluation does not mean every eligible user receives a notification every day. If there
are no sufficiently relevant new opportunities, no notification is generated.

**Rationale:** The alternative is a daily message whose only guarantee is that it exists. Silence
is a valid and frequent outcome.

---

## ND-I-06 — `TOP_RELEVANT_COMPETITION` selects exactly one competition

**Status:** Accepted

The intent surfaces at most one competition per evaluation. Its purpose is individual discovery:
*"here is a competition that is particularly relevant to you."* There is no user-configurable
volume for this intent.

**Rationale:** A single, confidently chosen recommendation is a different product from a digest,
and is the one being built first. A multi-competition summary is a **separate future intent**, not
a setting on this one — see [`future/notification-intents.md`](../future/notification-intents.md).

**Reconciliation:** the source user stories described an aggregated "5 new competitions match your
interests" notification with a configurable volume. That is future scope, not Phase 1 — see
[reconciliations.md](reconciliations.md#r-02--top_relevant_competition-selection-count).

---

## ND-I-07 — Registration reopening does not reset discovery history

**Status:** Accepted

If registration closes and later reopens, the competition may become actionable again, but the
user's discovery history is unaffected:

- never previously surfaced to this user → may be considered again;
- already surfaced to this user → must not generate another discovery notification.

If reopening carries information worth communicating, that belongs to a lifecycle or
competition-update notification, not to a repeated discovery notification.

**Rationale:** Discovery happens once. A reopened competition is not a new discovery for someone
who has already seen it.

---

## ND-I-08 — Freshness means newly actionable, not newly created

**Status:** Accepted

A competition does not need to be new on Kizunia to be a new discovery opportunity. A competition
that existed with registration not yet open becomes an opportunity when registration opens.

Recommendation freshness must therefore not be defined solely by creation date.

**Rationale:** Most competitions are listed well before they open. Keying discovery on creation
date would surface them at the one moment the user cannot act.

---

## ND-I-09 — Becoming registration-open needs no separate lifecycle notification

**Status:** Accepted

When a competition moves from `UPCOMING` to `REGISTRATION_OPEN`, it naturally becomes eligible for
the next `TOP_RELEVANT_COMPETITION` evaluation, provided all eligibility, preference, relevance,
threshold and history rules are satisfied.

No separate lifecycle-triggered notification is required for this transition in Phase 1.

**Rationale:** The discovery intent already covers the user-visible outcome. A dedicated
"registration opened" notification would mostly duplicate it.

**Note:** an explicit `REGISTRATION_OPENED` intent is still possible later (ND-I-15); this ruling
only says Phase 1 does not need one to get the behavior.

---

## ND-I-10 — `REGISTRATION_CLOSING` targets 2 days before the deadline

**Status:** Accepted (amended)

`REGISTRATION_CLOSING` is an actionable deadline notification. Initial timing is 2 days before
the actual registration deadline **timestamp** — not simply the second-previous calendar day.

**Rationale:** "N days before" measured against the exact timestamp avoids the ambiguity of
calendar-day framing (a deadline at 23:00 vs. one at 01:00). 2 days, rather than the originally
considered 24 hours, is a deliberately coarse, simple rule for the current implementation — coarse
enough that a daily scheduled sweep (the same cadence already used for `TOP_RELEVANT_COMPETITION`,
ND-I-04) can approximate it without needing sub-day scheduling precision.

**This value is explicitly temporary.** It is a simple placeholder, not a permanent architectural
invariant. Notification timing may become dynamically or "smartly" determined later (e.g. varying
by competition, user behavior, or channel) without that being a breaking change to this ruling —
implementing dynamic timing is future work, tracked in
[`future/README.md`](../future/README.md), not committed to here.

**Amended:** originally 24 hours before the deadline. Changed to 2 days to simplify the scheduling
story (see below) while the notification delivery system itself remains unbuilt.

**Resolved:** a scheduled job cannot fire at an arbitrary instant, so the evaluation window that
approximates T-2d is a band one sweep-interval wide — see
[ND-I-19](#nd-i-19--the-deadline-evaluation-window-is-a-daily-band-not-an-instant).

---

## ND-I-11 — Eligibility is relevant OR bookmarked, excluding marked-as-registered

**Status:** Accepted

| Relationship | Eligible |
| --- | --- |
| Relevant to the user | Yes |
| Bookmarked by the user | Yes |
| Both | Yes |
| Marked as Registered | **No** |

Being bookmarked is not required when the competition is already relevant.

A user who marked a competition as Registered is excluded, because the notification's purpose —
prompting them to register — no longer applies. This is a Kizunia-side self-declared relationship
and must never be treated as verified external registration data (ND-I-16).

**Rationale:** Both an explicit save and a computed match are legitimate reasons to care about a
deadline. Telling someone to register for something they have said they already registered for is
the clearest possible signal that the system is not paying attention.

---

## ND-I-12 — One notification per deadline event

**Status:** Accepted

If a user qualifies through more than one relationship, Kizunia generates only one user-facing
registration-closing notification for that deadline event. It must not send one because the
competition is relevant and another because it is bookmarked.

The distinct eligibility relationships may be retained internally if useful, but must not produce
duplicate user-facing notifications.

**Rationale:** The user experiences one deadline, so they get one notification. Qualifying twice
is a system detail.

---

## ND-I-13 — `REGISTRATION_CLOSING` aggregates into one summary

**Status:** Accepted

Multiple competitions may satisfy the criteria at once. Rather than one notification per
competition, Kizunia aggregates the strongest candidates into a single summary notification,
targeting the top 3 to 5, bounded by the user's configured maximum (ND-P-13).

Example shape:

> **Registration closing soon**
> 4 competitions relevant to you have registration deadlines approaching.

Exact presentation and wording, and whether a given batch contains 3, 4 or 5 depending on
qualified candidates, are UX and implementation details.

**Rationale:** Deadlines cluster. Without aggregation a busy week becomes a notification storm,
which is the failure mode this subsystem is built to avoid.

---

## ND-I-14 — No standalone `REGISTRATION_CLOSED` notification

**Status:** Accepted

Phase 1 does not implement a standalone "registration has closed" notification.

```text
Registration closing   notify before closure
Registration closed    no standalone notification
```

**Rationale:** The point of a deadline notification is to enable action while action is still
possible. After closure the user can no longer register, so the notification carries little
actionable value.

---

## ND-I-15 — `REGISTRATION_OPENED` is outside Phase 1

**Status:** Accepted

`REGISTRATION_OPENED` is not implemented. Its behavior, recipient rules, timing and preference
controls will be decided later. The architecture must remain capable of supporting it without a
redesign of the core notification model.

**Rationale:** ND-I-09 already delivers the practical outcome through discovery. A dedicated
intent needs its own recipient and dedup rules, which have not been designed.

---

## ND-I-16 — Recipient rules use only relationships Kizunia knows

**Status:** Accepted

Competition-related recipient rules may use only:

- relevant to the user;
- bookmarked by the user;
- marked as Registered by the user.

Kizunia must not introduce an external "Participants" or "Registered Users" recipient group unless
verified registration data becomes available through a future trusted integration.

**Rationale:** Kizunia is a discovery platform, not the organizer, and has no channel to confirm
external registration. The data model already encodes this — `CompetitionRegistration` deliberately
carries no `source`, no `verifiedAt` and no status enum, because each would imply a verification
pipeline that does not exist.

---

## ND-I-17 — Competition state is not re-validated before delivery in Phase 1

**Status:** Accepted (deliberate Phase 1 limitation)

Once a notification is generated, Kizunia does not perform another competition-state validation
immediately before delivering it. If a competition is cancelled between generation and delivery,
the notification is still sent.

```text
Registration closes tomorrow
    -> REGISTRATION_CLOSING generated
    -> competition is cancelled
    -> notification is still sent
```

**Rationale:** The window is short and the failure is mild, whereas a pre-delivery validation
stage requires the delivery path to re-enter domain logic. Phase 1 accepts the staleness.

**Future:** this is the canonical example of a future pipeline filter — see
[`extension-points.md`](../../../../architecture/notifications/pipeline/extension-points.md).

---

## ND-I-18 — The notification model is client-agnostic

**Status:** Accepted

Phase 1 is designed around the Kizunia web application, but the notification model and generation
logic must not be conceptually tied to the web client. The system must be able to support
additional clients later, including an Expo/mobile application.

> Web first, with future mobile/Expo support.

**Rationale:** Client coupling is the kind of assumption that is invisible until a second client
exists and then expensive. Keeping generation independent of delivery (see
[`generation-vs-delivery.md`](../../../../architecture/notifications/delivery/generation-vs-delivery.md))
costs almost nothing now.

---

## ND-I-19 — The deadline evaluation window is a daily band, not an instant

**Status:** Accepted — resolves open item A-1

`REGISTRATION_CLOSING` targets 2 days before the deadline
([ND-I-10](#nd-i-10--registration_closing-targets-2-days-before-the-deadline)). A scheduled job
cannot fire at an arbitrary instant for every competition, so the target is approximated by a
**band one sweep-interval wide**, anchored on the scheduler's evaluation time:

```text
window = [ anchor + offset,  anchor + offset + sweepInterval )
```

With the current daily sweep and a 2-day offset, that is "deadlines falling between 2 and 3 days
from now". Both the offset and the band width are configuration, not constants in the logic.

The anchor is stamped by the scheduler and carried in the job payload
([ND-D-07](delivery.md#nd-d-07--occurrence-identity-is-decided-by-the-scheduler-never-by-the-worker)),
so a retried job re-evaluates the **same** window rather than a shifted one.

**Rationale:** a band exactly one sweep-interval wide is the only shape that covers every deadline
exactly once — narrower leaves gaps where a deadline is never caught, wider double-counts and
relies entirely on deduplication to stay correct. Deriving the width from the sweep interval rather
than hard-coding "2 to 3 days" means changing the cadence does not silently break coverage.

---

## ND-I-20 — Deadline relevance is recomputed per user, not stored

**Status:** Accepted — resolves open item A-4

`REGISTRATION_CLOSING` determines "relevant to the user" by running the existing recommendation
engine for that user at evaluation time, then **intersecting** its ranked output with the
competitions whose deadlines fall in the window. Bookmarked competitions in the window are unioned
in, and competitions the user marked as registered are excluded
([ND-I-11](#nd-i-11--eligibility-is-relevant-or-bookmarked-excluding-marked-as-registered)).

```text
per user:  engine run once  ->  ranked set
           ∩ competitions with deadlines in window
           ∪ bookmarks with deadlines in window
           − marked as registered
           -> rank, take top N, aggregate
```

A-4 named the real cost problem: evaluating "all near-deadline competitions against all eligible
users" inside one invocation. Evaluating **per user** dissolves it. One engine run per enabled user
is the same cost shape the discovery sweep already has, each user is an independent unit of work,
and the whole sweep is therefore bounded and resumable.

**Alternative rejected:** persisting relevance results for the deadline intent to read later. That
introduces staleness, a second source of truth for relevance, and a storage model whose
invalidation rules nobody has designed — to avoid a cost that the per-user framing removes anyway.

**Rationale:** relevance has exactly one owner, the recommendation engine
([principle 3](../../../../architecture/notifications/principles.md)). Recomputing from it keeps
that true. Caching it would make the notification system the second place relevance lives, which is
the boundary this subsystem exists to protect.

---

## ND-I-21 — `FEATURE_ANNOUNCEMENT` is an admin-authored, scheduled broadcast

**Status:** Accepted

An authorized administrator may author a platform announcement carrying a title, a message and an
optional link, and schedule when it is delivered.

| Element | Value |
| --- | --- |
| **Kind** | Platform / editorial |
| **Purpose** | Tell users about something new on Kizunia |
| **Trigger** | Admin authorship plus a scheduled delivery time |
| **Timing** | The author's chosen time. Immediate delivery is a special case, not the model |
| **Recipients** | Every user with the intent enabled |
| **Selection** | None. There is no ranking or relevance |
| **Aggregation** | None. One announcement is one notification |
| **Dedup scope** | One notification per user per announcement |
| **User preference** | On / Off |

Three things this intent deliberately is **not**: it has no audience segmentation, no targeting
rules, and no campaign or variant model. Targeting is a broadcast to everyone who has the intent
enabled, and nothing else.

**Rationale:** this is the first intent whose subject is not a competition, which is exactly what
principle 1 asked the architecture to absorb without structural change — it is worth having for
that reason alone. Keeping targeting to a flat broadcast is what stops it from becoming the
marketing-campaign platform the non-goals explicitly exclude. Segmentation can be added later as a
recipient rule; it cannot be removed later once products depend on it.

---

## ND-I-22 — An announcement is scheduled, and scheduling is the general case

**Status:** Accepted

An announcement moves through authorship, scheduling, fan-out and delivery as distinct states. Its
delivery time is a property of the announcement, not an assumption of the system.

```text
draft -> scheduled -> publishing -> published
```

"Send it now" is expressed as a schedule time of now. There is no separate immediate path.

Fan-out across the user base is **resumable**: it proceeds in bounded pages and records its own
progress, so an interrupted run continues from where it stopped rather than restarting or
double-sending.

**Rationale:** an announcement is the one notification a human is watching the clock for, and the
one most likely to be written hours before it should appear. Building the immediate case first and
retrofitting scheduling would mean two paths through fan-out, only one of which would be well
tested.

---

## ND-I-23 — The daily evaluation is one global run at a configured hour

**Status:** Accepted — resolves open item A-6

Scheduled evaluation runs **once globally**, at a configured UTC hour, for every eligible user. It
is not run per user at their local midnight.

[ND-I-04](#nd-i-04--daily-midnight-evaluation-with-the-trigger-separated-from-the-logic) said
"daily at midnight"; the hour is now configuration, defaulting to early afternoon UTC rather than
midnight. Midnight is the worst available time to deliver a notification a person is meant to act
on, and ND-I-04's substance was the cadence and the trigger/logic separation, not the hour.

**Rationale:** Kizunia stores no user timezone, so per-user local scheduling would require
collecting one, and a scheduler that fires 24 times a day to serve timezone cohorts multiplies
invocations for a notification whose value is not hour-sensitive. Per-user timing is a genuine
future improvement — and it is exactly the kind the timing model already accommodates, since every
timing class reduces to one scheduled instant per unit of work.

**Open, deliberately:** nothing here prevents per-user timing later. When a timezone exists on the
user record, the change is to how one instant is computed, not to how work is scheduled or run.
