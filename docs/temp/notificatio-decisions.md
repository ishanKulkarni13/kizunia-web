# Kizunia Notifications — Competition Relevance & Preference Decisions

> **Status:** Live documentation
> 
> 
> **Purpose:** Record finalized product/behavioral decisions made during notification-system design.
> 
> **Scope:** Competition preference configuration and relevance matching.
> 
> **Implementation:** Not covered yet.
> 
> **Last updated:** 12 September 2026
> 

---

## 1. Purpose

Kizunia's notification system can proactively recommend competitions to users.

To determine whether a competition is worth recommending, Kizunia maintains a **Competition Preference Profile** for each user.

The preference system describes **what the user cares about**, while the notification system determines **when and how to notify the user**.

This document defines the currently agreed behavioral rules for competition preferences and relevance.

---

# 2. Filter vs Notification Preference

Competition filters and competition notification preferences use the **same competition attributes**, but serve different purposes.

### Competition Filter

A filter answers:

> **"What competitions do I want to see right now?"**
> 

Filters are strict retrieval constraints.

For example:

```
Mode = Online
```

means:

> Show me competitions that are online.
> 

Offline competitions are excluded from the filtered result.

### Notification Preference

A notification preference answers:

> **"What characteristics make a competition interesting enough that Kizunia should consider notifying me?"**
> 

Preferences are generally weighted.

For example:

```
Mode:
Online → 0.8
```

means:

> Online competitions are strongly preferred, but an offline competition may still be relevant because other characteristics can make the competition interesting.
> 

Therefore:

```
Filters
→ strict retrieval

Preferences
→ weighted relevance
```

Notification preferences must **not silently modify the user's normal competition search/filter experience**.

---

# 3. Competition Preference Profile

Users can configure preferences using the competition attributes already available through Kizunia's competition filters.

The preference system should not require users to configure every field.

For example, a user may configure only:

```
Interest:
AI → 0.9

Location:
Pune → 0.8
```

and leave everything else unspecified.

This means:

```
Interest → preference exists
Location → preference exists
Mode → no preference
Fee → no preference
Eligibility → no preference
```

---

# 4. No Preference

There are two different meanings of "nothing selected."

## 4.1 Nothing selected in a particular field

If a user does not select anything for a particular field, it means:

> **The user does not care about that attribute. Any value is acceptable.**
> 

For example:

```
Mode:
nothing selected
```

means:

```
Online → acceptable
Offline → acceptable
```

The field does not contribute a preference signal.

This is equivalent to the user having no preference for that field.

---

## 4.2 Nothing selected across the entire preference profile

If the user has not configured **any competition preference at all**, Kizunia does not have enough information to provide personalized competition recommendations.

Therefore:

```
No preferences anywhere
        ↓
Personalized competition recommendation feature disabled
```

The user must select **at least one preference** before personalized competition recommendation notifications can operate.

---

# 5. Preference Weight

Each selected preference can have a weight between:

```
0 → 1
```

The weight represents how strongly the user cares about that preference.

### Weight semantics

```
0
→ No preference

0 < weight < 1
→ Soft preference

1
→ Hard constraint
```

## Weight = 0

A weight of `0` is semantically equivalent to the preference not being configured.

```
Online → 0
```

means:

> The user does not care about the mode.
> 

It does **not** mean:

> The user dislikes online competitions.
> 

---

# 6. Multiple Preferences Within a Field

The backend must support independent weights for multiple values within the same field.

For example:

```
Mode:

Online  → 0.9
Offline → 0.4
```

This means the user prefers online competitions more strongly than offline competitions.

The exact user experience for configuring these individual weights will be decided separately.

The backend model should support this capability regardless of the initial UX.

---

# 7. Hard Constraints

A preference with weight `1` is a **hard constraint**.

A hard constraint means the competition must satisfy that preference to remain eligible for recommendation.

Example:

```
Online → 1.0
```

means:

```
Online competition → eligible
Offline competition → excluded
```

Hard constraints are applied **before relevance scoring**.

---

# 8. Hard Constraint Dominance

If multiple values are configured within the same field and at least one has weight `1`, the field becomes hard-constrained.

Example:

```
Online  → 1.0
Offline → 0.5
```

means:

