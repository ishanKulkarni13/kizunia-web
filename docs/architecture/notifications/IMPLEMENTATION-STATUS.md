****# Notification Delivery — Implementation Status

> **Status:** Live — updated at every checkpoint
>
> **Last Updated:** 2026-09-18 (admin suggestion notice added)

This document is the **resumable checkpoint** for the notification delivery
implementation. It is written so that someone with no context beyond this
repository can pick the work up.

If you are resuming: read this file, then
[`phase-2/scope.md`](../../project/feature-specification/notification/phase-2/scope.md), then
[`decisions/delivery.md`](../../project/feature-specification/notification/decisions/delivery.md).
That is enough. Nothing in the implementation depends on a conversation you were
not part of.

---

## The shape of the thing, in one page

```text
                        ┌─────────────────────────────────────────┐
  Vercel Cron  ────────▶ │  GET /api/v1/internal/tick              │
  (or any pinger)        │  schedule pass → drain pass → prune     │
                        └────────────────┬────────────────────────┘
                                         │
                    ┌────────────────────┴───────────────────┐
                    ▼                                        ▼
        ┌───────────────────────┐              ┌──────────────────────────┐
        │  Scheduler            │              │  Job runner              │
        │  enqueues per-user    │              │  claims a bounded batch  │
        │  work; FREEZES the    │              │  under a lease, dispatch │
        │  occurrence + window  │              │  by kind, complete/fail  │
        └───────────┬───────────┘              └────────────┬─────────────┘
                    │                                        │
                    └──────────────▶ notification_job ◀──────┘
                                     (Postgres, SKIP LOCKED)
                                              │
                          ┌───────────────────┴───────────────────┐
                          ▼                                       ▼
            ┌──────────────────────────┐            ┌──────────────────────────┐
            │  Evaluation handlers     │            │  Delivery handler        │
            │  policy → generation     │            │  → PushProvider port     │
            └────────────┬─────────────┘            └────────────┬─────────────┘
                         │ one transaction                        │
                         ▼                                        ▼
        notification + targets + deliveries + delivery job    FCM / fake
```

Two ports isolate everything replaceable: `WorkQueue` (Postgres today, Kafka
later) and `PushProvider` (FCM today, anything later).

---

## IMPLEMENTATION STATUS

### Completed

- [x] **Phase 0 — Documentation and rulings**
  - [x] `decisions/delivery.md` — new `ND-D-01` … `ND-D-13` register
  - [x] `decisions/intents.md` — `ND-I-19` … `ND-I-23`; `ND-I-04` and `ND-I-10` amended in place
  - [x] `decisions/history.md` — `ND-H-10` … `ND-H-12`
  - [x] `decisions/preferences.md` — `ND-P-16`, `ND-P-17`
  - [x] `decisions/README.md` — register index, `ND-D` prefix added
  - [x] `phase-2/{README,scope,boundaries}.md`, `intents/feature-announcement.md`
  - [x] `open-decisions.md` — A-1, A-3, A-4, A-5, A-6, A-7, A-8, A-10 resolved and removed;
        A-11 (retention) added; A-9 retained

- [x] **Phase A — Schema, migrations, configuration**
  - [x] Eight models, nine enums, three `User` back-relations
  - [x] `20260918000000_extend_notification_intent` — the two enum values, alone
  - [x] `20260918000100_add_notification_delivery_and_jobs` — tables, indexes, FKs, and the two
        hand-written blocks Prisma cannot express (partial unique index, action-path CHECK)
  - [x] Applied to dev **and** test databases. The dev database had no migration history at all
        (created by `db push`), so it was baselined with `migrate resolve --applied` first —
        non-destructive, no reset, no data touched
  - [x] `config/notification-config.ts` — every tuning number, with its reasoning
  - [x] Per-intent defaults; preferences card now renders all three intents

- [x] **Phase B — Durable work queue**
  - [x] `work-queue.port.ts` (the Kafka seam), `postgres-work-queue.ts` (`SKIP LOCKED` claiming,
        lease recovery, reaper, bounded prune), `job-payload.ts`, `backoff.ts`, `job-error.ts`,
        `job-runner.ts`, `handler.ts`, `observability/log.ts`

