# Documentation Structure

> **Status:** Stable
>
> **Last Updated:** 2026-09-12

This document answers three questions:

1. What does every folder and file in the Notifications documentation own?
2. What must each one **not** contain?
3. When I change something, where does the change go?

If you are adding to this documentation set and cannot answer question 3 from this page, the
structure is wrong and this page should be fixed — not worked around.

---

## The two trees

Notifications documentation lives in two places on purpose.

```text
docs/project/feature-specification/notification/        PRODUCT: what it does, and why
docs/architecture/notifications/                        TECHNICAL: how it is built to keep changing
docs/architecture/domain/notifications/                 DOMAIN: the conceptual entities
docs/architecture/decisions/notifications-subsystem.md  ADR: the founding architectural choice
```

The split follows the rule this repository already states in
[`feature-specification/README.md`](../README.md):

> A feature specification should describe **what** a module is expected to accomplish.
> It should never describe **how** it will be implemented.

A behavioral rule ("a competition already delivered for this intent cannot trigger it again") is
product. A structural rule ("relevance scoring sits behind a replaceable strategy") is
architecture. When a statement is genuinely both, the product tree states the behavior and the
architecture tree links to it rather than restating it.

---

## Product tree

```text
notification/
├── README.md                    index, reading order, status, liveness rules
├── STRUCTURE.md                 this document
│
├── overview/
│   ├── README.md
│   ├── purpose.md               why the subsystem exists; philosophy
│   ├── scope.md                 what is and is not Notifications' responsibility
│   └── glossary.md              canonical terminology
│
├── decisions/
│   ├── README.md                how rulings work + the full register table
│   ├── preferences.md           rulings about preferences and weights
│   ├── relevance.md             rulings about relevance, thresholds, selection
│   ├── intents.md               rulings about the notification types
│   ├── history.md               rulings about records, dedup, re-evaluation, response
│   └── reconciliations.md       contradictions in the source material and how each was resolved
│
├── preferences/
│   ├── README.md
│   ├── filters-vs-preferences.md          the distinction everything else depends on
│   ├── competition-preference-profile.md  what the user cares about
│   ├── weights-and-constraints.md         0 to 1 semantics, hard constraints, dominance
│   └── notification-preferences.md        which notification types the user wants
│
├── relevance/
│   ├── README.md
│   ├── relevance-model.md         relevance as a ranking signal, not a verdict
│   ├── candidate-filtering.md     what is removed before scoring, and why first
│   ├── missing-data.md            null and mismatch semantics
│   ├── location-matching.md       hierarchical geography rules
│   └── threshold-and-selection.md the floor, and how many get selected
│
├── intents/
│   ├── README.md                  what an intent is; the contract each must define
│   ├── top-relevant-competition.md
│   └── registration-closing.md
│
├── history/
│   ├── README.md
│   ├── notification-record.md     the record as an occurrence
│   ├── deduplication.md           what suppresses a future notification
│   ├── re-evaluation.md           why a new record is not a retry
│   └── user-response.md           responded semantics
│
├── experience/
│   ├── README.md
│   ├── inbox.md                   the user-facing notification inbox
│   └── user-stories.md            the full US-xx register with status
│
├── phase-1/
│   ├── README.md
│   ├── scope.md                   the consolidated Phase 1 model
│   └── boundaries.md              the explicit in/out list
│
├── future/
│   ├── README.md
│   ├── notification-intents.md    intents we expect but have not designed
│   ├── personalization.md         ML relevance, experiments, richer preferences
│   ├── entitlements.md            paid plans and feature flags
│   └── channels.md                email, push, Expo/mobile
│
└── open-decisions.md              what is deliberately not decided yet
```

### What each product area owns, and must not contain

| Folder | Owns | Must not contain |
| --- | --- | --- |
| `overview/` | Purpose, philosophy, scope boundary, vocabulary | Rules. If it states behavior, it belongs elsewhere |
| `decisions/` | Finalized rulings, each with an ID and a rationale | Speculation, proposals, unresolved questions |
| `preferences/` | What the user configures and what each setting means | Scoring formulas; storage shape |
| `relevance/` | How candidates are narrowed, scored, ranked and selected | The actual formula (undecided); any implementation |
| `intents/` | Per-notification-type behavior, end to end | Intents that do not exist yet, which go to `future/` |
| `history/` | What is recorded, and how records constrain future notifications | Table and column design, which is architecture |
| `experience/` | User-facing surfaces and story traceability | New behavior not backed by a ruling |
| `phase-1/` | The scope line, stated twice: what is in, what is out | Anything aspirational |
| `future/` | Direction, clearly marked unbuilt, mapped to its user story | Anything presented as current behavior |
| `open-decisions.md` | Questions, with what each one blocks | Answers. An answered question becomes a ruling in `decisions/` |