> **Only Online is acceptable.**
> 

The `0.5` Offline preference is ignored because a hard constraint is a hard constraint.

Therefore:

```
Any value with weight = 1
        ↓
Field becomes hard-constrained
        ↓
Only hard-constrained values are acceptable
```

---

# 9. Missing Competition Data

Competition data can be incomplete.

A competition attribute may be `null`.

A missing value is **not automatically treated as a hard mismatch**.

For soft preferences:

```
User:
Online → 0.8

Competition:
Mode = Offline
```

The competition does not match the preference, but it can still potentially be recommended based on its overall relevance.

Likewise:

```
User:
Online → 0.8

Competition:
Mode = null
```

The competition does not match the preference, but it can still potentially be recommended.

Therefore:

> **A soft mismatch or missing competition value lowers the competition's relevance but does not give it zero possibility of recommendation.**
> 

---

# 10. Missing Data Under a Hard Constraint

Hard constraints are strict, including when competition data is missing.

Example:

```
User:
Online → 1.0

Competition:
Mode = null
```

Result:

```
❌ Cannot be recommended
```

Because Kizunia cannot establish that the competition satisfies the hard constraint.

Therefore:

| User preference | Competition value | Result |
| --- | --- | --- |
| Online `0.8` | Online | Match |
| Online `0.8` | Offline | Not a match, but possible |
| Online `0.8` | `null` | Not a match, but possible |
| Online `1.0` | Online | Match |
| Online `1.0` | Offline | Excluded |
| Online `1.0` | `null` | Excluded |

---

# 11. Location Preferences

Location follows the semantics of Kizunia's geographic competition filters.

Location is hierarchical.

If a user prefers:

```
Pune → 0.8
```

a competition in Pune should have a strong geographic match.

A competition in a location contained within Pune should also match the Pune preference.

However, broader locations should not automatically be treated as equivalent.

For example:

```
User preference:
Pune → 0.8

Competition:
Maharashtra
```

should have a **very low likelihood of being selected**, rather than being treated as an equally strong Pune match.

The geographic relationship therefore follows:

> **Search expands downward geographically, never upward.**
> 

---

## 11.1 Location Weighting and Implementation Cost

The product model should conceptually support:

```
Location → 0–1
```

However, hierarchical/geographic weighted matching may introduce significant backend/query cost.

If the initial implementation makes this too expensive, location may temporarily operate as a hard constraint:

```
Location → 1
```

while preserving the model's ability to support weighted location preferences later.

This is an implementation decision to be evaluated separately; the product model should not unnecessarily prevent future weighted location support.

---

# 12. Relevance Is a Ranking

Kizunia should not treat relevance as one universal binary decision.

The matching system produces a **relevance/ranking signal**.

For example:

```
Competition A → 0.94
Competition B → 0.87
Competition C → 0.71
Competition D → 0.32
```

The notification policy can then decide what to send based on the purpose of that notification.

---

# 13. Minimum Relevance Threshold

A minimum relevance threshold exists as a **floor**.

A competition must be relevant enough to be considered for recommendation.

However, the threshold does not determine the exact number of competitions to send.

For example:

```
Requested:
Top 5

Competitions above minimum threshold:
A
B
C
```

Kizunia sends:

```
A
B
C
```

It does **not** lower the threshold simply to find five competitions.

Therefore:

> **Kizunia should never sacrifice relevance merely to satisfy a requested recommendation quantity.**
> 

---

# 14. Selection Is Relative to the Notification Objective

The number of competitions selected depends on the notification policy.

### Highly relevant competition

If the notification policy wants to provide one highly relevant competition:

```
A → 0.94
B → 0.87
C → 0.71
```

Kizunia selects:

```
A
```

provided it crosses the minimum threshold.

### Top 5 recommendations

If the policy requests the top five:

```
A → 0.94
B → 0.87
C → 0.82
D → 0.78
E → 0.74
F → 0.31
```

Kizunia selects:

```
A
B
C
D
E
```

assuming all five satisfy the minimum threshold.

Therefore:

> **Relevance produces the ranking; notification policy determines how many ranked candidates to select.**
> 

---

# 15. Candidate Filtering Happens Before Ranking

Competitions that cannot participate in a particular notification decision should be **filtered out before relevance scoring**.