- [x] **Phase C — Generation, both competition intents, inbox API**
  - [x] `scheduling/occurrence.ts` — pure keys, windows, next-run
  - [x] `content/` — action-path safety, per-intent renderers, the draft type
  - [x] `notification-scheduler.service.ts` — per-user jobs, paged, time frozen into the payload
  - [x] `notification-generation.service.ts` — the transactional outbox
  - [x] `policy/registration-closing.policy.ts` + `deadline-window.repository.ts`
  - [x] All four job handlers and the exhaustive registry
  - [x] Inbox API: list, unread count, mark read, mark all read, mark responded
  - [x] `notification-tick.service.ts`, the internal task registry, `GET /api/v1/internal/tick`,
        `vercel.json`, five new rate-limit policies

- [x] **Phase D — Push delivery**
  - [x] `push-provider.port.ts`, `fake-push-provider.ts`, `push-provider.factory.ts`
  - [x] `delivery.service.ts` + `delivery.repository.ts` — per-destination fan-out, classification,
        retry scheduling, subscription invalidation, pre-send preference re-check
  - [x] `fcm-push-provider.ts` (the only `firebase-admin` import) and `fcm-error-mapping.ts`
  - [x] Push subscription API; `firebase` and `firebase-admin` installed
  - [x] `public/firebase-messaging-sw.js`, `public/manifest.json`, manifest linked from the layout
  - [x] `lib/push/firebase-client.ts` — browser wrapper, config passed to the worker via the
        registration URL

- [x] **Phase E — Admin announcements**
  - [x] `PlatformAction.MANAGE_NOTIFICATION_ANNOUNCEMENTS`, granted to ADMIN + SUPER_ADMIN
  - [x] `announcement.service.ts` (authorize → create → schedule → cancel), controller, admin routes
  - [x] Resumable fan-out that re-arms its own row rather than enqueueing a successor
  - [x] Shared URL validator used by both the schema and the service

- [x] **Phase F — Frontend**
  - [x] `api/notification-api.ts`, `api/announcement-api.ts`
  - [x] Hooks: `use-notification-inbox` (optimistic read state), `use-unread-count` (visibility-aware
        polling), `use-push-registration` (asks once, never re-prompts)
  - [x] `notification-list`, `notification-bell`, `push-permission-card`, `announcement-composer`
  - [x] Pages: `/user/notifications` (+ loading), `/admin/notification-announcements` (+ loading)
  - [x] Bell in `PageWrapper`; sidebar entries; push card on the preferences page

- [x] **Phase G — Verification and documentation**
  - [x] Architecture docs rewritten to describe what exists: `delivery/queue.md`,
        `delivery/clients-and-channels.md` (stale "legacy channel toggles" section removed),
        `persistence/notification-storage.md`, new `jobs/README.md`, architecture `README.md`
  - [x] `workflows/internal-jobs.md` — the tick registry and the Hobby cron constraint
  - [x] `.env.example` — Firebase and notification tuning, with what degrades when unset
  - [x] Module `README.md`

