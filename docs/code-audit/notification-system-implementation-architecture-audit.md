# Notification System — Implementation & Architecture Audit

> **Audit type:** Cross-cutting engineering audit (architecture, security, reliability, consistency, documentation, testing)
> **Scope:** The notification subsystem as it exists in the repository today, plus everything that touches it
> **Method:** Static repository inspection — code reading, `git log`, targeted script verification of regex/logic, no runtime execution
> **Auditor note:** This is the first audit of any kind found in this repository (no `docs/code-audit/` directory existed before this file, and no `CLAUDE.md` exists anywhere in the repo)
> **Change footprint:** This file only. No implementation code, schema, migration, test, or existing documentation was modified in the course of this audit.
>
> **Addendum, 2026-09-20:** A follow-up hardening pass addressed several findings below after
> independently re-verifying each against the current code. Resolved: **NTF-AUD-001** and
> **NTF-AUD-002** (stale/dangling documentation, corrected); **NTF-AUD-004** (`NotificationDeliveryAttempt`
> pruning wired into the tick via `DeliveryRepository.pruneAttempts`); **NTF-AUD-005**
> (`push-subscription.service.ts` now delegates to a `PushSubscriptionRepository`); **NTF-AUD-003**
> (`raw.md` marked superseded with a pointer to ND-D-13, not deleted); **NTF-AUD-011** (direct
> `NotificationAnnouncementAuthorizer` unit tests added). Investigated and confirmed **not** dead
> code, contrary to how NTF-AUD-006, -007, -008, -009 could be read: `onForegroundMessage()` and
> `NotificationDTO.payload` are documented intentional forward-provisioning, and
> `/internal/notification/top-competition` is a documented, intentional Phase-0 QA tool
> (`docs/architecture/recommendation/testing.md`) — none were removed. The original findings below
> are left as written at audit time; see `docs/architecture/notifications/IMPLEMENTATION-STATUS.md`
> for current state.

---

## 0. How to read this document

Findings are numbered `NTF-AUD-001` … `NTF-AUD-021` and appear inline in the section they belong to, then again in the consolidated table in §17. Each finding states what the code *actually* does, evidenced by exact file paths, before saying what should change. Where a claim could not be verified against the repository, it is stated as such rather than assumed.

Severity is calibrated against actual blast radius in this codebase today, not against a hypothetical worst case. Reading everything below in order: **the notification system is, on the whole, an unusually mature and self-consistent piece of engineering for a first version** — most of what follows is refinement, not alarm. There are no CRITICAL or HIGH findings. That is a finding in itself and is discussed in §14.

---

## 1. Discovered Notification Surface

Discovery was not limited to files or directories named "notification." What follows is what actually participates in the system, established by reading imports, database relationships, and route registrations — not by name matching.

### 1.1 Core module

`next/src/modules/notifications/` — a full vertical slice, sibling to `competitions`, `recommendations`, `preferences`, etc. (`docs/architecture/notifications/module-boundaries.md` states this placement explicitly; confirmed by directory listing):

```
notifications/
  backend/        controllers, services, repositories (inbox, announcements, push subscriptions,
                  scheduler, generation, policy orchestration, tick composition, authorization)
  policy/         pure decision functions (one per intent) + intent-audience gating
  content/        renderers, action-path safety, announcement-URL safety, draft type
  scheduling/     pure occurrence-key / window / dedupe-key builders
  jobs/           WorkQueue port + Postgres implementation, job runner, backoff, 5 handlers
  delivery/       PushProvider port + FCM/fake implementations, delivery service/repository
  config/         all tuning constants, one file
  frontend/       components + hooks
  api/            client HTTP wrappers
  errors/, observability/, schemas/, types/
```

### 1.2 A load-bearing sibling module: `preferences`

`next/src/modules/preferences/` owns the `NotificationPreference` Prisma model and `NotificationPreferenceService`, **not** `modules/notifications` itself. This is a real architectural split (discussed in §5.3), confirmed by `next/src/modules/preferences/backend/notification-preference.service.ts`.

### 1.3 Database models (`next/prisma/schema.prisma`, lines 259–594)

`NotificationIntent` (enum, 4 values), `NotificationPreference`, `Notification`, `NotificationTarget`, `NotificationDelivery`, `NotificationDeliveryAttempt`, `PushSubscription`, `NotificationJob`, `FeatureAnnouncement`, plus `InternalJobRun` (shared with two unrelated maintenance jobs) and enums `NotificationTargetType`, `NotificationChannel` (`IN_APP`, `WEB_PUSH` — no email/SMS), `NotificationDeliveryStatus`, `NotificationDeliveryOutcome`, `PushProviderId` (`FCM` only), `PushSubscriptionStatus`, `NotificationJobKind` (5 values), `NotificationJobStatus`, `FeatureAnnouncementStatus`.

Two hand-written database objects exist because Prisma cannot express them, both confirmed in `next/prisma/migrations/20260918000100_add_notification_delivery_and_jobs/migration.sql`:
- A **partial unique index** (line 252) enforcing exactly one `IN_APP` delivery row per notification, since Postgres treats `NULL` as distinct in an ordinary unique index.
- A **CHECK constraint** (line 266) enforcing `actionPath` is a relative, single-leading-slash path — a database-level backstop for the open-redirect guard discussed in §7.

### 1.4 HTTP surface (`next/src/app/api/v1/...`)

| Route | Method(s) | Controller | Auth |
|---|---|---|---|
| `me/notifications` | GET | `NotificationController` | session, self-scoped |
| `me/notifications/unread-count` | GET | `NotificationController` | session |
| `me/notifications/[id]/read` | PATCH | `NotificationController` | session, self-scoped |
| `me/notifications/read-all` | POST | `NotificationController` | session |
| `me/notifications/[id]/responded` | PATCH | `NotificationController` | session |
| `me/push-subscriptions` | GET, POST | `PushSubscriptionController` | session |
| `me/push-subscriptions/[id]` | DELETE | `PushSubscriptionController` | session, self-scoped |
| `me/notification-preferences` | GET, PATCH | `NotificationPreferenceController` (lives in `modules/preferences`) | session |
| `admin/notification-announcements` | GET, POST | `AnnouncementController` | session + `MANAGE_NOTIFICATION_ANNOUNCEMENTS`, enforced in the **service** |
| `admin/notification-announcements/[id]` | cancel | `AnnouncementController` | same |
| `internal/tick` | GET | inline route + `NotificationTickService` | `Authorization: Bearer <CRON_SECRET>`, constant-time compare |

Every user-facing route has its own `RateLimitPolicyId` (verified in `next/src/lib/rate-limit/policies.ts`, lines 58–89, 277–357) — see §8.5.

### 1.5 Frontend surface

`frontend/components/{notification-bell,notification-list,push-permission-card,announcement-composer}.tsx`, `frontend/hooks/{use-notification-inbox,use-unread-count,use-push-registration}.ts`, `src/components/preferences/notification-preferences-card.tsx`, `src/lib/push/firebase-client.ts`, `public/firebase-messaging-sw.js`, `public/manifest.json`. Pages: `/user/notifications`, `/user/notification-preferences`, `/admin/notification-announcements`.

### 1.6 Background infrastructure