The conceptual flow is:

```
All competitions
        ↓
Hard constraints
        ↓
Already notified for this reason
        ↓
Other applicable exclusion rules
        ↓
Eligible candidates
        ↓
Calculate relevance
        ↓
Rank
        ↓
Apply minimum threshold
        ↓
Select Top N
        ↓
Notify
```

This is both a correctness rule and an efficiency consideration.

Kizunia should not spend relevance-scoring resources on competitions that are already known to be impossible candidates.

---

# 16. Notification Deduplication

A competition should not repeatedly generate the **same notification reason** for the same user.

Example:

```
Competition A discovered
        ↓
"Competition A may interest you"
        ↓
Notification sent
```

If the same competition is encountered again for the same discovery reason:

```
Competition A discovered again
        ↓
Already notified for this reason
        ↓
Do not notify again
```

However, deduplication is based on the **notification reason/context**, not simply on the competition.

---

# 17. Different Reasons Can Produce Different Notifications

The same competition can legitimately generate different notifications over time.

Example:

```
Competition A
│
├── Relevant competition discovered
│      → Notify once
│
└── Registration deadline approaching
       → Separate notification
```

Therefore:

```
(user, competition, reason)
```

is conceptually different from:

```
(user, competition)
```

A previous discovery notification does not prevent a later deadline notification.

For example:

> "We found Competition A"
> 

may already have been sent, while:

> "Competition A's registration deadline is approaching"
> 

can still be sent when its separate notification rules are satisfied.

---

# 18. Core Matching Contract

The current agreed model can be summarized as:

```
                    User Competition Preferences
                              │
                              ↓
                    Candidate Competitions
                              │
                              ↓
                    Apply Hard Constraints
                              │
                 ┌────────────┴────────────┐
                 │                         │
              Fails                     Passes
                 │                         │
              Exclude                 Continue
                                           ↓
                              Calculate Relevance
                                           ↓
                                      Rank Candidates
                                           ↓
                              Apply Minimum Threshold
                                           ↓
                              Notification Policy
                                           ↓
                                  Select Top N
                                           ↓
                                    Send Notification
```

### Preference semantics

```
No value selected
    → no preference

Weight = 0
    → no preference

0 < weight < 1
    → soft preference

Weight = 1
    → hard constraint
```

### Competition data semantics

```
Matching value
    → positive relevance

Different value
    → no match, but still potentially recommendable
      when preference is soft

null
    → no match, but still potentially recommendable
      when preference is soft

null + hard constraint
    → excluded
```

---

## 19. Decisions Still Intentionally Open

This document records **decisions already made**, not unresolved implementation/product questions.

The following should be decided later:

- Exact relevance scoring formula
- Whether Kizunia gives different competition fields inherent importance
- Exact minimum relevance threshold
- How relevance weights are normalized
- Exact location-matching algorithm
- How often relevance matching runs
- Recommendation batching windows
- Recommendation notification limits
- Re-notification rules when a competition's relevance changes
- UX for configuring individual weights
- How notification preferences interact with subscription entitlements
- Delivery channels and notification infrastructure

These should be added to this **live document as decisions are made**, rather than prematurely designing them now.

# iurpthurhrhtruiouyjgtrefwfgtryuiuyjgtrety

1. TOP_RELEVANT_COMPETITION

TOP_RELEVANT_COMPETITION is a competition discovery notification.

Its purpose is to introduce a competition to a user when Kizunia determines that the competition is sufficiently relevant to the user's configured competition preferences.

This is a discovery notification, not a recurring reminder for a competition that has already been introduced to the user.

19.1 Registration Must Be Open

A competition can only be considered for TOP_RELEVANT_COMPETITION when its registration is currently open.

It does not matter whether the competition itself has already started.

For example, a competition may be ONGOING while registration remains open. Such a competition can still be considered for TOP_RELEVANT_COMPETITION.

The determining condition is whether registration is currently open.

Therefore:

Registration not yet open → cannot be recommended

Registration open → can be recommended

Registration closed → cannot be recommended

19.2 Daily Discovery

TOP_RELEVANT_COMPETITION is evaluated through a scheduled discovery job.

The initial schedule is once per day at midnight.