- [x] **Phase H — Admin notice for new competition suggestions**

  Fourth intent, `ADMIN_COMPETITION_SUGGESTION`: when a competition suggestion reaches
  `UNDER_REVIEW`, everyone holding `REVIEW_COMPETITION_SUGGESTIONS` is told, once it has sat in the
  queue long enough to still be worth telling them about.

  - [x] Enum additions in their own migration (`20260918000200_add_admin_suggestion_notification`) —
        `NotificationIntent.ADMIN_COMPETITION_SUGGESTION`,
        `NotificationTargetType.COMPETITION_SUGGESTION`, `NotificationJobKind.NOTIFY_ADMINS_OF_SUGGESTION`.
        Purely additive; no table, column, index or constraint touched
  - [x] `authorization/platform/roles-with-action.ts` — the inverse of `PlatformPolicy.can`: every
        role a given action is granted to, read back out of `PlatformPermissionSet` rather than a
        second, hand-maintained role list that could disagree with it
  - [x] `policy/intent-audience.ts` — which intents apply to which actors. Every prior intent applied
        to everyone; this one is the first that does not, so "audience" became a concept the
        preferences layer needed. `NotificationPreferenceService.getForUser` now filters by it, and
        `.update` refuses to write a preference for an intent outside the actor's audience
  - [x] `policy/admin-suggestion-review.policy.ts` — pure. Two questions, deliberately separate: is
        the suggestion still awaiting review at all (`isSuggestionStillAwaitingReview`, re-checked
        against the suggestion's *current* row, never assumed from the frozen payload — ND-D-12), and
        should *this* recipient specifically be told (`shouldNotifyReviewer` — not the submitter,
        not someone who opted out)
  - [x] `content/renderers.ts` — `renderAdminSuggestionReview`; `content/action-path.ts` —
        `adminSuggestionPath`, pointing at the existing `/admin/competition-suggestions/[id]` review
        page, already behind its own authorization
  - [x] `scheduling/occurrence.ts` — `adminSuggestionOccurrenceKey(suggestionId, submittedAt)`. Keyed
        on the submission instant, not the suggestion alone, so a suggestion that leaves and returns
        to `UNDER_REVIEW` (changes requested, then resubmitted) is a new occasion and may notify again
  - [x] `backend/suggestion-queue.repository.ts` — the two reads this intent needs: suggestions
        awaiting review inside a bounded discovery window, and a page of reviewers with the intent's
        state resolved. Its own queries, following the same module-boundary rule
        `recommendations/backend/candidate.repository.ts` follows: no borrowed authorizer, no
        synthetic actor invented to satisfy a check that does not apply to a sweep
  - [x] `backend/notification-scheduler.service.ts` — `scheduleAdminSuggestionNotices`, a second
        discovery pass alongside the existing per-user one. Sweeps the suggestion table rather than
        hooking submission, so a process that dies between committing a submission and enqueueing a
        job loses nothing — the suggestion row itself is the durable record of outstanding work
  - [x] `jobs/handlers/notify-admins-of-suggestion.handler.ts` — re-reads the suggestion, re-validates,
        fans out to reviewers, re-arms its own row on a large reviewer page exactly like the
        announcement fan-out does
  - [x] `backend/notification-tick.service.ts` — the new discovery pass runs alongside the existing
        one, wrapped so a failure in either does not suppress the other or stop the drain
  - [x] `config/notification-config.ts` — `ADMIN_NOTICE_CONFIG`: the grace delay (default 30 minutes,
        the floor of the product's 30–60 minute target), the discovery lookback (default 7 days, so
        enabling this does not page anyone about a pre-existing backlog), and the per-pass discovery
        limit
  - [x] `NotificationPreferenceService` — `ADMIN_COMPETITION_SUGGESTION` defaults on (operational,
        like announcements); `isEnabledForUser(userId, intent)` added as the audience-free read a
        background worker needs, so a worker never has to construct a synthetic actor to ask "is this
        on for this user"
  - [x] Preferences card and copy — `notification-intent-copy.ts` gained an entry; the card now
        renders only the intents the API actually returned, so a non-reviewer never sees a toggle that
        would control nothing
  - [x] Reused as-is, unmodified: the inbox API, the inbox UI (`actionPath`-driven, fully
        intent-agnostic), delivery, the push pipeline, the work queue, the job runner, the tick route

### In progress

_Nothing._

### Remaining

Deliberately not built. Each is recorded in
[`phase-2/boundaries.md`](../../project/feature-specification/notification/phase-2/boundaries.md):
email/WhatsApp/mobile channels, audience targeting, per-channel preferences, a template system,
quiet hours and digests, entitlements, the per-user deadline maximum (ND-P-17), retention for
anything that participates in deduplication (A-11), and Kafka.

Two small follow-ups a future change could pick up, neither blocking:

- `push-subscription.service.ts` holds its own Prisma calls rather than delegating to a repository,
  unlike its siblings. It is a handful of queries; splitting it would be tidiness, not a fix.
- The `notification_delivery_attempt` prune pass described in `RETENTION_CONFIG` is configured but
  not yet wired into the tick. Job rows *are* pruned; attempt rows accumulate.

### External configuration — required in production, not required to write or test the code

- [ ] Firebase project created; web app registered
- [ ] `NEXT_PUBLIC_FIREBASE_*` client config values
- [ ] `NEXT_PUBLIC_FIREBASE_VAPID_KEY` (Web Push certificate key pair)
- [ ] `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (service account).
      Three separate variables, not one JSON blob — the blob form does not survive Vercel's
      environment UI, and the private key needs its escaped newlines unescaped at load
- [ ] `CRON_SECRET` set in the Vercel project (also what makes Vercel send the bearer header)
- [ ] Cron cadence matched to the plan tier — see **Vercel tier** below
- [ ] App icons at `public/icons/` — see the README there. Absent, pushes use the browser default
- [ ] Real push verified over HTTPS on a production origin, with the site closed
- [ ] iOS verification requires the site installed to the home screen; Safari delivers web push only
      to an installed PWA

Until the Firebase variables exist, the provider factory returns the fake, which records sends
instead of making them, and each push delivery is recorded `SKIPPED` with a stated reason rather
than as a send that never happened. Everything else runs normally.

### Tests completed

**358 unit, 241 integration — all passing.** Typecheck clean, production build clean, lint exactly
at the pre-existing baseline (3384 problems before and after; zero added).

| File | Covers |
| --- | --- |
| `jobs/backoff.test.ts` | Curve, cap, additive-upward jitter, spread across simultaneous failures |
| `jobs/postgres-work-queue.integration.test.ts` | **Cases 1, 2, 3** — lease recovery, disjoint concurrent claims, duplicate enqueue |
| `jobs/job-runner.integration.test.ts` | **Case 4** — handler throws; plus classification, payload rejection, fault isolation, continuation, budget |
| `scheduling/occurrence.test.ts` | Occasion stability across a day, UTC-midnight boundary, window tiling without gaps, admin-suggestion occurrence identity and resubmission |
| `content/action-path.test.ts` | Open-redirect forms: absolute, protocol-relative, backslash, traversal, scheme-in-segment |
| `content/renderers.test.ts` | `renderAdminSuggestionReview` — submitter naming, unresolvable submitter, target/payload shape |
| `delivery/fcm-error-mapping.test.ts` | Vendor classification, including unknown-code → retryable |
| `policy/registration-closing.policy.test.ts` | Relevant-or-bookmarked, registered exclusion, moved deadline, aggregation, ordering, determinism |
| `policy/admin-suggestion-review.policy.test.ts` | Every suppression reason; submitter check ordered ahead of the intent-off check |
| `policy/intent-audience.test.ts` | Visibility with and without the required action |
| `authorization/platform/roles-with-action.test.ts` | Inverse lookup against the real permission set — reviewer roles, a baseline action, an action nobody holds |
| `backend/notification-generation.integration.test.ts` | **Case 7** — atomicity; idempotency, aggregation, one in-app delivery |
| `delivery/delivery.integration.test.ts` | **Cases 5, 6, 8, 9, 10** — retry without touching the inbox, token invalidation, duplicate-push collapse, disabled-after-generation, multi-device |
| `backend/notification-pipeline.integration.test.ts` | Preferences → engine → policy → notification → inbox, end to end; silence cases; cross-user isolation; paging |
| `backend/announcement.integration.test.ts` | Authorization by role, scheduling, resumable fan-out, opt-out handling, cancellation |
| `backend/admin-suggestion-notice.integration.test.ts` | The 16 cases below, end to end against a real database |
| `preferences/backend/notification-preference.integration.test.ts` | Audience filtering — reviewer-only intent hidden from a member, shown and default-on for an admin, write refused outside the actor's audience |

All ten failure cases from the original brief are covered by a named test. The admin suggestion
notice's own dedicated file additionally covers:

| Case | Test |
| --- | --- |
| New suggestion → notice generated | "notifies once a suggestion has waited long enough" |
| Duplicate evaluation → no duplicate notification | "running discovery twice enqueues no duplicate job"; "produces exactly one notification per reviewer however many times the whole tick runs" |
| Multiple admins → correct fan-out | "reaches every reviewer, and nobody without the review permission" |
| Worker crash → recoverable | "a worker that crashes mid-job loses nothing" |
| Job retry | "retries a transient failure and eventually succeeds, without duplicating the notification" |
| Provider failure | Delegated to `delivery.integration.test.ts` (cases 5/6/8/10) — delivery is intent-agnostic; this file asserts only that the delivery job for this intent exists |
| Disabled / invalid recipient | "skips a reviewer who has switched the intent off"; "does not notify the submitter about their own suggestion" |
| Concurrent workers | "two concurrent drains never claim the same notice job" |
| Scheduler runs twice | Same as duplicate-evaluation, above |
| Timing / scheduling behavior | "does not notify before the grace delay has elapsed"; "does not notify about a suggestion older than the lookback window" |
| Partial fan-out / resumption | "resumes fan-out across pages instead of restarting or double-sending" |
| End-to-end suggestion → notification → delivery/inbox | "notifies once a suggestion has waited long enough" (asserts the notification, its target, its in-app delivery row, and the queued push job) |
| Suppressed rather than failed when handled inside the grace window | "suppresses the notice ... when the suggestion was reviewed"; "... withdrawn"; "... resubmitted" |
| Hard-deleted suggestion fails permanently, without retry | "fails the job permanently, without retry, when the suggestion has been hard-deleted" |

### Known issues

**Two pre-existing flakes, neither caused by this work.**

| Test | Symptom |
| --- | --- |
| `lib/rate-limit/postgres.store.integration.test.ts` › "increments an existing key atomically" | Asserts no lost updates under concurrent increments; intermittently sees duplicates |
| `modules/assets/backend/asset-admin.integration.test.ts` › "paginates" | Intermittent |

Both pass in isolation and fail roughly 1 run in 4 under full-suite load, which points at database
contention rather than at either test's subject.

Measured both ways: on the **original parallel** test config the suite failed in 3 of 4 full runs;
with `fileParallelism: false` (added by this work, because claiming from a shared queue is a global
operation that a key prefix cannot isolate) it fails in about 1 of 4. So the change reduces the
flakiness rather than causing it.

Verified separately that this work leaves no residue: after a full run, every notification table and
every `__vitest`-prefixed user is empty.

Worth a look by whoever owns those two areas, separately from notifications.

### Next recommended action

Configure Firebase and verify a real push on an HTTPS origin with the site closed. Everything
behind that boundary is implemented and tested against the fake provider, so this is the one thing
that cannot be checked locally.

---

## Things that will bite you

Collected here because each was discovered the expensive way, and none is obvious from the code
that caused it.

**Raw SQL must bind timestamps explicitly as UTC.** Silent, and live in the first version of the
claim query. Prisma's `DateTime` columns are `timestamp` — no time zone, holding the UTC wall clock
— but the driver binds a JS `Date` as `timestamptz`. Comparing the two makes Postgres convert the
column using the **session** time zone. On a server set to `Asia/Calcutta` this claimed jobs five
and a half hours before they were due, with no error anywhere. It would have passed unnoticed on a
UTC server and broken on any other. `utc()` in `postgres-work-queue.ts` is the fix, and it is needed
on every bound timestamp — assignments as well as comparisons. The Prisma query builder handles this
correctly on its own; only raw SQL is exposed.

**The drain loop must stop on an empty claim, not a short one.** Treating a short batch as an empty
queue saves one cheap query and quietly defers every piece of work a handler enqueues — the delivery
job that generation creates, the next page a fan-out re-arms itself for. On a daily schedule that
means a push arriving a day after its inbox row.

**Catch unique violations narrowly.** Generation caught *any* P2002 as "already generated", which
meant a genuine data error — two targets with the same identity — was reported as a harmless re-run:
no notification, no error, no trace. The catch now matches the occurrence constraint specifically.

**The enum change breaks two things.** Adding values to `NotificationIntent` makes
`notification-preference.integration.test.ts` fail (it asserted a single-intent array) and changes
what the preferences card renders. Both were handled in the same change as the migration.

**Two migration folders, not one.** `ALTER TYPE ... ADD VALUE` and any statement referencing the new
value cannot safely share a transaction, and Prisma wraps each migration in one.

**Two indexes Prisma cannot express** live as hand-written SQL, following the precedent of the
weight `CHECK` in the preference migration: a **partial unique index** on in-app deliveries
(Postgres treats `NULL`s as distinct, so the three-column constraint does not cover rows whose
subscription is null — without it one notification accumulates unlimited in-app delivery rows, and
because Prisma does not know about it those rows must be created-and-catch, never upserted), and a
**`CHECK` on the action path**, so a future write path that forgets to validate cannot introduce an
open redirect.

**Attempts increment on claim, not on completion.** Otherwise a worker that crashes mid-job never
burns an attempt and the job is re-claimed forever after every lease expiry.

**The scheduler freezes time.** See
[ND-D-07](../../project/feature-specification/notification/decisions/delivery.md#nd-d-07--occurrence-identity-is-decided-by-the-scheduler-never-by-the-worker).
A worker that computes its own occurrence key generates a second notification whenever a retry
crosses UTC midnight.

**`ApiResponse.noContent()` breaks the browser client.** `HttpClient` parses a JSON body
unconditionally, so a 204 throws. Use `ApiResponse.ok({})` — the same conclusion the competitions
controller reached and documented.

**Fan-out must not enqueue its own successor.** The job's dedupe key is unique, so inserting a
follow-up job for the next page collides with itself. It re-arms its own row instead: status back to
pending, cursor advanced.

**A push token identifies a browser, not a person.** The same browser signing in as a different user
must move the subscription's owner, not insert a second row, or the unique token constraint rejects
a perfectly legitimate re-registration.

**Integration tests keyed only on a user prefix miss the job rows.** A delivery job's dedupe key is
built from the *notification's* cuid, which carries no prefix, so prefix-scoped cleanup left them
behind to accumulate and then surface inside another file's global `claim()`. The symptom was a test
asserting "one job processed" and getting twenty-six, in a file that had nothing to do with the
cause. `src/testing/notification-cleanup.ts` exists for this.

---

## Vercel tier

Currently **Hobby**: 2 cron jobs, daily granularity — and both slots were already used by
`rate-limit/prune` and `assets/reconcile`.

This is why execution goes through **one** tick endpoint backed by a task registry rather than one
cron entry per job. One slot serves every scheduled task, each declaring its own minimum interval
and guarded by a durable last-run marker. Both maintenance jobs now run as registered tasks at their
original three-day cadence; their dedicated routes remain for manual runs.

| | Hobby | Pro |
| --- | --- | --- |
| Cron entries needed | 1 | 1 |
| Schedule | `0 13 * * *` | `*/5 * * * *` |
| `maxDuration` | 60s | up to 300s |
| Delivery latency | up to a day | minutes |
| Retry horizon | one attempt per day | as configured |

Nothing structural changes between them — only configuration. On a daily cadence, lower
`NOTIFICATION_JOB_MAX_ATTEMPTS` to about 3: a retry scheduled a minute out is not attempted for a
day, so five attempts is a five-day horizon, far longer than a deadline notification stays useful.

Two ways to get a tighter cadence on Hobby without upgrading: point an external pinger (GitHub
Actions, cron-job.org) at the same endpoint with the same bearer secret, or enable
self-continuation, which is implemented but defaulted off because it re-invokes the endpoint over
the network and needs its chain depth carried in the request rather than in memory.

### Timing: the admin suggestion notice specifically

The product target is **near-real-time, roughly 30–60 minutes, deliberately not instant and
deliberately not tied to the daily cadence.** The mechanism is cadence-agnostic by construction —
same code, same discovery query, same handler — and the *delivered* latency is simply

```text
grace delay  ≤  time to notice  ≤  grace delay + trigger interval
```

`ADMIN_NOTICE_CONFIG.suggestionNoticeDelaySeconds` (default 30 minutes) is the floor. The ceiling is
whatever the tick's own trigger cadence is, from the table above — the same constraint every other
scheduled intent in this system already lives with, not something new to this feature.

| Trigger | Delivered latency |
| --- | --- |
| Vercel Hobby, daily cron (current deployment) | 30 minutes to just under 24 hours |
| External pinger every 5 minutes | 30–35 minutes |
| Vercel Pro, `*/5 * * * *` | 30–35 minutes |
| Vercel Pro, `*/15 * * * *` | 30–45 minutes |

**On the current Hobby deployment this does not yet meet the 30–60 minute target** — a suggestion
submitted just after the daily tick runs waits until the next day. Nothing about the architecture
needs to change to fix that: pointing an external pinger at `/api/v1/internal/tick` on a 15-minute
schedule, or upgrading to Pro and changing one cron expression in `vercel.json`, lands squarely in
the target window with no code change. This is the same trade-off already documented for the two
recommendation-driven intents; this feature does not make it worse, and does not special-case around
it — the whole point of `ADMIN_NOTICE_CONFIG` is that the delay is configuration, not structure.

The grace delay is not dead time. It is the window in which the ordinary corrections happen on their
own — a reviewer already looking at the queue reviews it, a contributor withdraws a mis-submission,
a resubmission supersedes it — and the handler re-reads the suggestion before generating anything, so
work resolved inside the window produces no notification at all (ND-D-12's rule, applied here).

---

## Failure cases

| # | Case | Expected | Test |
| --- | --- | --- | --- |
| 1 | Worker crashes mid-process | Lease expires; another worker re-claims; the attempt was burned | queue |
| 2 | Two workers claim concurrently | Disjoint sets, never the same job | queue |
| 3 | Scheduler runs twice | No duplicate job, no duplicate notification | queue, generation, pipeline |
| 4 | Recommendation engine throws | Job retries with backoff; no notification created | runner |
| 5 | Notification created, push fails | Delivery retries; generation does **not** re-run | delivery |
| 6 | Provider reports invalid token | Subscription deactivated on the first attempt, not retried | delivery |
| 7 | Database fails mid-generation | Nothing partial survives | generation |
| 8 | Provider succeeds, worker crashes before recording | Recoverable; duplicate push collapsed at the client | delivery |
| 9 | User disables the intent after generation | Push skipped with a reason; inbox record remains | delivery, pipeline |
| 10 | User has several push subscriptions | One notification, independent delivery per subscription | delivery |

---

## Files this work touches

### Documentation

```text
docs/project/feature-specification/notification/
├── decisions/delivery.md                      NEW — ND-D-01..13
├── decisions/intents.md                       ND-I-19..23; ND-I-04, ND-I-10 amended
├── decisions/history.md                       ND-H-10..12
├── decisions/preferences.md                   ND-P-16, ND-P-17
├── decisions/README.md                        register index
├── intents/feature-announcement.md            NEW
├── open-decisions.md                          pruned; A-11 added
└── phase-2/{README,scope,boundaries}.md       NEW

docs/architecture/notifications/
├── IMPLEMENTATION-STATUS.md                   NEW (this file)
├── jobs/README.md                             NEW
├── README.md                                  status, reading order, environment facts
├── delivery/queue.md                          rewritten — A-3 resolved
├── delivery/clients-and-channels.md           rewritten; stale legacy section removed
└── persistence/notification-storage.md        rewritten — A-5 resolved

docs/architecture/workflows/internal-jobs.md   the tick registry, Hobby cron constraint
```

### Code

```text
next/prisma/
├── schema.prisma                              8 models, 9 enums, 3 back-relations, +3 enum values
└── migrations/20260918000000_*, 20260918000100_*, 20260918000200_*

next/src/modules/notifications/                (see the module README)
├── policy/admin-suggestion-review.policy.ts   NEW — should this notice still be sent?
├── policy/intent-audience.ts                  NEW — which intents apply to which actors
├── backend/suggestion-queue.repository.ts     NEW — the two reads this intent needs
└── jobs/handlers/notify-admins-of-suggestion.handler.ts   NEW

next/src/authorization/platform/roles-with-action.ts   NEW — every role granted an action
next/src/lib/internal-jobs/registry.ts         NEW
next/src/lib/push/firebase-client.ts           NEW
next/src/testing/notification-cleanup.ts       NEW

next/prisma/migrations/20260918000200_*        NEW — the three enum additions for this feature

next/src/app/api/v1/
├── internal/tick/                             NEW — the one cron route
├── me/notifications/**                        NEW — inbox
├── me/push-subscriptions/**                   NEW
└── admin/notification-announcements/**        NEW

next/src/app/(dashboard)/
├── user/notifications/                        NEW
└── admin/notification-announcements/          NEW

next/public/firebase-messaging-sw.js           NEW
next/public/manifest.json                      NEW
next/public/icons/README.md                    NEW — assets still needed

Modified: authorization/platform/{actions,permission-set}.ts,
lib/rate-limit/policies.ts, components/page-wrapper.tsx,
components/preferences/notification-preferences-card.tsx (now audience-filtered),
modules/preferences/{notification-intent-copy.ts NEW, backend/notification-preference.service.ts
  (now audience-aware: `getForUser`/`update` take the actor, not just an id; `isEnabledForUser`
  added as the audience-free read a background worker uses),
  backend/notification-preference.controller.ts (passes the actor through)},
app/layout.tsx, constants/dashboard-sidebar-links.ts, vercel.json,
vitest.integration.config.mts, .env.example, package.json, pnpm-workspace.yaml
```
