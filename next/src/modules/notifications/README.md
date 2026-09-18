# Notifications Module

## Purpose

Decides **whether** something should become a notification, turns that decision into a durable
record, and gets it to the user.

```text
Recommendation Engine  →  WHAT is relevant          modules/recommendations
Notification Policy    →  WHETHER it should notify  this module, policy/
Notification Delivery  →  HOW it reaches someone    this module, delivery/
```

The first boundary is the load-bearing one — see
[`principles.md`](../../../../docs/architecture/notifications/principles.md) principle 3: *"The
recommendation system must not own notification delivery. The notification system must not own the
competition relevance algorithm."* Relevance has exactly one owner, and this module consumes it
rather than forming an opinion of its own.

## Folder structure

```text
notifications/
├── config/notification-config.ts     every tuning number, with its reasoning
├── policy/                           PURE: should this become a notification?
├── content/                          PURE: what does it say, and where does it point?
├── scheduling/occurrence.ts          PURE: which occasion is this, and when?
├── jobs/                             the durable work queue and its runner
│   ├── work-queue.port.ts            the seam a broker would slot into
│   ├── postgres-work-queue.ts        the only raw SQL in the module
│   └── handlers/                     one per job kind, plus the registry
├── delivery/                         channels, providers, attempts
│   ├── push-provider.port.ts         the seam a second provider would slot into
│   ├── fcm-push-provider.ts          the ONLY firebase-admin import
│   └── fake-push-provider.ts         tests, and any unconfigured environment
├── backend/                          services, repositories, controllers
├── frontend/                         hooks and components for the inbox
├── api/, schemas/, types/, errors/, observability/
└── README.md
```

`policy/` ÷ `backend/` mirrors `recommendations/`'s `engine/` ÷ `backend/` split, and the same rule
extends to `content/` and `scheduling/`: every rule lives in a pure function over already-fetched
inputs, so the whole decision unit-tests without a database.

`index.ts` exports pure types and policy only. `backend/`, `jobs/` and `delivery/` are deliberately
not re-exported — they pull in Prisma and `next/server`, and would break a client bundle. Server
consumers deep-import.

## Scope

Four intents: `TOP_RELEVANT_COMPETITION`, `REGISTRATION_CLOSING`, `FEATURE_ANNOUNCEMENT`, and
`ADMIN_COMPETITION_SUGGESTION` — an operational notice to whoever holds
`REVIEW_COMPETITION_SUGGESTIONS` when a competition suggestion has waited in the review queue long
enough to be worth telling them about
([`policy/admin-suggestion-review.policy.ts`](policy/admin-suggestion-review.policy.ts)). It is the
only intent whose audience is not "any user" — see
[`policy/intent-audience.ts`](policy/intent-audience.ts) for how that is expressed without a second
notion of "recipient" anywhere else in the module. Two channels: the in-app inbox, and web push
through FCM.

Deliberately **not** here: email, WhatsApp, mobile push, audience targeting, per-channel
preferences, a template engine, quiet hours, digests, entitlements, and Kafka. The architecture
accommodates each; that is not a reason to build any of them
([`phase-2/boundaries.md`](../../../../docs/project/feature-specification/notification/phase-2/boundaries.md)).

## Things worth knowing before changing this

**Time is frozen by the scheduler, not read by the worker.** The occurrence key and any evaluation
window are computed once and carried in the job payload. A worker that computes its own would
generate a second notification whenever a retry crossed UTC midnight.

**Attempts are consumed at claim time.** A worker that crashes mid-job must still burn an attempt,
or its expired lease re-claims it forever.

**A unique-constraint violation is usually success.** "Already scheduled" and "already generated"
are the states the caller wanted. But catch them *narrowly* — a blanket catch turns a real data
problem into a silent no-op.

**In-app delivery completes at persistence.** For an inbox the row being visible *is* the delivery;
push is separate, retried separately, and never gates the inbox.

**Push is at-least-once, and says so.** A worker that succeeds at the provider and crashes before
recording will send again. Every push carries a collapse identity equal to the notification id, so
the OS replaces the earlier banner rather than stacking a second — the duplicate is mitigated, not
denied.

**Raw SQL must bind timestamps explicitly as UTC.** Prisma's columns are `timestamp`; the driver
binds `Date` as `timestamptz`, and Postgres converts using the *session* zone. On a non-UTC server
that silently claims jobs hours early. `utc()` in `postgres-work-queue.ts` exists for this.

## Adding an intent

A policy file under `policy/`, a renderer in `content/`, an enum value, a default in
`DEFAULT_ENABLED`, and a handler. The types are intent-agnostic and stay shared; there is
deliberately no registry or `NotificationPolicy` interface for policies — one dispatch table, for
job kinds, is enough indirection for a subsystem this size.

## Adding a channel

One adapter behind the existing provider port, and a `NotificationChannel` value. It must not touch
generation, the pipeline, or any intent. If it does, the boundary has been violated somewhere.

## Documentation

- Product rules and rulings:
  [`docs/project/feature-specification/notification/`](../../../../docs/project/feature-specification/notification/README.md)
- Architecture: [`docs/architecture/notifications/`](../../../../docs/architecture/notifications/README.md)
- Current state, remaining setup, known issues:
  [`IMPLEMENTATION-STATUS.md`](../../../../docs/architecture/notifications/IMPLEMENTATION-STATUS.md)