The scheduled job is only a trigger. The underlying recommendation logic must remain independent of the scheduler so that it can later be triggered through other mechanisms without duplicating business logic.

The daily evaluation does not mean that every eligible user receives a notification every day.

If there are no sufficiently relevant new opportunities, no notification should be generated.

19.3 Previously Recommended Competitions

A competition must not repeatedly generate the same TOP_RELEVANT_COMPETITION notification for the same user.

Conceptually, discovery history is associated with:

User + Competition + Notification Intent

Once a competition has been surfaced to a user through TOP_RELEVANT_COMPETITION, that competition cannot independently trigger another TOP_RELEVANT_COMPETITION notification for that user.

This remains true even if:

- the competition remains highly relevant;
- its relevance score changes;
- the competition remains registration-open;
- registration later closes and reopens.

19.4 Previously Recommended Competitions Can Still Appear in Rankings

The previous rule applies to generating a new discovery notification.

It does not mean that previously recommended competitions must be removed from relevance ranking.

A competition that was previously surfaced may still appear in a user's current Top-N ranking if it remains sufficiently relevant.

For example, a competition that appeared in a previous notification can still be part of a later ranked recommendation set.

Its previous discovery only prevents it from independently triggering another TOP_RELEVANT_COMPETITION notification.

Therefore:

Previous discovery prevents repeated discovery notification.

Previous discovery does not make the competition irrelevant.

19.5 Registration Reopening

If registration closes and later reopens, the competition may become actionable again.

However, reopening registration does not reset the user's TOP_RELEVANT_COMPETITION discovery history.

If the user has never previously received that competition through TOP_RELEVANT_COMPETITION, it may be considered again when registration becomes open.

If the user has already received it through TOP_RELEVANT_COMPETITION, it must not generate another discovery notification.

If the reopening creates important information that should be communicated to the user, that should be handled through an appropriate lifecycle or competition-update notification rather than repeating the discovery notification.

19.6 New Actionable Opportunities

A competition does not need to have been newly created on Kizunia to qualify as a new discovery opportunity.

For example, a competition may already exist in Kizunia while its registration is not yet open.

When registration becomes open, it becomes an actionable opportunity and can be considered for TOP_RELEVANT_COMPETITION.

Therefore, recommendation freshness must not be defined solely by the competition's creation date.

1. Phase 1 Notification Scope

The initial notification implementation is intentionally limited to two core competition notification capabilities:

TOP_RELEVANT_COMPETITION

REGISTRATION_CLOSING

Additional notification capabilities will be introduced later.

The architecture must support future notification types without requiring the Phase 1 foundation to be redesigned.

20.1 TOP_RELEVANT_COMPETITION

Purpose:

Introduce a highly relevant competition that is currently actionable because registration is open.

Schedule:

Daily at midnight.

The conceptual flow is:

Eligible user

→ Competition preference profile exists

→ Relevant competition notifications are enabled

→ Required capability is available

→ Registration is currently open

→ Competition has not previously been surfaced for this intent

→ Apply hard constraints

→ Calculate relevance

→ Apply minimum threshold

→ Rank

→ Select according to notification objective

→ Aggregate

→ Generate notification

A notification must not be generated simply because the scheduled evaluation ran.

If there are no sufficiently relevant new competitions, no notification should be generated.

20.2 REGISTRATION_CLOSING

REGISTRATION_CLOSING is an actionable deadline notification.

Its purpose is to give the user an opportunity to register before registration closes.

The initial notification timing is exactly 24 hours before the actual registration deadline timestamp.

The 24-hour calculation is based on the actual deadline timestamp and not simply on the previous calendar day.

20.3 REGISTRATION_CLOSING Recipient Eligibility

A user can receive a REGISTRATION_CLOSING notification when the competition is either:

- relevant to the user; or
- bookmarked by the user.

The user must not have marked the competition as Registered.

Therefore:

Relevant → eligible

Bookmarked → eligible

Relevant + Bookmarked → eligible

Marked as Registered → excluded

Being bookmarked is not required when the competition is already relevant to the user.

20.4 REGISTRATION_CLOSING Deduplication

If a user qualifies through more than one relationship, Kizunia must generate only one user-facing registration-closing notification for the same deadline event.