---

## Architecture tree

```text
docs/architecture/notifications/
├── README.md                     index and reading order
├── principles.md                 the rules this subsystem is held to
├── module-boundaries.md          what the module owns and what it may reach into
│
├── pipeline/
│   ├── README.md
│   ├── stages.md                 the stage sequence and each stage's responsibility
│   ├── processing-context.md     the typed context contract
│   ├── filter-chain.md           the middleware model and its guarantees
│   └── extension-points.md       where new behavior attaches without a rewrite
│
├── recommendation/
│   ├── README.md
│   ├── candidate-selection.md
│   ├── scoring-strategy.md       relevance as a replaceable strategy
│   ├── ranking-and-selection.md
│   └── aggregation.md
│
├── intents/
│   ├── README.md
│   ├── intent-contract.md        what every intent implementation provides
│   └── adding-an-intent.md       the checklist; why there is no central switch
│
├── triggers/
│   ├── README.md
│   ├── scheduled-evaluation.md   the cron convention; trigger is not business logic
│   └── event-and-admin-triggers.md
│
├── persistence/
│   ├── README.md
│   ├── notification-storage.md   occurrence storage and history immutability
│   └── preference-storage.md     including the legacy model question
│
├── delivery/
│   ├── README.md
│   ├── generation-vs-delivery.md
│   ├── queue.md                  the seam, and what this repo actually has
│   └── clients-and-channels.md   web-first, client-agnostic
│
├── cross-cutting/
│   ├── README.md
│   ├── feature-flags-and-entitlements.md
│   ├── analytics-and-tracking.md
│   └── failure-and-idempotency.md
│
└── testing/
    ├── README.md
    ├── strategy.md               the pyramid; existing Vitest conventions
    └── test-surface.md           what must be independently testable

docs/architecture/domain/notifications/
├── README.md
├── overview.md                   the domain in one page
├── entities.md                   conceptual entities and their contracts
└── relationships.md              boundaries with Competition, User, Bookmark, Registration

docs/architecture/decisions/
└── notifications-subsystem.md    ADR: Notifications as an independent subsystem
```

---

## Where does my change go?

| The change is | It goes in |
| --- | --- |
| A new rule about what users receive | The owning product area **and** a ruling in `decisions/` |
| A change to an existing rule | Amend the ruling in `decisions/`, then update the area that states it |
| A new word that needs a precise meaning | `overview/glossary.md` |
| A notification type that is being built | A file in `intents/` plus its contract in `architecture/notifications/intents/` |
| A notification type that is only an idea | `future/notification-intents.md` |
| A change to how something is built | `docs/architecture/notifications/` only |
| A new pipeline stage or filter | `architecture/notifications/pipeline/` |
| A storage or schema concern | `architecture/notifications/persistence/` |
| A question you cannot answer | `open-decisions.md`, with what it blocks |
| An answer to one of those questions | A ruling in `decisions/`, and delete the open item |
| Something wrong in the original source notes | `decisions/reconciliations.md` |

**The rule of one home.** Every fact has exactly one owning document; other documents link to it.
If you find yourself restating a rule in a second place, link instead. Restated rules are how
documentation sets start disagreeing with themselves.

---

## Source material

This specification was derived from three working documents in `docs/temp/`, which is a scratch
directory and is not authoritative:

| Source | Contributed |
| --- | --- |
| `notificatio-decisions.md` | Preferences, relevance, candidate filtering, both Phase 1 intents, history, response, aggregation, architectural direction |
| `notofication-User-stories.md` | US-01 to US-31, the inbox surface, preference categories, future scope, explicit non-goals |
| `codebase-recommendation.md` | Engineering requirements: bounded module, pipeline/filter-chain, replaceable algorithms, intent boundary, flags and entitlements, analytics, testing, documentation liveness |

Traceability from those sources into this set is recorded in
[`decisions/README.md`](decisions/README.md) and
[`experience/user-stories.md`](experience/user-stories.md).