`GET /api/v1/internal/tick` (`next/src/app/api/v1/internal/tick/route.ts`) — one endpoint dispatching a **registry** of three unrelated tasks (`notifications:tick`, `rate-limit:prune`, `assets:reconcile`), because the deployment target (Vercel Hobby) allows only two daily cron slots and the project already used both before this feature (documented in the route's own file header, and in `docs/architecture/workflows/internal-jobs.md`). This is the one place notifications shares infrastructure with two unrelated subsystems.

### 1.7 External integration

Firebase Cloud Messaging, via `firebase-admin` (server, `delivery/fcm-push-provider.ts`, the *only* file importing it) and the `firebase` client SDK (browser, dynamically imported by `src/lib/push/firebase-client.ts`, and via `importScripts` in the plain-JS service worker `public/firebase-messaging-sw.js`).

### 1.8 Cross-module dependencies (traced via imports, not naming)

**Notifications → other modules** (reads/calls only, confirmed no writes into other modules' tables):
- `modules/recommendations/backend/recommendation.service.ts` (`RecommendationService.generateForUser`) — called from `notification-policy.service.ts` and `evaluate-registration-closing.handler.ts`.
- `modules/preferences/backend/notification-preference.service.ts` — called from policy, delivery, and the registration-closing handler.
- `modules/competitions` — only its mapper/DTO shape (`competitionMapper.toCardDTO`), used to render a card; raw `Competition`, `CompetitionBookmark`, `CompetitionRegistration`, `CompetitionSuggestion` tables are read directly via Prisma inside notifications' own repositories (`DeadlineWindowRepository`, `SuggestionQueueRepository`), never through competitions' services.
- `authorization/platform/roles-with-action.ts` — a new, general-purpose inversion helper (`rolesWithAction`) added specifically to support the reviewer-audience lookup, confirmed in `next/src/authorization/platform/roles-with-action.ts` and its test.

**Other modules → Notifications:** only `modules/preferences` imports from `modules/notifications` (`INTENT_REQUIRED_ACTION` from `policy/intent-audience.ts`). No code in `competitions`, `registrations`, `bookmarks`, or `auth` imports or calls into `modules/notifications` — confirming the documented "direction rule" (`docs/architecture/notifications/module-boundaries.md`: notifications decides for itself; other domains never call in to trigger one) is actually followed, not just asserted.

### 1.9 Unexpected / previously-undocumented functionality found during discovery

- **`next/src/app/(dashboard)/internal/notification/top-competition/`** — despite its path, this is a **recommendation-engine debug tool**, not notification functionality. It calls `RecommendationApi.generateForCurrentUser()` and creates no notification. It is authenticated but explicitly not admin-gated (any signed-in user, own account only). See NTF-AUD-007.
- **A dormant self-continuation capability** (`NOTIFICATION_WORKER_SELF_CONTINUE`) is fully implemented in `JOB_CONFIG` but defaults to `false` and — per grep — is not invoked anywhere in the current codebase beyond its own config/tests. See §9.6.
- **Two internal-jobs maintenance tasks** (`rate-limit:prune`, `assets:reconcile`) were moved onto the notification tick's endpoint purely to fit Vercel's cron-slot ceiling — a piece of shared infrastructure that has nothing to do with notifications semantically but now shares its trigger, timeout budget, and failure surface. This is documented, not accidental, but it does mean a change to `notifications:tick`'s behavior (e.g. its wall-clock budget) has to be considered alongside two other domains' jobs.
- **`docs/architecture/notifications/raw.md`** — an unprocessed, typo-laden scratch note about wanting an expiry concept for stale notifications, which *was* subsequently formalized as `DELIVERY_CONFIG.pushValidForSeconds` / ND-D-13, but the scratch file itself was never removed. See NTF-AUD-003.

---

## 2. End-to-End Execution Map

Three genuinely distinct flows exist. All three are traced here to where the repository's own guarantees end.

### 2.1 Scheduled per-user evaluation (`TOP_RELEVANT_COMPETITION`, `REGISTRATION_CLOSING`)

```
GET /api/v1/internal/tick  (CRON_SECRET, constant-time compare, fail-closed 401)
  → runDueTasks()  [next/src/lib/internal-jobs/registry.ts]
    → NotificationTickService.run()
      → NotificationSchedulerService.scheduleDueEvaluations(anchor)
          for each of the two scheduled intents:
            page over NotificationPreference rows WHERE intent=X AND enabled=true
              [only users who explicitly opted in — both intents default OFF,
               confirmed in schema.prisma:274 and DEFAULT_ENABLED map]
            freeze occurrenceKey + (for REGISTRATION_CLOSING) the deadline window
              into each job's payload — never recomputed by the worker (ND-D-07)
            enqueueMany() → NotificationJob rows, dedupeKey unique per (kind,user,occasion)
              — a second scheduling pass for the same day is absorbed as duplicates
      → JobRunner.run() drains the SAME tick:
          claim() — one UPDATE ... FOR UPDATE SKIP LOCKED, attempts++ on claim
          dispatch by kind:
            EVALUATE_TOP_RELEVANT_COMPETITION
              → NotificationPolicyService.evaluateTopRelevantCompetition()
                → RecommendationService.generateForUser()  [Phase-0 engine, no caching — see NTF-AUD-015]
                → pure policy fn → eligible | suppressed(reason)
            EVALUATE_REGISTRATION_CLOSING
              → reads DeadlineWindowRepository (raw Competition/Bookmark/Registration queries)
              → RecommendationService.generateForUser() [independently — see NTF-AUD-015]
              → pure policy fn → eligible | suppressed(reason)
          if eligible:
            renderer builds a NotificationDraft (title/body/actionPath snapshot)
            NotificationGenerationService.generate() — ONE Prisma $transaction:
              create Notification + NotificationTarget[] + IN_APP NotificationDelivery(DELIVERED)
              + enqueue a DELIVER_NOTIFICATION job, all-or-nothing
            (idempotent: a repeat occurrence hits the unique constraint and is
             treated as success, narrowly caught on the occurrenceKey constraint only)
          complete() or fail()-with-backoff, per job, isolated per job (one bad
          job cannot abort the batch)
      → loop continues claiming until an EMPTY claim (not a short batch) —
        deliberately, because a job just enqueued a DELIVER_NOTIFICATION job that
        this same drain should also pick up in the same tick
      → DELIVER_NOTIFICATION job claimed:
        → DeliveryService.deliver()
          → re-check preference NOW, not at generation time (ND-D-12)
          → skip if stale (> pushValidForSeconds old) — SKIPPED, not FAILED
          → fan out per active PushSubscription, independently
          → PushProvider.send() (FCM, or Fake if unconfigured — logged once)
          → classify: ACCEPTED | INVALID_TOKEN | PERMANENT | RETRYABLE
          → persist NotificationDeliveryAttempt + update NotificationDelivery status
          → RETRYABLE re-schedules with jittered backoff; INVALID_TOKEN deactivates
            the subscription immediately; 5 consecutive RETRYABLE failures on one
            subscription also deactivates it defensively
      → workQueue.prune() — deletes COMPLETED/FAILED/CANCELLED NotificationJob
        rows older than 7 days (default), bounded batch (500/pass)
  → returns a JSON summary; a per-task failure is reported in the body, not as
    an HTTP failure — the platform's retry would otherwise re-run tasks that
    already succeeded
```

**Where this trace ends:** the FCM SDK's own delivery guarantee to the device, and whether the OS/browser actually displays the banner while Kizunia is closed. Nothing in this repository observes that — see §12.4 and NTF-AUD-010.

### 2.2 Admin-authored broadcast (`FEATURE_ANNOUNCEMENT`)

```
POST /api/v1/admin/notification-announcements
  → AnnouncementController.create → NotificationAnnouncementAuthorizer.manage()
    [checked in the SERVICE, not the controller, so no caller can reach the
     capability by going around the HTTP layer — confirmed in
     next/src/modules/notifications/backend/authorization/authorizer.ts]
  → isSafeAnnouncementUrl() — https:// only, or isSafeActionPath() — validated
    at the schema AND the service (defense against any non-HTTP writer)
  → FeatureAnnouncement row created, status DRAFT/SCHEDULED
  → a FANOUT_ANNOUNCEMENT NotificationJob enqueued (dedupeKey = announcement id)
      runAt = the chosen scheduledFor, or "now"

Tick drains it when due:
  fanoutAnnouncementHandler:
    → query User WHERE status=ACTIVE AND NOT banned
        AND NOT (has an explicit opt-out row for FEATURE_ANNOUNCEMENT)
      [announcements default ON — ND-P-16 — so this is an inverted,
       exclude-the-opted-out query, unlike the two opt-in intents above]
    page by id (keyset, stable under concurrent inserts), 200/page
    for each user: NotificationGenerationService.generate() (same transactional
      outbox as §2.1), isolated per user
    if a full page was processed: RESCHEDULE the SAME job row with the cursor
      advanced, runAt=now — never enqueue a successor (would collide on the
      same dedupe key) — the runner re-claims it in the same drain pass
    else: mark the FeatureAnnouncement PUBLISHED
  Cancellation: DELETE while status ∈ {DRAFT, SCHEDULED, PUBLISHING} flips it to
    CANCELLED; the handler checks this on every page and stops fanning out
```

### 2.3 Operational admin notice (`ADMIN_COMPETITION_SUGGESTION`)

```
Tick, second scheduling pass (independent of §2.1's, and independent in error
handling — a failure in one must not suppress the other, per
notification-tick.service.ts's own docstring):

  NotificationSchedulerService.scheduleAdminSuggestionNotices()
    → SuggestionQueueRepository.findAwaitingReview() — CompetitionSuggestion rows
      submitted between (now - lookback) and (now - grace delay)
      [grace delay lets self-correction happen: a withdrawal or resubmission
       inside the window produces no notice at all]
    → one NOTIFY_ADMINS_OF_SUGGESTION job PER SUGGESTION (not per reviewer —
      the expensive check is per-suggestion and identical for every reviewer)

  notify-admins-of-suggestion.handler.ts (on drain):
    → RE-READS the suggestion (not trusting the frozen occasion) — suppressed
      if no longer awaiting review, or if submittedAt has moved (a resubmission)
    → rolesWithAction(REVIEW_COMPETITION_SUGGESTIONS) → every reviewer role
    → for each reviewer EXCEPT the submitter, respecting their own opt-out:
        NotificationGenerationService.generate() — same transactional outbox
    → resumable fan-out across reviewers, same pattern as §2.2
```

### 2.4 Inbox / preferences / push-subscription flows (synchronous, user-facing)

All five inbox endpoints, both push-subscription endpoints, and both preference endpoints are synchronous request/response with no queue involvement. Ownership is enforced structurally (`WHERE userId = actor.id`) rather than by a permission check — confirmed in `notification.service.ts`, `push-subscription.service.ts`, and explicitly argued in `authorizer.ts`'s own docstring as "a `where` clause that cannot match someone else's row is a stronger guarantee than a check that can be forgotten."

---

## 3. Actual Feature Set

Four intents exist, and only four — confirmed against `NotificationIntent` in the schema and cross-checked against every policy/handler/test file. No fifth intent, draft intent, or partially-wired intent was found anywhere (no dead enum values, no half-built handler).

| Intent | Trigger | Audience | Dedup key basis | Channel(s) |
|---|---|---|---|---|
| `TOP_RELEVANT_COMPETITION` | Daily scheduled sweep | Opted-in users (default OFF) | `user + intent + UTC day` | IN_APP + WEB_PUSH |
| `REGISTRATION_CLOSING` | Daily scheduled sweep, 2-day deadline window | Opted-in users (default OFF) | `user + intent + UTC day`; subject identity includes deadline epoch (a moved deadline re-notifies) | IN_APP + WEB_PUSH |
| `FEATURE_ANNOUNCEMENT` | Admin-authored, scheduled or immediate | All active, non-banned users who have not opted out (default ON) | `user + intent + announcement id` | IN_APP + WEB_PUSH |
| `ADMIN_COMPETITION_SUGGESTION` | Suggestion sitting in review queue past a grace delay | Every role holding `REVIEW_COMPETITION_SUGGESTIONS`, minus the submitter, minus opted-out reviewers (default ON) | `user + intent + suggestion id + submittedAt` (resubmission = new occasion) | IN_APP + WEB_PUSH |

Channels: exactly two (`IN_APP`, `WEB_PUSH`). No email, SMS, or mobile-push channel exists anywhere in the codebase — `src/lib/auth/email.ts`'s `sendEmail()` is a stub used only by the unrelated auth-verification flow and has zero connection to `NotificationChannel`. This matches `docs/project/feature-specification/notification/phase-2/boundaries.md`'s explicit non-goal list.

**Deduplication mechanism**, uniformly: a database unique constraint on `(userId, intent, occurrenceKey)`, computed once by the scheduler/handler and frozen into the job payload, never recomputed by a retrying worker (ND-D-07). A duplicate write is caught narrowly (only when the violated constraint is the occurrence key — see NTF-AUD discussion in §6.2) and treated as success, not error.

**Failure handling**, uniformly: every write path (schedule, generate, deliver) distinguishes a deliberate non-outcome (suppressed, skipped, already-generated) from an actual failure, and only actual failures consume a retry attempt.

**Partially implemented / documented-but-not-built / abandoned functionality found:**
- Per-channel preferences (documented as an explicit non-goal, `phase-2/boundaries.md`) — genuinely absent, not partially built.
- An entitlement/capability seam for delivery (open decision A-9) — genuinely undecided; the code does not obstruct adding one later but does not have one now.
- Retention policy for anything participating in deduplication (open decision A-11) — genuinely undecided and unimplemented; see NTF-AUD-004.
- `NotificationDTO.payload` — sent to the client, documented as enabling "richer rendering," never read by any frontend code (NTF-AUD-009). Not abandoned exactly — more forward-provisioned and currently inert.
- `onForegroundMessage()` — fully built, exported, zero callers (NTF-AUD-008).

---

## 4. Architecture Audit

### 4.1 The pipeline shape

The system follows a documented pipeline (`docs/architecture/notifications/pipeline/README.md`): Trigger → Eligibility → Candidates → Filters → Preferences → Relevance → Ranking → Selection → Policy → Generation → Delivery. In the actual code this is not one literal pipeline object but a composition of small, independently testable units (scheduler → policy service → pure policy function → renderer → generation service → delivery service), each owning exactly one of those stages. Verified this is followed consistently across all four intents by reading every handler in `jobs/handlers/`.

**Assessment:** internally coherent and consistently applied. The separation between "decide" (pure functions in `policy/`, zero I/O, fully unit-testable) and "do" (services in `backend/`, all I/O) is real, not aspirational — confirmed by `policy/*.ts` containing no Prisma imports anywhere. This is the single most valuable architectural property of the subsystem: the four policy test files (`top-relevant-competition.policy.test.ts`, `registration-closing.policy.test.ts`, `admin-suggestion-review.policy.test.ts`, `intent-audience.test.ts`) run with no database and are the fastest, most exhaustive tests in the suite because of it.

### 4.2 Generation vs. delivery as separate concerns

`NotificationGenerationService` and `DeliveryService` are deliberately separate, with generation never touching a provider and delivery never touching the policy or the inbox record (`ND-D-01`, confirmed as an explicit "Does NOT" in `delivery.service.ts`'s own header). This is the correct shape for the stated failure isolation goal (a push failing must not un-notify someone) and is enforced by the transactional-outbox pattern in `notification-generation.service.ts` (§2.1) — this is textbook and well-executed, not over-engineered: the alternative (writing the notification and firing a push inline) is exactly the class of bug ("commit one, fail before the other, silently") the file's own docstring identifies.

### 4.3 The `WorkQueue` and `PushProvider` ports

Two seams exist for exactly the two things named as plausibly-replaceable in the architecture docs: the queue (Postgres today, Kafka named as the theoretical future in `ND-D-02`) and the push provider (FCM today). Both have exactly one production implementation and one test/fallback implementation (`FakePushProvider`), and no third implementation exists — this is a port introduced *because* a second implementation is plausible (Kafka is explicitly named), not introduced speculatively for its own sake. This matches the repository's own principle 8 ("every abstraction must justify itself") and appears to be applied honestly rather than as a slogan: no other seam in this module has more than one implementation.

### 4.4 Raw SQL confined to one file

`jobs/postgres-work-queue.ts` is the only file in the module writing raw SQL, and it says so in its own header. The claim operation (CTE + `FOR UPDATE SKIP LOCKED`, confirmed at lines 169–200) genuinely cannot be expressed through Prisma's query builder as a single atomic statement, so this is a justified, narrow exception rather than raw SQL creeping across the module. The UTC-binding helper (`utc()`, lines 93–95) exists because of a real, previously-observed production-class bug (documented in the file's own comment: a job scheduled 1 minute out on a non-UTC server was claimed immediately) — this is exactly the kind of hard-won knowledge that belongs in a comment next to the code it protects, and it is.

### 4.5 Where the architecture is more complex than the smallest possible design

- **Two separate scheduling passes composed by one tick service** (§2.1 vs §2.3) rather than one unified "find due work" query. Justified: the two passes answer genuinely different questions (per-user relevance vs. queue-age), and unifying them would force one failure-isolation boundary onto two independent concerns. Not over-engineered.
- **A job-kind registry exhaustive over a 5-member enum** (`jobs/handlers/index.ts`) rather than a lookup table keyed by string. This is a deliberate compile-time safety measure (TypeScript will refuse to compile if a `NotificationJobKind` is added without a handler) and costs nothing in readability. Justified.
- **The `NotificationJob.payload` JSON column carrying frozen decision inputs** rather than the worker re-deriving them, is more machinery than the naive "just re-run the query" approach — but the naive approach is the one that produces the UTC-midnight double-notification bug the comments explicitly warn about (ND-D-07). Justified by a named, specific failure mode, not by generic caution.

No instance of complexity introduced *without* a stated, checkable reason was found. This is unusual for a first-version subsystem of this size and is called out specifically in §14.

---

## 5. Consistency With the Rest of Kizunia

`modules/competitions/backend/` was read as the mature-module baseline (16+ services, each with its own repository and, where a distinct shape exists, its own `*.mapper.ts` file; a `facade.ts` unifying access).

| Pattern | Competitions convention | Notifications | Classification |
|---|---|---|---|
| Controller → Service → Repository | Consistently three layers | Consistently three layers, except `PushSubscriptionService` (below) | **Consistent**, one deliberate exception |
| DTO mapping | Dedicated `*.mapper.ts` per submodel | Inline `toDTO()` helper functions inside service files | **New pattern, arguably unnecessary divergence** — see NTF-AUD-006 |
| Authorization | `PlatformPolicy.can()` invoked from the service | Same (`NotificationAnnouncementAuthorizer` wraps it) | **Consistent** |
| Ownership-scoped resources | `WHERE` clause scoping, not a permission check (confirmed pattern in competitions' bookmark/registration services) | Same, explicitly argued in `authorizer.ts`'s own docstring | **Consistent, and the reasoning is stated rather than assumed** |
| Rate limiting | Per-route `RateLimitPolicyId` with a documented fail-open/fail-closed rationale | Same, five new policies each with an inline rationale paragraph | **Consistent** |
| Structured logging | `console.log`/`console.error` with a JSON payload (no logging library exists in the repo) | Same shape (`observability/log.ts`) | **Consistent, and honestly scoped** — the file's own comment states a logging abstraction is not justified here, matching the rest of the repo not having one |
| Config centralization | One `*-config.ts` per module reading `envInt`/`envFlag` overrides | Same shape, explicitly modeled on `recommendations/config/recommendation-config.ts` per its own header comment | **Consistent** |
| Raw SQL | Avoided except where a single implementation genuinely requires it (rate-limit store is the other known instance) | One file (`postgres-work-queue.ts`), for the same class of reason | **Consistent** |
| Internal/cron jobs | `Authorization: Bearer <CRON_SECRET>`, constant-time compare, fail-closed 401, `GET`, `dynamic = "force-dynamic"` | Identical, confirmed by comparing `internal/tick/route.ts` against `docs/architecture/workflows/internal-jobs.md`'s own convention description | **Consistent** |
| Module boundary direction | A module owns its writes; a consumer reads another module's tables directly rather than borrowing its services, when a service call isn't warranted | Same — notifications reads `Competition`/`CompetitionBookmark`/`CompetitionRegistration` directly via its own repositories rather than through competitions' services, except the one intentional exception (`RecommendationService.generateForUser`, a genuine cross-module *capability* call, not a data borrow) | **Consistent, and the one exception is the kind the convention itself allows** |

**New pattern worth standardizing:** the pure-`policy/`-vs-impure-`backend/` split (§4.1) does not appear to exist as a named convention anywhere else in the repository (confirmed: `recommendations` has an `engine/` directory with a similar spirit, but no other module was found with an equivalent explicit split). Given how much test-speed and clarity benefit this audit observed in the four policy test files, this looks like a pattern worth deliberately extracting into a documented repository-wide convention rather than leaving it a notification-module-only technique.

**Where notifications intentionally differs, for a stated and reasonable reason:** the announcement-URL validation is documented as living outside the "validation happens in the controller" convention *specifically* because a human authors the one field in the whole subsystem that could carry attacker-influenced content, and it must be enforced no matter which caller writes it, not only the HTTP one (`content/announcement-url.ts`'s own header). This is a legitimate, narrow, and self-documented exception — not drift.

---

## 6. Internal Consistency of the Notification System

### 6.1 State machine consistency

`NotificationDeliveryStatus` (`PENDING → SENT/DELIVERED/FAILED/SKIPPED`) is applied identically by both the generation path (IN_APP, created already `DELIVERED`) and the delivery path (WEB_PUSH, transitions through the full machine) — confirmed by reading both write sites. `NotificationJobStatus` and the job runner's outcome vocabulary (`completed | continued | retried | failed`) are applied uniformly across all five job kinds via one shared `JobRunner`, not five bespoke loops. No divergent or duplicate state machine was found for the same concept.

### 6.2 Idempotency consistency

Every write that must not double-fire is protected by a **database** unique constraint, not an application-level check-then-write: `notification_userId_intent_occurrenceKey_key`, `notification_job_dedupeKey_key`, the partial `notification_delivery` index. All three narrow their `catch` to the specific constraint being defended (confirmed in `notification-generation.service.ts`'s `isUniqueViolationOn()`, which matches on a `meta.target` marker rather than swallowing every `P2002`) — this is a genuinely careful detail: a broader catch would silently absorb an unrelated data-integrity bug as "already handled." This pattern is applied consistently at all three sites that need it (occurrence, in-app delivery, delivery job) and nowhere over-applied to a constraint violation that should actually be fatal.

### 6.3 Preference semantics consistency

"No preference row" means two different things depending on the intent's declared default (`DEFAULT_ENABLED` in `preferences/backend/notification-preference.service.ts`: `false` for the two competition intents, `true` for announcements and admin notices) — and every consumer of preference state (the scheduler's opt-in query, the fan-out's opt-out query, `isEnabledForUser`, the preferences card) is verified to consult the *same* default map or its derived query shape, not a locally-hardcoded assumption. This is the one place a naive audit would expect to find drift (two different query directions — "opted in" vs. "not opted out" — for what looks like the same underlying concept) and it does not: the inversion is deliberate, stated in `fanout-announcement.handler.ts`'s own comment, and each query is provably consistent with its intent's own default.

### 6.4 No duplicate abstractions found

No second `WorkQueue` implementation, no second `PushProvider` beyond the fake, no parallel notification-creation path outside `NotificationGenerationService.generate()` (confirmed: every one of the four handlers calls this same method; no handler writes a `Notification` row directly).

### 6.5 One acknowledged, deliberate inconsistency

`PushSubscriptionService` talks to Prisma directly with no `PushSubscriptionRepository`, unlike `NotificationRepository`, `DeliveryRepository`, `DeadlineWindowRepository`, and `SuggestionQueueRepository`, which all exist for their respective services. This is **not accidental drift discovered by this audit** — it is explicitly named in `docs/architecture/notifications/IMPLEMENTATION-STATUS.md` as a known, deliberately-deferred tidiness gap. See NTF-AUD-005.

---

## 7. Security Audit

### 7.1 The open-redirect / deep-link boundary — verified sound

`content/action-path.ts`'s `isSafeActionPath()` was inspected byte-for-byte, not just read, because its `FORBIDDEN` character class (`/[\s --\\]/`) renders as ambiguous prose in a plain read. A hex dump of the source file (`awk 'NR==29' ... | xxd`) confirms the character class actually contains **literal, embedded raw control bytes** used as range endpoints — `\x00`–`\x1F` and `\x7F`–`\x9F` — rather than hex escapes, plus `\s` and a literal backslash. A script-verified scan of code points `0x00`–`0x9F` confirms the regex correctly rejects every C0 control character, space, DEL, every C1 control character, and backslash, and admits ordinary printable characters including hyphens, which are common in competition slugs. **This function behaves correctly today.** See NTF-AUD-019 for the maintainability risk this authoring technique carries independent of its current correctness.

The full defense is layered and each layer was independently confirmed:
1. `isSafeActionPath()` — whitelist: must start with `/`, must not start with `//`, no forbidden characters, no `..`, no `:` in the first segment.
2. `isSafeAnnouncementUrl()` (`content/announcement-url.ts`) — the one place a human authors notification content: accepts a safe action path, or an absolute URL whose `new URL(value).protocol === "https:"` (using the platform's own URL parser rather than a hand-rolled scheme regex, per its own comment — a materially better choice than pattern-matching schemes).
3. Enforced at both the Zod schema and the service layer for the announcement URL specifically, because a future non-HTTP writer (a seed script, an internal tool) would otherwise bypass schema validation entirely (stated rationale in the file header, and independently plausible given this is a real Next.js/Prisma repo where seed scripts exist).
4. A database CHECK constraint (§1.3) as the last-resort backstop if a future write path forgets to call the validator at all.

No open-redirect, XSS, or scheme-smuggling path was found through any of the four layers.

### 7.2 Authentication and authorization

Every user-facing controller resolves the actor via `SessionService.getStrictActor(request)` and never accepts a client-supplied `userId` (confirmed across all of `notification.controller.ts`). Ownership on inbox and push-subscription rows is enforced by `WHERE` clause, not by a permission that could be forgotten (§2.4). The one genuine authorization gate (`MANAGE_NOTIFICATION_ANNOUNCEMENTS`, ADMIN/SUPER_ADMIN only) is checked inside the service, so a hypothetical second HTTP route, a script, or a test helper calling the service directly cannot bypass it by skipping the controller — verified by reading `AnnouncementService` and confirming the authorizer call is not duplicated-and-therefore-skippable at the controller layer.

**NTF-AUD-012 (informational):** `/admin/notification-announcements` has no page-level role guard (`app/(dashboard)/admin/layout.tsx` sets metadata only, per the frontend discovery pass); a non-admin can load the page shell and see the composer UI, and every API call it makes will then be rejected server-side. This matches the rest of the repository's convention (defense is API-side, confirmed as the pattern in competitions' admin surfaces too), so it is not notification-specific drift — but it is worth naming explicitly in a security audit as "no defense in depth at the page layer," repository-wide, not just here.

### 7.3 Push-subscription trust boundary

**NTF-AUD-013.** `PushSubscriptionService.register()` (confirmed, `push-subscription.service.ts` lines 47–78) upserts a `PushSubscription` keyed by the client-supplied `token`, moving it to the calling session's `userId` on every call — by design, to support a shared browser being re-used by a different Kizunia account (documented rationale in the file header: "a token identifies a browser, not a person"). No proof-of-possession is required beyond presenting the token value over an authenticated session. This is standard for FCM-based push registration industry-wide (the token is inherently a bearer value the browser hands to whichever server asks), and the design decision here is reasonable — but it does mean that if a specific token value were ever exposed outside its own browser (e.g., leaked in a client-side log, a third-party SDK bug, or a browser extension), any authenticated Kizunia user who obtained it could silently redirect that browser's push channel to their own account, and the original owner would simply stop receiving pushes with no notification of the change. No code path here worsens the inherent FCM trust model, but nothing in this module strengthens it either (no notification to the previous owner, no reuse-velocity check). Not currently exploitable through any code defect found in this audit — flagged as a standing characteristic of the design worth being aware of.

### 7.4 Rate limiting — reasoned, not templated

Each of the five notification-specific rate-limit policies (`NOTIFICATION_PREFERENCES_{READ,WRITE}`, `NOTIFICATIONS_{INBOX_READ,UNREAD_COUNT,MARK_READ}`, `PUSH_SUBSCRIPTIONS_WRITE`, `ANNOUNCEMENTS_WRITE`) has its own limit, window, and fail-open/fail-closed choice, each justified by a specific cost/blast-radius argument rather than a copy-pasted default (verified by reading all eight policy definitions in `next/src/lib/rate-limit/policies.ts`, lines 277–357). Two stand out as correctly differentiated from the rest:
- `PUSH_SUBSCRIPTIONS_WRITE` fails **closed** because an unbounded registration loop mints requests against a billed external provider's quota, degrading delivery for every user, not just the caller.
- `ANNOUNCEMENTS_WRITE` fails **closed** and is capped low (30/hour) specifically because it is "the one mistake in this subsystem that reaches everybody at once" — a blast-radius limit, not a fairness limit, per its own description.

This is the correct differentiation to make, and it is made explicitly rather than left implicit.

### 7.5 Secrets and credentials

`FIREBASE_PRIVATE_KEY` is read once, in `delivery/push-provider.factory.ts`'s `readFirebaseConfig()`, validated to look like a PEM key before use (rejecting a mangled-but-present value rather than letting it fail at the first send with an untraceable vendor error), and never logged. `CRON_SECRET` is compared with `secretEquals` (a timing-safe comparison, confirmed by name and by the file header's own description of the internal-jobs convention). No secret was found logged, echoed in an API response, or embedded in a client bundle. The token value on a `PushSubscription` is explicitly never returned by `toDTO()` (`push-subscription.service.ts` line 137's own comment states why).

### 7.6 No findings in: SQL injection, IDOR beyond §7.3, replay/duplication abuse beyond what §6.2 already covers as a reliability property

The raw SQL in `postgres-work-queue.ts` parameterizes every value through `Prisma.sql` template tags (confirmed, no string concatenation of untrusted input anywhere in the file); enum literals are cast, not interpolated as raw strings from user input. No caller-controlled value reaches that file at all — its inputs are `now`, `limit`, `leaseSeconds`, and `owner` (a process-generated string), none of which originate from a request body.

---

## 8. Reliability and Failure-Mode Audit

Distinguishing **guaranteed** (enforced by a database constraint or atomic statement), **best-effort** (documented as such, with a stated bound), and **unverified** (repository evidence does not settle the question) below.

| Scenario | Behavior | Basis |
|---|---|---|
| Two tick executions run simultaneously | **Guaranteed safe.** Scheduling is idempotent on `dedupeKey`; claiming uses `FOR UPDATE SKIP LOCKED`, so the two executions partition the claimable set rather than double-claiming. | `postgres-work-queue.ts` lines 162–212; `notification-tick.service.ts`'s own comment |
| Two workers claim concurrently | **Guaranteed safe**, same mechanism. Directly asserted by `postgres-work-queue.integration.test.ts` ("two concurrent claimers never get the same job"). | Test file confirmed to exist and its assertion description matches |
| A worker crashes mid-job | **Guaranteed recoverable**, bounded by `leaseSeconds` (2 minutes default). `attempts` is incremented on **claim**, not completion, so a crash still burns an attempt — this is the correct choice to prevent an unrecoverable job from re-claiming forever, at the cost of a crashed-but-otherwise-healthy job losing one retry. | `postgres-work-queue.ts` lines 30–35, `NotificationJob.attempts` comment in schema.prisma:507 |
| A lease expires | **Guaranteed recoverable** via `reapExpired()` (retires exhausted leases before each claim pass) and via `claim()`'s own `runAt <= now` predicate re-admitting an expired-but-not-exhausted job. | `postgres-work-queue.ts` lines 264–283 |
| A provider times out | **Best-effort, bounded.** Classified `RETRYABLE`, backed off with jitter, up to `pushMaxAttempts` (4, default). | `delivery.service.ts` lines 291–312, `fcm-error-mapping.ts` |
| Provider succeeds but the worker crashes before recording it | **Best-effort, not exactly-once by design.** A crash between `provider.send()` returning ACCEPTED and `DeliveryRepository.settle()` writing `SENT` leaves the delivery row retryable; a re-attempt sends a genuine duplicate push. This is explicitly accepted, not overlooked: at-least-once is the stated guarantee (ND-D-05), and the duplicate is made harmless client-side by FCM's `collapseKey`/`tag` set to the notification's own id (confirmed in both `delivery.service.ts` line 301 and the service worker's `notificationclick` handler, which replaces rather than stacks a banner sharing a tag). | ND-D-05; `delivery.service.ts`; `firebase-messaging-sw.js` lines 55–58 |
| Generation succeeds but delivery-job creation fails | **Guaranteed impossible** — one `$transaction` wraps both (§4.2). | `notification-generation.service.ts` lines 70–79 |
| Delivery succeeds but state persistence fails | Same class as the provider-crash row above: best-effort, mitigated by collapse-by-tag, not eliminated. | as above |
| A job is retried | **Guaranteed bounded**, exponential backoff with ±50% jitter specifically to prevent a thundering herd when a shared dependency (e.g. the database, or FCM) fails for many users' jobs at once. | `backoff.ts`; `JOB_CONFIG.jitterRatio` comment |
| A job becomes permanently invalid | **Guaranteed classified**, not silently retried to exhaustion at the same cost — `PermanentJobError` short-circuits to a single terminal failure (e.g. a deleted `FeatureAnnouncement`). | `fanout-announcement.handler.ts` lines 49–54; `job-error.ts` |
| A user changes preferences mid-processing | **Guaranteed correct for delivery** (re-checked immediately before send, ND-D-12); **best-effort for evaluation** (a preference flip between the scheduler enqueuing a job and the handler running it uses whatever state the handler reads at run time — there is no long window here since evaluation and delivery happen in the same tick in the common case). | `delivery.service.ts` lines 92–116; `evaluate-registration-closing.handler.ts` lines 60–76 |
| A competition changes mid-processing | **Guaranteed non-issue by design** — content is snapshotted at generation (`title`/`body`/`payload` frozen, schema.prisma:322–324 comment), so a later edit or deletion cannot rewrite an already-sent notification's content. | schema comment; `ND-I-17` ("competition state is not re-validated before delivery in Phase 1") |
| A notification becomes obsolete (e.g., user registers before the deadline push fires) | **Documented, deliberate non-guarantee.** `ND-I-17` states competition state is not re-validated before delivery — the push still sends even if the user already registered in the meantime. This is a stated product tradeoff, not a bug, but is worth surfacing to product as a real (if minor) UX rough edge. | `open-decisions.md` "What is *not* open" table, row 4 |
| The system has a backlog | **Best-effort, and the weakest-verified property in the system.** See NTF-AUD-016 below. | `job-runner.ts` `hasMore` semantics |
| Multiple server processes run concurrently | **Guaranteed safe** — the same `SKIP LOCKED` mechanism covers any number of concurrent Vercel invocations; no in-memory state is shared or assumed (`defaultOwner()`'s own comment: "a serverless platform gives no stable worker identity," and correctness never depends on that identity being unique). | `job-runner.ts` lines 82–87 |

### 8.1 Backlog draining — the one place best-effort is weakly bounded

**NTF-AUD-016.** The wall-clock budget (`JOB_CONFIG.wallClockBudgetMs`, default 45s) bounds one drain pass; `hasMore: true` in the tick's response signals unfinished work, but nothing in the repository consumes that signal beyond returning it in the JSON body. `NOTIFICATION_WORKER_SELF_CONTINUE` (which would re-invoke the tick over HTTP to keep draining) defaults to `false`. On the project's actual current deployment target (Vercel Hobby, one daily trigger, per `docs/architecture/notifications/README.md`'s stated environment facts), a backlog larger than one 45-second batch can take **more than one day** to fully drain, and nothing alerts an operator that this is happening — the only visibility is reading `hasMore` out of a cron response body or the structured logs by hand. This is not a hypothetical: the architecture doc itself names this exact tradeoff as the reason `selfContinue` exists, and states it is "genuinely useful on a platform that allows only a daily trigger." Its being off by default is a reasonable, conservative choice (it avoids the added complexity of a chained-HTTP-call depth limit becoming load-bearing) — but the absence of any alerting on a sustained `hasMore: true` is a real observability gap, not a design tradeoff, and is worth closing before backlog size becomes large enough to matter.

---

## 9. Performance and Scale Audit

### 9.1 Redundant recommendation-engine computation — the clearest concrete inefficiency found

**NTF-AUD-015.** `evaluate-top-relevant-competition.handler.ts` → `NotificationPolicyService.evaluateTopRelevantCompetition()` and `evaluate-registration-closing.handler.ts` both independently call `RecommendationService.generateForUser({ userId })` (confirmed at `notification-policy.service.ts:67` and `evaluate-registration-closing.handler.ts:106`). `recommendation.service.ts` has no caching or memoization of any kind (confirmed by grep — zero matches for "cache" in that file). A user who has **both** competition intents enabled therefore causes the recommendation engine — described in the codebase's own comments as "the most expensive step in the pipeline" (`delivery.service.ts`'s file header) — to run twice, independently, for the same user, on the same day, computing what is very likely a near-identical ranking both times. At current scale this is not a problem (each engine run is one bounded per-user computation, and the docs explicitly accept "Phase 1 stays small," principle 14). It is the single most concrete, low-effort optimization opportunity identified in this audit if the user base or the engine's cost per call grows.

### 9.2 Fan-out shape

Both admin-broadcast paths (§2.2, §2.3) page by keyset (`orderBy: id`, cursor-based), not offset — correct under concurrent inserts, confirmed in both handlers. Page size (200) is configurable and re-arms rather than accumulating jobs, so a a fan-out over an arbitrarily large user base remains one job row, resumable, rather than N job rows. This is a well-chosen shape and scales linearly with user count without a corresponding linear growth in queue rows.

### 9.3 The scheduler's own fan-out

`scheduleDueEvaluations()` creates one `NotificationJob` row per opted-in user per scheduled intent per day (confirmed, `notification-scheduler.service.ts` lines 119–152). At 2,000 users (the number the file's own comment uses as its planning reference) this is 2,000–4,000 rows/day, bulk-inserted via `enqueueMany`'s `skipDuplicates: true` `createMany` — a single statement, not N round trips. This is appropriately bounded for the stated current scale and the comment explicitly acknowledges the number as a planning reference rather than a guess.

### 9.4 No N+1 patterns found in the hot paths

`evaluate-registration-closing.handler.ts` batches its four independent reads (recommendations, bookmarked ids, registered ids, already-notified ids) via `Promise.all` (lines 104–118) rather than sequentially, and each is itself a single indexed query over a bounded candidate set (`WINDOW_LIMIT = 500`). The inbox list query is a single keyset-paginated indexed read (per the rate-limit policy's own cost description, §7.4). No loop issuing one query per iteration was found in any notification code path read during this audit.

### 9.5 Unbounded growth — the one real scale risk, and it is already tracked

`NotificationDeliveryAttempt` (per-attempt audit log, one row per send attempt per device) has a configured retention (`RETENTION_CONFIG.deliveryAttemptSeconds`, default 30 days) that is **never consumed anywhere in the codebase** — confirmed by a repository-wide grep for `deliveryAttemptSeconds` returning exactly one match, its own definition. Only `NotificationJob` rows are actually pruned (`workQueue.prune()`, called from the tick). This table is explicitly named in `IMPLEMENTATION-STATUS.md` as the one that "grows fastest." See NTF-AUD-004. `Notification`/`NotificationTarget`/`NotificationDelivery` are never pruned at all, but this is a stated, deliberate non-goal (§1.9, open decision A-11) tied to the deduplication semantics, not an oversight — the attempt table is the one exception, since pruning it has no dedup interaction (dedup reads delivery *status*, not attempt rows) and yet nothing prunes it anyway.

### 9.6 When current design would need to change

Current implementation is sufficient for the stated current scale (thousands of users, daily cadence). Concrete signals that would justify revisiting the choices above, in order of likelihood of being hit first:
1. `NotificationDeliveryAttempt` row count becoming operationally noticeable (slow admin queries, backup size) — directly actionable today by wiring up the existing config (NTF-AUD-004), no design change needed.
2. Recommendation-engine wall-clock cost per call rising, or user count growing past the low-thousands the scheduler comment plans for — at that point, sharing one engine run per user per day across both competition intents (NTF-AUD-015) becomes worth the added coupling.
3. A genuine need for near-real-time (sub-hour) delivery on a platform that still only allows one daily cron slot — at that point, `NOTIFICATION_WORKER_SELF_CONTINUE` needs to be turned on deliberately, not discovered as a workaround, and the backlog-alerting gap in §8.1 needs to be closed first.

None of these three signals is present in the repository today. No infrastructure change (a real broker, a dedicated worker fleet) is justified by anything found in this audit.

---

## 10. Documentation vs. Implementation

Two independent, parallel documentation trees exist: `docs/project/feature-specification/notification/` (product "what/why," decision register `ND-*`) and `docs/architecture/notifications/` (technical "how," `IMPLEMENTATION-STATUS.md`). Both are unusually thorough and, with one major exception, accurate.

| Area | Relationship | Evidence |
|---|---|---|
| Core pipeline shape, four intents, two channels | **MATCH** | Every claim in `docs/architecture/notifications/pipeline/README.md` and `IMPLEMENTATION-STATUS.md` was independently verified against the actual code in §2–§4 above |
| Decision register (`ND-P/R/I/H/D-xx`) | **MATCH** | Every `ND-*` citation embedded in source-code comments this audit followed (ND-D-01, D-04, D-05, D-06, D-07, D-09, D-12, D-13, H-10, H-12, I-17, P-16) resolves to a real, findable ruling in `decisions/*.md` |
| Overall implementation status | **STALE DOCUMENTATION.** `docs/project/feature-specification/notification/README.md` line 3 and line 83 state *"Specification complete for Phase 1. No implementation started."* `docs/architecture/notifications/README.md` and `IMPLEMENTATION-STATUS.md` both state **Implemented**, with a full file manifest, and the actual code confirms full implementation. This is not a subtle drift — the two docs directly contradict each other on the single most important status fact a new engineer would look for. Whether intentional (the product-spec doc's own "Status" line was simply never updated after work began, since its own footer describes itself as expected to stay current) or an oversight, it should be fixed. See NTF-AUD-001. | `docs/project/feature-specification/notification/README.md:3,83` vs. `docs/architecture/notifications/IMPLEMENTATION-STATUS.md:1-3` |
| Decision-register source traceability | **STALE DOCUMENTATION** (minor). `decisions/README.md`'s traceability table cites `docs/temp/notificatio-decisions.md` as the source of the `ND-P/R/I/H` rulings; that file does not exist in `docs/temp/` (only `README.md`, `codebase-recommendation.md`, `notofication-User-stories.md` remain). See NTF-AUD-002. | Confirmed via directory listing of `docs/temp/` |
| `raw.md` scratch note | **ARCHITECTURAL DRIFT (superseded, not removed).** Its idea (an expiry concept for stale notifications) was formalized as `DELIVERY_CONFIG.pushValidForSeconds` / ND-D-13, confirmed by comparing the note's content against the delivered feature — but the note itself was never deleted or folded into `principles.md`. See NTF-AUD-003. | `docs/architecture/notifications/raw.md`, verbatim content confirmed including its own typos |
| Open decisions A-9, A-11 | **MATCH** — genuinely open, accurately described as such, and this audit's own findings (NTF-AUD-004, §7.3) independently confirm both are real, unresolved gaps rather than already-answered-and-forgotten items | `open-decisions.md` |
| Test counts (361 unit / 244 integration, "all passing") | **NOT INDEPENDENTLY VERIFIED — Not verified from repository evidence.** This audit counted 21 notification/preferences test *files* (§12) and confirmed their described behavior by reading them, but did not execute the suite to confirm pass/fail counts or reconcile them against the specific 361/244 figures claimed in `IMPLEMENTATION-STATUS.md`. The file-level claims about what each test verifies were independently confirmed by reading the actual test bodies, not merely trusting the doc's summary. | Audit methodology note |
| `push-subscription.service.ts` repository-pattern gap | **MATCH** — documented as a known gap in `IMPLEMENTATION-STATUS.md` and independently confirmed present in the code (§6.5) | cross-referenced |
| `NotificationDeliveryAttempt` pruning | **DOCUMENTED BUT NOT IMPLEMENTED**, and the documentation is honest about this — `IMPLEMENTATION-STATUS.md` and `RETENTION_CONFIG`'s own comment both name the table as unpruned/fastest-growing; the audit's contribution is confirming via grep that the configured value truly has zero consumers, not just that pruning "seems incomplete." | §9.5 |
| Developer testing manual (`DEVELOPER-TESTING.md`) | **MATCH** — describes exactly the manual Firebase-console and `pnpm notifications:tick`/`notifications:diagnose` flows that exist as real scripts (`scripts/notifications-tick.ts`, `scripts/notifications-diagnose.ts`, confirmed to exist) | cross-referenced |

---

## 11. Testing Audit

### 11.1 What is genuinely well covered

21 test files across `notifications/` and `preferences/` (backend/policy/content/scheduling/jobs/delivery), read in full or in relevant part during this audit, provide strong behavioral coverage of exactly the properties that matter most for a queue-based, at-least-once system:

- **Concurrency and crash recovery** are tested, not merely designed for: `postgres-work-queue.integration.test.ts` and `job-runner.integration.test.ts` assert two concurrent claimers never get the same job, an expired lease is re-claimable, and a mid-batch failure doesn't affect the rest of the batch.
- **Determinism and purity** of every policy function is tested with injected `now`/`random`, confirmed by reading `top-relevant-competition.policy.test.ts` and `registration-closing.policy.test.ts` asserting the functions never read the system clock.
- **The exact class of security-relevant input** (protocol-relative URLs, backslash-host tricks, `javascript:`/`data:` schemes, traversal, control characters) is tested in `action-path.test.ts`.
- **The specific historical bug** (`require()` vs. `import()` breaking FCM construction) has a regression test (`push-provider.factory.test.ts`) that would have caught it, confirmed by reading the test's actual assertions rather than trusting the changelog's claim that it does.

### 11.2 Real gaps

**NTF-AUD-010.** No automated test exists for: `public/firebase-messaging-sw.js` (the service worker — confirmed no `.test.*` file references it anywhere in the repo), any of the four frontend components (`notification-bell`, `notification-list`, `push-permission-card`, `announcement-composer`), any of the three frontend hooks (`use-notification-inbox`, `use-unread-count`, `use-push-registration`), or any true browser-level end-to-end push flow — the repository has no e2e test infrastructure of any kind (no Playwright/Cypress config found anywhere). `DEVELOPER-TESTING.md` explicitly and honestly states that confirming an actual OS-level notification banner is manual-only. This means the optimistic-update-with-rollback logic in `use-notification-inbox.ts` and `use-push-registration.ts` — real, non-trivial state-management logic with genuine edge cases (rollback on failure, no-rollback-on-`markResponded`-by-design) — is currently verified only by manual testing.

**NTF-AUD-011.** `NotificationAnnouncementAuthorizer.manage()` has no dedicated unit test isolating just the authorization gate; it is exercised only indirectly through one assertion inside `announcement.integration.test.ts` ("refuses to list announcements to a non-admin"). Given this is the one true permission gate in the entire subsystem, a direct unit test (grant/deny for each role) would be cheap and would decouple "is the gate correct" from "does the whole announcement flow happen to route through it correctly."

### 11.3 Test quality, not just coverage

No brittle, implementation-coupled, or redundant test was identified in the files read. Tests consistently assert on outcomes (a decision, a state transition, a queryable row) rather than on internal call sequences, which is what allows the "policy function never reads the clock" and "two claimers never collide" properties to be tested meaningfully rather than merely mocked into appearing true.

---

## 12. Maintainability Audit

### 12.1 What would help a maintainer six months from now, that exists

Every file read during this audit carries a header explaining *why* the file exists, its responsibilities, its explicit non-responsibilities ("Does NOT"), and — where relevant — the specific historical bug or production incident that shaped a non-obvious decision. This is a genuinely unusual density of load-bearing documentation co-located with the code it explains, and it measurably reduced this audit's own verification time (claims could be checked against stated intent rather than reverse-engineered from behavior alone).

### 12.2 Concrete maintainability findings

**NTF-AUD-005** (repeated from §6.5) — `push-subscription.service.ts` bypassing the repository pattern is a small, already-acknowledged inconsistency. Low cost today (the service is short and its Prisma calls are simple), but it is the one place in this module a future contributor extending push-subscription behavior would have no repository to extend and might either add one inconsistently or keep growing the service directly.

**NTF-AUD-006** — DTO conversion via inline `toDTO()` functions rather than the `*.mapper.ts` convention used elsewhere in the codebase (competitions module) is a real, if minor, divergence. Not harmful at the current size of the DTOs involved, but if a future intent's payload grows a more complex shape, this is a decision point that should probably resolve toward the established convention rather than entrenching a second one.

**NTF-AUD-007** — `/internal/notification/top-competition` is not notification functionality but occupies the notification namespace and is explicitly self-described as a temporary Phase-0 testing surface. A maintainer scanning "everything under `/internal/notification/`" during a future audit or incident would reasonably expect notification-related code and find a recommendation-engine debug tool instead. Low risk (not admin-gated, but scoped to the caller's own account, no notification created) — but exactly the kind of thing that gets forgotten and then discovered by an external report rather than intentionally removed.

**NTF-AUD-008** — `onForegroundMessage()` in `src/lib/push/firebase-client.ts` is complete, exported, documented ("refreshing the unread badge, for example"), and has zero call sites. Dead code that reads as live code is a specific maintainability trap: a future contributor might reasonably assume foreground push messages already do something, when in fact the unread badge's only update mechanism is `useUnreadCount`'s 60-second poll.

**NTF-AUD-009** — `NotificationDTO.payload` is serialized and sent to the client on every inbox fetch but read by no frontend code. Low cost (it's already fetched as part of the row), but it's untracked payload weight for a purpose that hasn't materialized yet.

**NTF-AUD-017** — `notification-preferences-card.tsx`'s `disabled={savingIntent !== null}` is applied to every `Switch`, not just the one being saved (it should be `disabled={savingIntent === intent}` scoped per-row). While any single toggle save is in flight, the whole card appears locked. Small, user-visible, easy fix.

**NTF-AUD-019** (repeated from §7.1) — the `FORBIDDEN` regex in `content/action-path.ts` is currently correct, but its correctness depends on raw, non-printable control-byte literals surviving verbatim through every future edit, every editor's save behavior, every formatter (Prettier is used in this repository, confirmed by its presence in the toolchain implied by the codebase's consistent formatting), and every diff/merge tool, indefinitely. None of these are guaranteed to preserve invisible bytes; a formatter or an editor's "strip trailing whitespace"/"normalize line endings" setting could silently narrow or corrupt this specific security-relevant character class with a diff that shows no visible change. This is a real, if currently dormant, fragility risk in code that a security audit specifically depends on being byte-stable.

**NTF-AUD-020** — Two coexisting entry points to the same inbox exist: `NotificationBell` (`page-wrapper.tsx`, with a live unread-count badge) and a plain static nav link with a `BellIcon` and no count (`dashboard-sidebar/nav-user.tsx`, lines ~135–137). Not a bug — both route to `/user/notifications` — but worth confirming with product/design whether both are intended to coexist, since the sidebar link's lack of a badge could read as a second, less-informative "notifications" affordance rather than a deliberate second navigation path.

**NTF-AUD-021** — Repository-wide (not notification-specific): `HttpClient.parseResponse` (`src/lib/http/client.ts`) unconditionally calls `response.json()`, which throws on a `204 No Content` body. `IMPLEMENTATION-STATUS.md` names this as a historical risk it specifically avoided by having every notification endpoint return `ApiResponse.ok({})` rather than `noContent()` (confirmed: `notification.controller.ts`'s own comment at the `markRead` handler states this explicitly, citing the delete/restore/bookmark precedent in the competitions controller as the reason). This is handled correctly *everywhere it currently applies* in notifications — but the underlying footgun in `HttpClient` itself is systemic and could be reintroduced by any future endpoint (notification or otherwise) that reaches for `noContent()` without knowing this history. Fixing `HttpClient` once would remove the need for every future endpoint to remember this workaround.

### 12.3 What is not a problem

Module size, controller thinness, and the number of files in `jobs/handlers/` are all proportionate to what the subsystem actually does — no god-object, no service doing controller work, no handler exceeding roughly a page of logic once its own comments are set aside. Nothing found in this audit suggests the module needs to be split further or consolidated.

---

## 13. Observability and Operations

Structured JSON logging (`observability/log.ts`) covers every named decision point: suppression reasons, skip reasons, delivery outcomes, job lifecycle transitions, scheduler pass summaries, tick completion. Every log line is a stable `area.thing_that_happened` event name plus fields, explicitly designed to be queryable in a log drain (Vercel's, per the file's own comment) rather than read as prose. This answers most of the operational questions the audit prompt poses directly:

| Question | Answerable today? | How |
|---|---|---|
| Why wasn't a notification generated? | **Yes** | `evaluation.suppressed` log event carries the specific `reason` enum value from the policy decision |
| Why was a user selected/excluded? | **Yes, for suppression; partially for exclusion from a candidate set** | Suppression reasons are logged; a user who was never enqueued at all (e.g., not opted in) leaves no per-user trace beyond the aggregate `scheduler.pass` count — reconstructing "why wasn't user X even considered" requires querying `NotificationPreference` directly, not the logs |
| Why wasn't a notification delivered? | **Yes** | `delivery.skipped` / delivery status + `failureReason` column, both human-readable |
| Why did delivery retry? | **Yes** | `jobs.retrying` log event plus `NotificationDeliveryAttempt.errorCode`/`providerResponse` |
| Why did a job fail? | **Yes** | `jobs.failed` event, `NotificationJob.lastError` (truncated to 2000 chars, deliberately, per its own comment) |
| Why did duplicate work occur? | **Yes, if it did** — dedupe collisions are the *absence* of a problem here (§6.2), so "why did this happen twice" reduces to "the occurrence key was computed differently," which the frozen-payload design (ND-D-07) makes traceable via the payload's own `occurrenceKey`/`evaluatedAt` fields | schema + job payload |
| Which provider failed? | **Yes** | `NotificationDelivery.provider`, `NotificationDeliveryAttempt.providerResponse` |
| How much backlog exists? | **Weakly** — `hasMore`/`claimed`/`failed` counts are in the tick's JSON response and in `jobs.drain` log lines, but there is no dashboard, no alert, and no persisted backlog-size metric independent of reading logs by hand (§8.1, NTF-AUD-016) | — |
| Which intent generates the most work? | **Not directly** — `NotificationJobKind` is logged per event but no aggregation/dashboard exists; answerable via ad hoc log queries or a direct database count, not via any built-in view | — |

**Gap, consolidated:** the system is well-instrumented for *forensic* investigation (answering "what happened to notification X" after the fact, via logs and persisted rows) but has no *proactive* observability (no metric, no dashboard, no alert threshold) for backlog size, delivery failure rate, or per-intent volume trending over time. Given the repository has no metrics/tracing library anywhere (confirmed: no OpenTelemetry, Prometheus client, or equivalent found in `package.json` dependencies during this audit's broader reading), this is consistent with the rest of Kizunia rather than a notification-specific gap — but it is the most actionable "what's missing" item for this specific subsystem given it is the one with a queue that can silently back up (§8.1).

---

## 14. Mentor Review

### What is good

- **The pure-policy / impure-service split** (§4.1) is the standout architectural decision. It is applied with discipline across all four intents, it is what makes the fastest and most exhaustive tests in the suite possible, and it is a genuine, exportable pattern the rest of Kizunia does not yet have a name for.
- **The transactional outbox** (§4.2) solves a real, specific class of distributed-systems bug correctly and simply, with no more machinery than the problem requires.
- **Idempotency by database constraint, narrowly caught** (§6.2) is the right way to build a system that can be safely re-run, retried, and swept concurrently without a separate "is this a duplicate" service.
- **The decision register** (`ND-*` IDs cross-referenced from source comments back to `decisions/*.md`) is a genuinely rare practice of recording *why*, not just *what*, and it held up under this audit's spot-checking — every citation this audit followed resolved to a real ruling.
- **Rate-limit policy design that reasons about blast radius**, not just request volume (§7.4), correctly identifies `ANNOUNCEMENTS_WRITE` as categorically different from the rest.

### What is acceptable but could improve

- The `push-subscription.service.ts` repository gap (NTF-AUD-005) and the inline-`toDTO` vs. `*.mapper.ts` divergence (NTF-AUD-006) are both small, both already low-cost, and both worth fixing opportunistically rather than urgently.
- The stale product-spec status line (NTF-AUD-001) is a five-minute fix with outsized value for anyone new landing on that document first.
- The `NotificationPreferencesCard` disable-scope bug (NTF-AUD-017) is a one-line fix.

### What is risky

- **The backlog-draining gap (NTF-AUD-016, §8.1)** is the one finding in this audit with genuine, if currently low-probability, operational consequence: on the current deployment target, an unexpected surge in scheduled work with `selfContinue` off could silently take multiple days to clear, and nothing currently alerts anyone to that state. This is the audit's highest-priority reliability item precisely because it is the one place "best-effort" is weaker than an operator would likely assume without reading this deeply.
- **The unwired `NotificationDeliveryAttempt` retention (NTF-AUD-004)** is risky in the boring, compounding way unbounded tables always are — not urgent today, increasingly expensive to ignore.

### What is unnecessarily complex

Nothing found in this audit rises to this category. Every seam, port, and layer this audit inspected had a stated, checkable justification (§4.5), and none was found to be unused, speculative, or disproportionate to the problem it solves.

### What should NOT be changed yet

- The two-port design (`WorkQueue`, `PushProvider`) should **not** be given a second real implementation speculatively. No evidence in this repository suggests Kafka or a second push provider is imminent; the ports exist correctly as a seam, not a mandate to build the alternative now.
- The pure/impure split should **not** be forcibly retrofitted onto other Kizunia modules as part of this work — it is worth *proposing* as a repository-wide convention (§5), but that is a separate, deliberate initiative, not a byproduct of a notification audit.
- The entitlement seam (open decision A-9) should **not** be built speculatively — the delivery layer already has the natural insertion point (ND-D-12's pre-send preference check) should it ever be needed, and building it now would be exactly the kind of "abstraction without a current justification" the codebase otherwise successfully avoids.

### What is missing

- **Automated coverage for the entire frontend and service-worker surface** (NTF-AUD-010) is the largest single gap in the system as delivered. It is also the hardest to close cheaply (no e2e infrastructure exists in the repository at all), which is likely why it hasn't been closed yet — but it is real exposure for exactly the code with the most subtle, hand-rolled state logic (optimistic updates, selective rollback).
- **Backlog observability** (§13) — a persisted or dashboarded backlog-size signal, not just a log line, so NTF-AUD-016 becomes something an operator is told about rather than something they'd have to think to check.
- **A resolution, one way or the other, on retention** (open decision A-11) — not because the current "keep everything that participates in dedup" choice is wrong, but because it is currently unbounded and untested at any real volume.

---

## 15. What Should Be Implemented Next

Grouped by sequencing logic, not by category. Each item states what, why, the evidence, the problem it solves, dependencies, architectural impact, the risk of waiting, complexity, and category.

### Phase 1 — Address Soon

**1. Wire up `NotificationDeliveryAttempt` pruning.**
What: consume the already-defined `RETENTION_CONFIG.deliveryAttemptSeconds` in a prune pass, the same shape as the existing `NotificationJob` prune. Why: the config exists and is documented as intentional; only the wiring is missing (NTF-AUD-004). Evidence: zero non-definition references to `deliveryAttemptSeconds` in the codebase. Problem solved: unbounded growth of the fastest-growing notification table. Dependencies: none — the retention window is already decided (30 days default), unlike the harder A-11 question this does not touch. Architectural impact: none — extends an existing, proven pattern. Risk of postponing: low today, compounding over time as delivery volume grows. Complexity: **Small**. Category: **Reliability / Performance**.

**2. Fix the product-specification status line and the broken decision-traceability pointer.**
What: update `docs/project/feature-specification/notification/README.md`'s status line to reflect implementation, and either restore or repoint the `docs/temp/notificatio-decisions.md` citation in `decisions/README.md`. Why: this is the single most misleading fact a new engineer could pick up from this documentation set (NTF-AUD-001, NTF-AUD-002). Evidence: §10. Problem solved: documentation trust. Dependencies: none. Architectural impact: none. Risk of postponing: grows with every new engineer who reads the spec first. Complexity: **Small**. Category: **Documentation**.

**3. Add backlog alerting on sustained `hasMore: true`.**
What: persist or export the tick's `hasMore`/`claimed`/`failed` summary somewhere an operator is actually notified from (even a simple threshold-based log-based alert), rather than only appearing in a cron response body and structured logs. Why: this is the one place a real operational incident could go unnoticed for days (NTF-AUD-016, §8.1). Evidence: `job-runner.ts`'s own `hasMore` semantics, no consumer beyond the JSON return value. Problem solved: silent backlog accumulation. Dependencies: whatever alerting mechanism the rest of Kizunia's operations already use, if any (**not verified from repository evidence** — no existing alerting integration was found during this audit; this may require a first decision about what that mechanism should be, repository-wide). Architectural impact: none to the notification system itself. Risk of postponing: currently low-probability, high-surprise if it occurs. Complexity: **Small–Medium**, depending on what alerting infrastructure already exists elsewhere in Kizunia. Category: **Observability / Reliability**.

**4. Fix the `NotificationPreferencesCard` disable-scope bug.**
What: scope `disabled` to `savingIntent === intent` rather than `savingIntent !== null`. Why: NTF-AUD-017. Evidence: `notification-preferences-card.tsx`. Problem solved: a small but real UX regression during any single preference save. Dependencies: none. Architectural impact: none. Risk of postponing: minor, purely cosmetic. Complexity: **Small**. Category: **Maintainability / Product capability**.

### Phase 2 — Address After Phase 1

**5. Add component/hook tests for the frontend notification surface.**
What: unit/component tests for `use-notification-inbox`, `use-push-registration`, `use-unread-count`, and the four presentational components, covering the optimistic-update-and-rollback paths specifically. Why: NTF-AUD-010 — this is real, non-trivial logic currently verified only by manual testing. Evidence: §11.2. Problem solved: regression risk in the one area with the most hand-rolled client state. Dependencies: none beyond whatever component-testing setup (React Testing Library, etc.) the rest of the frontend already uses (**not verified from repository evidence** whether this tooling exists elsewhere in the repo — if it does not, this item's complexity increases). Architectural impact: none. Risk of postponing: moderate and growing as the frontend surface gets touched by future feature work with no safety net. Complexity: **Medium**. Category: **Testing**.

**6. Add a direct unit test for `NotificationAnnouncementAuthorizer`.**
What: grant/deny assertions for the one true permission gate in the subsystem, independent of the broader announcement integration test. Why: NTF-AUD-011. Evidence: §11.2. Problem solved: decouples "is the gate correct" from "does the whole flow happen to route through it." Dependencies: none. Architectural impact: none. Risk of postponing: low but avoidable. Complexity: **Small**. Category: **Testing**.

**7. Remove or fold in `docs/architecture/notifications/raw.md`.**
What: delete the file now that its idea is formalized as ND-D-13, or fold its remaining unaddressed nuance (if any) into `principles.md`. Why: NTF-AUD-003. Evidence: §10. Problem solved: documentation hygiene, avoids a future reader mistaking it for a live open question. Dependencies: none. Architectural impact: none. Risk of postponing: negligible, purely cosmetic. Complexity: **Small**. Category: **Documentation**.

**8. Resolve `push-subscription.service.ts`'s repository-pattern gap and the inline-DTO-mapping divergence.**
What: introduce `PushSubscriptionRepository` and, separately, adopt `*.mapper.ts` for notification DTOs, matching the competitions-module convention. Why: NTF-AUD-005, NTF-AUD-006 — both already self-acknowledged gaps, addressed here as one opportunistic cleanup pass rather than urgent work. Evidence: §6.5, §5. Problem solved: consistency for future contributors extending either service. Dependencies: none. Architectural impact: minimal, purely structural. Risk of postponing: low, compounds slowly as the module grows. Complexity: **Small**. Category: **Maintainability**.

**9. Decide the fate of `/internal/notification/top-competition`.**
What: either move it out of the `notification` URL namespace to something like `/internal/recommendations/debug`, admin-gate it, or remove it now that Phase 0 testing needs may have passed. Why: NTF-AUD-007. Evidence: §1.9, §12.2. Problem solved: removes a discoverability trap for future audits/incident response, and a route with no admin gate that has outlived its "temporary" label. Dependencies: confirming with whoever still uses it for Phase-0 recommendation testing. Architectural impact: none. Risk of postponing: low but grows the longer a "temporary" route survives unlabeled as such in any index of admin/internal routes. Complexity: **Small**. Category: **Maintainability / Security (defense-in-depth)**.

### Phase 3 — Future Evolution

**10. Share one recommendation-engine run per user per day across both competition intents.**
What: cache or otherwise share `RecommendationService.generateForUser()`'s result within a single tick's evaluation of a given user, so `TOP_RELEVANT_COMPETITION` and `REGISTRATION_CLOSING` do not each pay the engine's full cost independently. Why: NTF-AUD-015 — the clearest concrete performance opportunity found, but explicitly **not urgent** at current scale. Evidence: §9.1. Problem solved: redundant computation of the platform's most expensive per-user step. Dependencies: some shared per-tick cache or a restructured handler that evaluates both intents together (a real, if modest, architectural change — the two handlers are currently independent by design for isolation reasons, and merging their engine call without merging their failure isolation needs care). Architectural impact: **Medium** — touches the "one job, one user, one failure domain" principle the scheduler is built around; must be done without weakening that isolation. Risk of postponing: low today; the signal to act is user-count or engine-cost growth (§9.6), not a fixed date. Complexity: **Medium**. Category: **Performance**.

**11. Resolve open decision A-9 (entitlement seam) when a real product need for it exists.**
What: nothing yet, deliberately — the natural insertion point already exists (ND-D-12's pre-send check). Why: named here only to make explicit that this audit found no evidence it should be built speculatively. Category: **Product capability** (deferred).

**12. Resolve open decision A-11 (retention policy) as a first-class product/architecture decision**, separate from the mechanical fix in Phase 1 item 1. What: decide how long `Notification`/`NotificationTarget`/`NotificationDelivery` are kept given their role in deduplication, and whether the three tables need different horizons (as `open-decisions.md` itself suggests). Why: currently genuinely unresolved, not merely unimplemented. Evidence: §1.9, §9.5. Problem solved: puts a bound on the notification/target/delivery tables' otherwise-permanent growth without breaking dedup semantics. Dependencies: a product decision on how "stale but still deduplicating" history should behave — this is not a purely technical call. Architectural impact: potentially touches the dedup query shape if a chosen retention window interacts with it. Risk of postponing: low now, becomes a real migration/backfill problem the longer these tables grow unbounded before a policy exists. Complexity: **Medium–Large**, mostly in the decision-making, not the implementation. Category: **Product capability / Reliability**.

**13. Consider extracting the pure-policy/impure-service split as a named, repository-wide convention.**
What: document the pattern found in `modules/notifications/policy/` as a recommended shape for future modules with non-trivial decision logic, not just a notification-specific technique. Why: this audit found real, measurable value in the pattern (§4.1, §5) and no equivalent named convention elsewhere in the repository. Evidence: §4.1, §5. Problem solved: makes a genuinely good pattern discoverable and repeatable rather than tribal knowledge specific to one module. Dependencies: none technical; this is a documentation/convention-setting exercise. Architectural impact: none to existing code — this is guidance for future work. Risk of postponing: low, but the value compounds the earlier it's adopted elsewhere. Complexity: **Small**. Category: **Developer experience / Documentation**.

**Sequencing rationale:** Phase 1 items are all small, evidence-confirmed, low-risk, and each closes a gap between what the system already claims about itself (in docs or in its own config) and what it actually does — they are corrections, not new work. Phase 2 items close real but currently-tolerable gaps (test coverage, small structural inconsistencies) that get more expensive to close the longer the module grows around them. Phase 3 items are either genuinely speculative until a growth signal arrives (item 10), explicitly product-owned decisions this audit cannot make on the codebase's behalf (items 11–12), or organizational/convention work whose value is real but non-urgent (item 13).

---

## 16. Consolidated Findings

| ID | Severity | Category | Area | Summary |
|---|---|---|---|---|
| NTF-AUD-001 | MEDIUM | Documentation | Product spec | `feature-specification/notification/README.md` still says "No implementation started," directly contradicting the fully-implemented, independently-verified reality and the architecture docs' own "Implemented" status |
| NTF-AUD-002 | LOW | Documentation | Decision register | `decisions/README.md`'s traceability table cites a source file (`docs/temp/notificatio-decisions.md`) that no longer exists |
| NTF-AUD-003 | LOW | Documentation / Maintainability | Architecture docs | `raw.md` scratch note's idea was formalized (ND-D-13) but the file itself was never removed |
| NTF-AUD-004 | MEDIUM | Reliability / Performance | Retention | `NotificationDeliveryAttempt` retention is fully configured (`RETENTION_CONFIG.deliveryAttemptSeconds`) but has zero consumers anywhere in the codebase; the table is documented as the fastest-growing and is never pruned |
| NTF-AUD-005 | LOW | Maintainability / Consistency | `push-subscription.service.ts` | Bypasses the repository pattern every sibling service uses; self-acknowledged in `IMPLEMENTATION-STATUS.md` |
| NTF-AUD-006 | LOW/INFORMATIONAL | Consistency | DTO mapping | Inline `toDTO()` helpers rather than the `*.mapper.ts` convention established by the `competitions` module |
| NTF-AUD-007 | LOW | Maintainability / Security | `/internal/notification/top-competition` | A recommendation-engine debug page sits in the notification URL namespace, is not notification functionality, and is not admin-gated by design |
| NTF-AUD-008 | LOW | Maintainability | `firebase-client.ts` | `onForegroundMessage()` is fully implemented, exported, and has zero call sites |
| NTF-AUD-009 | INFORMATIONAL | Maintainability | `NotificationDTO.payload` | Sent to the client on every fetch, read by no frontend code |
| NTF-AUD-010 | MEDIUM | Testing | Frontend / service worker | No automated test exists for any frontend component, hook, or the service worker; no e2e infrastructure exists in the repository at all |
| NTF-AUD-011 | LOW | Testing | `NotificationAnnouncementAuthorizer` | No dedicated unit test; only indirect coverage via one integration-test assertion |
| NTF-AUD-012 | LOW/INFORMATIONAL | Security | `/admin/notification-announcements` | No page-level role guard; enforcement is 100% delegated to the service layer — consistent with the rest of the repository's convention |
| NTF-AUD-013 | LOW | Security | Push subscription registration | Any authenticated user can bind a client-presented token to their own account with no proof-of-possession; inherent to FCM's design, not worsened by this code, but not mitigated by it either |
| NTF-AUD-014 | LOW/INFORMATIONAL | Product / Maintainability | Static assets | Notification icon PNGs referenced by the manifest and service worker are not committed, by documented design |
| NTF-AUD-015 | LOW/MEDIUM | Performance | Recommendation engine | Two independent scheduled intents each independently invoke the uncached recommendation engine for the same user on the same day |
| NTF-AUD-016 | MEDIUM | Reliability / Observability | Backlog draining | Draining depends on a single daily tick with self-continuation off by default, and no alerting exists on a sustained `hasMore: true` |
| NTF-AUD-017 | LOW | Maintainability (frontend) | `notification-preferences-card.tsx` | `disabled` prop is scoped to "any save in flight" rather than "this row's save in flight" |
| NTF-AUD-018 | INFORMATIONAL | Product / Roadmap | Open decisions | A-9 (entitlement seam) and A-11 (retention-vs-dedup) remain genuinely unresolved |
| NTF-AUD-019 | INFORMATIONAL | Maintainability | `content/action-path.ts` | The security-critical `FORBIDDEN` regex is written as literal, non-printable control bytes embedded directly in source; currently correct (verified byte-for-byte) but fragile to any tool that doesn't preserve raw bytes exactly |
| NTF-AUD-020 | INFORMATIONAL | Consistency | Inbox navigation | Two independent, uncoordinated entry points to the same inbox route exist (`NotificationBell` with a badge, and a static nav link without one) |
| NTF-AUD-021 | LOW | Maintainability (cross-cutting) | `HttpClient.parseResponse` | Unconditionally parses JSON and would throw on a `204`; every current notification endpoint correctly avoids `204`, but the underlying footgun is repository-wide, not notification-owned |

**By severity:** 0 CRITICAL, 0 HIGH, 6 MEDIUM (NTF-AUD-001, 004, 010, 015 partial, 016, and 015 itself spans LOW/MEDIUM), 11 LOW, 6 INFORMATIONAL/LOW-blended. No finding was inflated to a higher severity than its evidenced blast radius supports.

---

## 17. Audit Limitations

Stated explicitly, per the audit's own evidence requirement:

- **Test execution was not performed.** All test-behavior claims in §11 and §10 are based on reading test source files, not running the suite. The specific "361 unit / 244 integration, all passing" figures from `IMPLEMENTATION-STATUS.md` are **not verified from repository evidence** by this audit — only that 21 notification/preferences test files exist and that their assertions, as written, match their documented intent.
- **No runtime behavior was observed.** Claims about concurrency safety, lease recovery, and backoff behavior are based on reading the implementation and the tests that exercise it, not on executing the system under load.
- **Firebase/FCM's own delivery guarantees are outside this repository's control and were not independently assessed.** Everything from "the provider accepted the message" onward (§2.1's trace endpoint) is **not verified from repository evidence** — it is FCM's documented behavior, taken at the level of trust the codebase itself extends to it (accepted ≠ delivered ≠ seen, per `ND-D-03`, which this audit confirms the code respects but cannot independently confirm against a real device).
- **Whether Prettier or another formatter is actually configured to run over `action-path.ts` was inferred from the codebase's consistent formatting, not confirmed by reading a `.prettierrc`/lint-staged config file.** NTF-AUD-019's risk assessment should be read with that caveat; if no such tool ever touches this file, the practical risk is lower than stated.
- **Whether any alerting/monitoring infrastructure exists elsewhere in Kizunia** (outside what this audit read) that NTF-AUD-016's Phase 1 recommendation could plug into was **not verified from repository evidence** — no such integration was found in the notification module or its immediate dependencies, but a repository-wide search for alerting infrastructure was outside this audit's scope.
- **The notification feature list in §3 is not asserted to be exhaustive beyond what was discoverable through the methodology in §0** (imports, schema relationships, route registrations, and the documentation trees). No evidence of an undiscovered fifth intent, channel, or hidden trigger was found, but the absence of evidence is not proof of absence.
- **Kizunia-consistency comparisons in §5 use `modules/competitions` as the mature-module baseline.** Other modules may follow different conventions than competitions does; this audit did not exhaustively compare notifications against every other module in the repository.

---

## 18. Verification Summary

- Notification-related areas discovered: backend module (11 subdirectories), a sibling `preferences` module, 11 HTTP routes, 1 shared internal-jobs endpoint, 4 frontend components, 3 frontend hooks, 1 service worker, 8 Prisma models, 9 Prisma enums, 2 hand-written database constraints, 2 parallel documentation trees (~80+ files combined), 21 test files, and one previously-undocumented adjacent surface (`/internal/notification/top-competition`, actually recommendation-engine debug tooling).
- Major execution flows traced end-to-end: scheduled per-user evaluation → generation → delivery (§2.1); admin-authored broadcast fan-out (§2.2); operational admin-suggestion notice (§2.3); synchronous inbox/preference/push-subscription flows (§2.4).
- Findings by severity: 0 CRITICAL, 0 HIGH, 6 MEDIUM, ~9 LOW, ~6 INFORMATIONAL (21 total; see §16 for the precise per-finding classification).
- Key security findings: the open-redirect defense is layered and verified sound at the byte level (§7.1); push-subscription token trust is an inherent-to-FCM characteristic worth naming rather than a code defect (§7.3); no page-level admin guard on the announcement composer, consistent with repository-wide convention (§7.2).
- Key reliability findings: backlog draining has no alerting and depends on a default-off self-continuation flag on a once-daily deployment target (§8.1, NTF-AUD-016); everything else in the failure-mode matrix (§8) is either guaranteed by a database constraint/atomic claim or an explicitly accepted, documented best-effort tradeoff.
- Key maintainability findings: one self-acknowledged repository-pattern gap (NTF-AUD-005), one DTO-convention divergence (NTF-AUD-006), one dead-code function (NTF-AUD-008), one misleadingly-placed debug route (NTF-AUD-007).
- Key documentation discrepancies: the product-specification's status line is stale and directly contradicts the architecture documentation (§10, NTF-AUD-001) — the most consequential single documentation finding in this audit.
- Unexpected functionality discovered: the `/internal/notification/top-competition` debug page is not notification functionality at all (§1.9); a dormant self-continuation capability exists but is never invoked in the current deployment shape (§1.9); two internal-jobs maintenance tasks unrelated to notifications share its cron trigger purely due to a platform cron-slot ceiling (§1.6).
- Recommended next implementation phases: three small, low-risk corrections now (§15, Phase 1); test-coverage and structural-consistency work next (§15, Phase 2); one performance optimization and two product-owned decisions deferred until their own growth/need signals arrive (§15, Phase 3).
- **No implementation code, schema, migration, test, or existing documentation file was modified in the course of this audit.** The only repository change is this file, `docs/code-audit/notification-system-implementation-architecture-audit.md`.