For example, if a competition is both relevant and bookmarked:

The user receives one notification.

Kizunia must not send one notification because the competition is relevant and another because it is bookmarked.

The different eligibility relationships may be retained internally if useful, but they must not create duplicate user-facing notifications.

20.5 Marked as Registered

Kizunia does not know whether a user actually registered for an external competition unless that information is explicitly available through a trusted integration in the future.

The current system only knows when a user has explicitly marked a competition as Registered.

A user who has marked a competition as Registered is therefore excluded from the REGISTRATION_CLOSING notification.

This is a Kizunia-side user-declared relationship and must not be treated as verified external registration data.

20.6 REGISTRATION_CLOSED

A standalone REGISTRATION_CLOSED notification is not implemented in Phase 1.

The purpose of the deadline notification is to give the user an opportunity to act while registration is still available.

After registration has closed, the user can no longer register through the normal registration process, so a standalone "registration closed" notification provides little actionable value.

Therefore:

Registration closing → notify before closure.

Registration closed → no standalone notification.

20.7 REGISTRATION_OPENED

REGISTRATION_OPENED is currently outside the Phase 1 implementation scope.

Its exact behavior, recipient rules, timing, and preference controls will be decided later.

The architecture should remain capable of supporting it without requiring a redesign of the fundamental notification model.

1. Competition Recipient Relationships

For the current notification system, competition-related recipient rules must use relationships that Kizunia itself knows about.

The currently relevant relationships are:

- Relevant to the user
- Bookmarked by the user
- Marked as Registered by the user

Kizunia must not assume that it knows whether a user actually registered for an external competition.

In particular, Kizunia must not introduce an external "Participants" or "Registered Users" recipient group unless verified registration data becomes available through a future integration.

"Marked as Registered" means that the user explicitly told Kizunia that they registered.

It does not mean that Kizunia verified the registration externally.

1. Notification Architecture Direction

The notification system is expected to evolve continuously.

New notification intents will be introduced.

Existing notification rules may change.

Recommendation algorithms may change.

Relevance scoring may change.

Ranking algorithms may change.

Aggregation rules may change.

Notification limits may change.

New delivery channels may be introduced.

User preferences and subscription entitlements may expand.

Therefore, the notification system must be designed as a highly modular, general-purpose platform rather than as tightly coupled competition-specific logic.

22.1 Recommendation and Notification Are Separate Responsibilities

Recommendation determines:

"What should be recommended to this user?"

Notification determines:

"Should this recommendation become a notification, and how should it be handled?"

These are separate responsibilities.

Conceptually:

Recommendation

→ Notification Decision

→ Notification

→ Delivery

The recommendation system must not own notification delivery.

The notification system must not own the competition relevance algorithm.

22.2 Recommendation Pipeline

The conceptual recommendation pipeline is:

Scheduled or Event Trigger

→ User Eligibility

→ Candidate Selection

→ Candidate Filtering

→ Preference Matching

→ Relevance Scoring

→ Minimum Threshold

→ Ranking

→ Selection

→ Recommendation Set

→ Notification Policy

→ Aggregation

→ Notification Generation

→ Queue

→ Delivery

Each stage should have a clearly defined responsibility.

The implementation should avoid creating one service responsible for the entire pipeline.

22.3 Replaceable Recommendation Algorithms

Relevance scoring and ranking are expected to evolve.

The notification infrastructure must not depend on a particular relevance-scoring or ranking implementation.

Changing the recommendation algorithm should not require changes to:

- notification persistence;
- notification delivery;
- notification preferences;
- queueing;
- unrelated notification intents.

Recommendation algorithms should therefore be replaceable independently from the notification platform.

22.4 Notification Intents as Independent Capabilities

Notification intents represent distinct business purposes.

Current Phase 1 intents include:

- TOP_RELEVANT_COMPETITION
- REGISTRATION_CLOSING

Future intents may include additional competition, portfolio, platform, or subscription notifications.

Adding a new notification intent should not require expanding a central notification service into a large collection of unrelated conditional branches.

Each intent should have clearly defined rules and responsibilities.

22.5 Scheduled and Event-Driven Triggers

Different notification intents may use different trigger mechanisms.

For example:

TOP_RELEVANT_COMPETITION

→ Scheduled discovery

REGISTRATION_CLOSING

→ Scheduled deadline evaluation

Future admin-driven or event-driven notifications

→ Event or administrative trigger

The trigger mechanism must remain separate from the underlying notification logic.

The same underlying business logic should be reusable regardless of whether execution was initiated by:

- a scheduled job;
- an admin action;
- a domain event;
- another future trigger.

22.6 Queue Before Delivery

Notification generation and notification delivery are separate stages.

A notification may be generated first and delivered asynchronously afterward.

Conceptually:

Notification Decision

→ Notification Generation

→ Queue

→ Delivery

This separation provides a foundation for:

- asynchronous delivery;
- retries;
- additional delivery channels;
- delivery status tracking;
- future notification clients.

The exact queueing and delivery infrastructure remains intentionally open.

22.7 Avoid a Competition Notification God Service

The architecture must avoid creating one large competition-specific notification service that owns every competition notification rule.

A service that gradually accumulates:

- top recommendations;
- registration deadlines;
- registration events;
- cancellations;
- competition updates;
- future competition notifications

would become difficult to reason about and maintain.

Notification capabilities should instead remain modular and independently composable.

1. Phase 1 Boundaries

Included in Phase 1:

- TOP_RELEVANT_COMPETITION
- REGISTRATION_CLOSING

Not implemented in Phase 1:

- REGISTRATION_OPENED
- REGISTRATION_CLOSED
- COMPETITION_STARTED
- COMPETITION_COMPLETED

Other notification capabilities will be introduced incrementally.

The Phase 1 architecture should provide the foundation for these future capabilities without prematurely implementing their product rules.

1. Decisions Still Intentionally Open

The following decisions are intentionally not finalized yet:

- Exact relevance scoring formula
- Whether different competition fields have inherent importance
- Exact minimum relevance threshold
- How relevance weights are normalized
- Exact location-matching algorithm
- Recommendation freshness strategy
- Exact recommendation batching behavior
- Recommendation notification limits
- Re-notification behavior when competition relevance changes
- Exact notification persistence model
- Recommendation lifecycle and state tracking
- Idempotency and retry behavior
- Notification aggregation rules
- Notification preference UX
- Subscription entitlement behavior
- Delivery channels
- Notification inbox behavior
- Read/unread behavior
- Notification expiration
- Quiet hours
- Future lifecycle notification rules
- Admin notification rules
- Notification content/template system

These should be added to this live document as decisions are made rather than being prematurely designed.

## 19. Notification History

A notification record represents an **actual notification occurrence** for a user.

Notification history should be retained because Kizunia will provide a **notification inbox**, where past notifications remain meaningful to the user.

A notification record conceptually contains:

- User
- Competition
- Notification type/reason
- Creation date/time
- Delivery state
- User response state

Historical notification records should not be overwritten when a later notification for the same competition is generated.

### Undelivered notification

If a notification is created but is not delivered:

```
Monday
Competition A
TOP_RELEVANT_COMPETITION
delivered = false
```

and Competition A becomes eligible again on Tuesday, the Tuesday evaluation may generate:

```
Tuesday
Competition A
TOP_RELEVANT_COMPETITION
new notification record
```

The Monday record remains in history.

Therefore:

> **A later notification is a new notification occurrence and creates a new record. It does not update or replace the previous notification record.**
> 

The exact semantics of `delivered` and the underlying delivery mechanism are implementation concerns and are intentionally left open for the implementation phase.

---

## 20. Notification History and Re-evaluation

Notification history affects future candidate eligibility according to the notification type/reason.

For the current Phase 1 discovery notification:

```
Previous notification exists
        │
        ├── delivered = true
        │       ↓
        │   Exclude competition
        │   for the same notification reason
        │
        └── delivered = false
                ↓
            Competition remains
            eligible for future evaluation
```

An undelivered notification therefore does **not** permanently consume the competition for that notification reason.

If the competition becomes the best candidate again during a later evaluation, Kizunia may generate a new notification record.

This is considered **re-evaluation**, not a direct delivery retry.

The exact retry/re-delivery strategy remains an implementation concern and may evolve independently.

---

## 21. Current User Preferences Drive Daily Evaluation

