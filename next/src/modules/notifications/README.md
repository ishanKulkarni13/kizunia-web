# Notifications Module

## Purpose

Decides **whether** something should become a notification. This is a different question from
what is relevant to a user, which the recommendation engine already answers, and from how a
notification reaches someone, which nothing in the codebase answers yet.

```text
Recommendation Engine  →  WHAT is relevant          modules/recommendations
Notification Policy    →  WHETHER it should notify  this module
Notification Delivery  →  HOW it is delivered       not built
```

The separation is the point — see
[`docs/architecture/notifications/principles.md`](../../../../docs/architecture/notifications/principles.md)
principle 3 ("The recommendation system must not own notification delivery. The notification
system must not own the competition relevance algorithm") and
[`phase-relationship.md`](../../../../docs/project/feature-specification/recommendation/phase-relationship.md).

Placement as a sibling of `competitions` rather than a folder inside it follows
[`module-boundaries.md`](../../../../docs/architecture/notifications/module-boundaries.md),
and resolves open item A-10.

## Folder Structure

```text
notifications/
├── README.md
├── index.ts                                     public API (policy + types — NOT backend/)
├── policy/
│   ├── types.ts                                 the decision contract
│   ├── top-relevant-competition.policy.ts       PURE — no I/O, no Prisma, no clock
│   └── top-relevant-competition.policy.test.ts
└── backend/
    └── notification-policy.service.ts           orchestration only
```

`policy/` ÷ `backend/` mirrors `recommendations/`'s `engine/` ÷ `backend/` split: every rule
lives in a pure function over already-fetched inputs, so the whole decision unit-tests without a
database, and the service above it only fetches and delegates.

## Scope

Currently one intent: `TOP_RELEVANT_COMPETITION`. Enabled preference plus at least one
recommendation yields exactly one competition — the highest-ranked
([ND-I-06](../../../../docs/project/feature-specification/notification/decisions/intents.md)).
Anything else is a suppressed decision carrying a reason.

Deliberately **not** here, and not stubbed or placeholdered either: delivery, channels, queues,
workers, cron/scheduling, notification history and deduplication, aggregation, and every intent
other than the one above. `docs/.../phase-1/boundaries.md` is explicit that an unspecified intent
must not appear in code "even as a placeholder".

Deduplication deserves a specific note, since
[ND-H-03](../../../../docs/project/feature-specification/notification/decisions/history.md)
does specify a `(user, competition, intent)` scope: there is no notification-history abstraction
to consume yet, and dedup belongs at *candidate filtering* rather than in this policy — so adding
it later will not reshape the decision contract.

## Adding an intent

Add a sibling file under `policy/` and a sibling method on `NotificationPolicyService`. The types
in `policy/types.ts` are intent-agnostic and stay shared. There is intentionally no registry,
dispatch table or `NotificationPolicy` interface — one implementation does not need one, and
inventing the abstraction before the second case is how it ends up fitting neither.
