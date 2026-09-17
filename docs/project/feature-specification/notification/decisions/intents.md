# Decisions — Intents

> **Status:** Live
>
> **Last Updated:** 2026-09-12

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

**Open:** a scheduled job cannot fire at an arbitrary instant, so the evaluation window that
approximates T-2d is still an open decision, though a coarser target narrows it considerably — see
[`open-decisions.md`](../open-decisions.md).

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