Each new scheduled evaluation uses the user's **current competition preference profile**.

Past preference configurations do not affect the current evaluation.

For example:

```
Monday
User preferences:
AI → 0.9

Tuesday
User changes preferences:
Design → 0.9
```

Tuesday's evaluation uses:

```
Design → 0.9
```

The system does not need to evaluate Tuesday's competitions against the user's historical Monday preference configuration.

Therefore:

> **Relevance is evaluated against the user's current preference state at the time of evaluation.**
> 

Historical notification records remain preserved independently.

---

## 22. Different Notification Types Are Independent

Notification deduplication is scoped to the **notification type/reason**, not simply to the competition.

The same competition can therefore generate multiple different notifications.

For example:

```
Monday
Competition A
TOP_RELEVANT_COMPETITION

Tuesday
Competition A
REGISTRATION_CLOSING
```

Both notifications are valid.

Different notification types may also be generated for the same competition **on the same day** when their respective conditions are satisfied.

For example:

```
10:00 AM
Competition A → Top recommendation

2:00 PM
Competition A → Registration closing tomorrow
```

This is intentional and acceptable.

Therefore:

> **A notification for one reason does not suppress a notification for another reason.**
> 

This follows the existing decision that notification identity is conceptually based on:

```
User + Competition + Notification Reason/Type
```

rather than simply:

```
User + Competition
```

The existing document already establishes this distinction between discovery and deadline notifications.

---

# 23. Notification Response

For Phase 1, notification interaction is intentionally simple.

When the user **clicks/opens a notification**, the notification is considered responded to.

Therefore:

```
Notification created
        ↓
responded = false
        ↓
User clicks notification
        ↓
responded = true
```

No more granular interaction model is required for Phase 1.

The system does not need to distinguish between different kinds of notification interaction at this stage.

---

# 24. Registration Closing Notification Aggregation

`REGISTRATION_CLOSING` differs from `TOP_RELEVANT_COMPETITION` in how many competitions it can surface.

### TOP_RELEVANT_COMPETITION

```
Maximum selected:
1 competition
```

The purpose is individual discovery:

> "Here is a competition that is particularly relevant to you."
> 

### REGISTRATION_CLOSING

Multiple competitions may satisfy the notification criteria.

Rather than sending a separate notification for every competition, Kizunia will aggregate the strongest candidates into **one summary notification**.

The target selection is:

```
Top 3–5 competitions
        ↓
One aggregated notification
```

For example:

> **Registration closing soon**
> 
> 
> 4 competitions relevant to you have registration deadlines approaching.
> 

The exact presentation, wording, and whether the final batch contains 3, 4, or 5 competitions depending on available qualified candidates remain UX/implementation details.

The existing principle remains:

> **Relevance produces the ranking; notification policy determines how many ranked candidates are selected.**
> 

---

# 25. Competition Lifecycle and TOP Recommendation

Competition lifecycle changes do not require a separate Phase 1 notification for every state transition.

In particular, when a competition changes from:

```
UPCOMING
    ↓
REGISTRATION_OPEN
```

it naturally becomes eligible for the `TOP_RELEVANT_COMPETITION` evaluation, provided all other eligibility, preference, relevance, threshold, and history rules are satisfied.

Therefore:

> **A competition becoming registration-open can naturally cause it to appear in the next TOP_RELEVANT_COMPETITION evaluation.**
> 

This does not require a separate lifecycle-triggered notification.

Explicit competition updates and admin-designated update notifications are treated separately and remain outside this decision.

---

## 26. Phase 1 Notification Model — Consolidated

The current Phase 1 model is therefore:

```
TOP_RELEVANT_COMPETITION
    ↓
Daily evaluation
    ↓
Use current user preferences
    ↓
Registration currently open
    ↓
Exclude previously delivered
    same-type notifications
    ↓
Apply relevance rules
    ↓
Select at most 1
    ↓
Generate notification
```

```
REGISTRATION_CLOSING
    ↓
Evaluate competitions approaching deadline
    ↓
Relevant OR bookmarked
    ↓
Exclude registered competitions
    ↓
Rank qualified competitions
    ↓
Select top 3–5
    ↓
Aggregate into one summary notification
```

Notification history is retained independently:

```
Notification occurrence
        ↓
New record
        ↓
Delivery state
        ↓
User response state
```

Different notification types remain independent:

```
Competition A
├── TOP_RELEVANT_COMPETITION
├── REGISTRATION_CLOSING
└── Future notification types
```

This keeps the notification system aligned with the existing architectural direction: **recommendation, notification policy, generation, and delivery remain separate concerns**, allowing future notification types and algorithms to evolve without changing the core competition model.

## 27. User Notification Preferences — Phase 1

Users can independently control the notification types they want to receive.

### Daily Top Competition

Users can turn the daily `TOP_RELEVANT_COMPETITION` notification:

- ON
- OFF

When disabled, the user is not eligible to receive the daily top competition notification.

### Registration Deadline

Users can turn the `REGISTRATION_CLOSING` notification:

- ON
- OFF

Users can also customize the **maximum number of competitions** included in the registration-deadline summary notification.

Therefore, the number of competitions selected for this notification is controlled by the user's configured maximum, subject to the system's available qualified candidates.

These notification preferences are separate from the user's competition preference profile.

Competition preferences determine:

> **Which competitions are relevant to the user.**
> 

Notification preferences determine:

> **Which types of notifications the user wants to receive.**
> 

---

## 28. Notification Disabled After Generation

If a notification has already been generated but the user disables that notification type before delivery, the notification should **not be sent**.

For Phase 1, the notification may simply be marked as:

`delivered = false`

No separate cancellation or suppression state is required at this stage.

This behavior can be extended later if more detailed notification lifecycle states become necessary.

---

## 29. Competition State Is Not Re-checked Before Delivery — Phase 1

For Phase 1, once a notification has been generated, Kizunia does **not** perform another competition-state validation immediately before delivery.

For example:

> Competition A's registration closes tomorrow
> 
> 
> ↓
> 
> `REGISTRATION_CLOSING` notification generated
> 
> ↓
> 
> Competition A is cancelled
> 
> ↓
> 
> Notification is still sent
> 

This is intentional for Phase 1.

A future version may introduce a final validation/filter stage that re-checks the competition's current state before delivery.

---

## 30. Notification Processing Filters — Architectural Direction

The notification architecture should support a modular filter/middleware model.

The conceptual direction is similar to middleware in systems such as Express:

> A processing stage receives the context produced by previous stages, can inspect that context, and may add additional context for subsequent stages.
> 

Conceptually:

`Stage A → Filter/Middleware → Stage B → Filter/Middleware → Stage C`

A filter should be able to:

- access the relevant accumulated context
- evaluate conditions using information produced by previous stages
- reject or allow processing where appropriate
- add useful context for downstream stages

This provides an extensible mechanism for introducing additional validation and business rules later without restructuring the entire notification pipeline.

### Phase 1

The system intentionally does **not** need to implement every possible validation filter.

For example, the final competition-status re-check before delivery is a **future filter**, not a Phase 1 requirement.

The architecture should nevertheless make such filters possible later.

---

## 31. Client / Delivery Platform Direction

Phase 1 is designed around the **Kizunia web application**.

However, the notification system must not be conceptually tied to the web client.

The system should be capable of supporting additional clients in the future, including an **Expo/mobile application**.

Therefore, the notification model and notification-generation logic should remain independent from the specific client through which the notification is eventually delivered.

The current product scope is:

> **Web first, with future mobile/Expo support.**
> 

---

## 32. Phase 1 Notification Preference Model — Summary

The Phase 1 user-facing notification controls are:

| Notification | User control | Selection |
| --- | --- | --- |
| `TOP_RELEVANT_COMPETITION` | On / Off | Maximum 1 competition |
| `REGISTRATION_CLOSING` | On / Off | User-configurable maximum, surfaced as one summary |

The overall separation is:

**Competition preferences**

→ determine relevance.

**Notification preferences**

→ determine whether the user wants a particular notification type.

**Notification objective/policy**

→ determines how many relevant competitions are selected.

**Notification pipeline/filters**

→ process and validate the notification.

**Delivery layer**

→ delivers to the supported client/channel.

This keeps the product rules independent from the implementation details and leaves room for the notification system to evolve as Kizunia adds more notification types, filters, and clients.