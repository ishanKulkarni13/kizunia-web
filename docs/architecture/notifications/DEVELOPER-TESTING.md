# Notification Delivery — Developer Testing Manual

> **Status:** Live — updated at every checkpoint
>
> **Last Updated:** 2026-09-18

A hands-on manual for running the whole notification pipeline locally: generate
a notification, push it, and watch it arrive in a browser. For the system's
design and rulings, start at
[`IMPLEMENTATION-STATUS.md`](IMPLEMENTATION-STATUS.md) and
[`README.md`](README.md) instead — this document assumes that architecture and
only explains how to exercise it by hand.

---

## 1. Overview

```text
Notification ──creates, same transaction──▶ NotificationDelivery(IN_APP, DELIVERED)
     │                                              (no transport — the row is the delivery)
     └──creates, same transaction──▶ NotificationJob(DELIVER_NOTIFICATION)
                                              │
                                    picked up by the job runner
                                              ▼
                                    DeliveryService.deliver()
                                              │
                              ┌───────────────┴────────────────┐
                              ▼                                ▼
                    PushSubscription rows              getPushProvider()
                    for this user, ACTIVE only          (FCM if configured,
                              │                          else a fake that
                              └──────────┬───────────────records SKIPPED)
                                         ▼
                          NotificationDelivery(WEB_PUSH, one row per device)
                                         │
                                 provider.send(...)
                                         ▼
                              Firebase Cloud Messaging
                                         │
                          browser's firebase-messaging-sw.js
                                         ▼
                               OS-level notification
```

- **`Notification`** — one row per (user, intent, occurrence). Title, body,
  action path, and a typed `payload`. Created once; never edited.
- **`NotificationDelivery`** — one row per (notification, channel, device).
  `IN_APP` gets exactly one row, created `DELIVERED` at the same instant as the
  notification. `WEB_PUSH` gets one row per active `PushSubscription`, created
  lazily the first time delivery is attempted for that device.
- **`NotificationJob`** — the durable work queue (Postgres, `SKIP LOCKED`).
  `NOTIFY_ADMINS_OF_SUGGESTION`/`EVALUATE_*`/`FANOUT_ANNOUNCEMENT` jobs
  *generate* notifications; `DELIVER_NOTIFICATION` jobs *push* them.
- **`PushSubscription`** — one row per browser that has granted permission and
  registered an FCM token with Kizunia's own server (not the same thing as the
  browser having FCM/notification permission — see §4).
- **The FCM provider** — `next/src/modules/notifications/delivery/fcm-push-provider.ts`,
  the only file in the repository that imports `firebase-admin`. Selected by
  `push-provider.factory.ts`'s `getPushProvider()`, which falls back to a fake
  (never a real send) whenever `FIREBASE_PROJECT_ID`/`FIREBASE_CLIENT_EMAIL`/
  `FIREBASE_PRIVATE_KEY` are not all set.
- **The browser service worker** — `next/public/firebase-messaging-sw.js`,
  which shows the OS notification when a push arrives while the tab isn't
  focused.

Everything from "generate" to "attempt a send" happens inside one call to
`GET /api/v1/internal/tick` (see §6). Whether a device actually shows a
notification is the one link in the chain that happens entirely outside
Kizunia's server, in the browser — see §5.

---

## 2. Prerequisites

- **PostgreSQL**, reachable at the connection string in `DATABASE_URL`. A
  second, distinct database for integration tests, named so it visibly
  contains "test" (e.g. `kizunia_test`), referenced by `DATABASE_TEST_URL`.
- **Prisma migrations applied**: `pnpm exec prisma migrate deploy` (or `dev`,
  if you're also authoring a migration) against both databases.
- **A Firebase project** with Cloud Messaging enabled, and a **Web app**
  registered inside it (Project settings → General → Your apps). You do not
  need this to exercise generation, in-app delivery, or the delivery pipeline
  up to the provider boundary — see §3's "everything is optional" note — but
  you do need it to see a real browser notification.
- **A Chromium- or Firefox-based browser.** Web Push requires a secure
  context; `http://localhost` is exempted from the HTTPS requirement, so plain
  local development works without a certificate.
- **Notification permission**, granted once per browser profile, per origin.
- **Two Kizunia accounts**: an ordinary user (to submit a competition
  suggestion) and one with `ADMIN` or `SUPER_ADMIN` role (to receive the
  `ADMIN_COMPETITION_SUGGESTION` notice and, for `FEATURE_ANNOUNCEMENT`, to
  author one). Role is a plain column on `User` — set it directly in the
  database for local testing if there's no admin-promotion UI you're using.

---

## 3. Firebase configuration

Every Firebase variable is **optional**. With none of them set, generation,
in-app delivery, and the delivery pipeline all run exactly as they do in
production — only the push *send* is inert: `getPushProvider()` returns a fake
that records what it would have sent, and every `WEB_PUSH` delivery lands on
`SKIPPED` with an honest reason instead of a `SENT` that never happened. This
is deliberate (see `push-provider.factory.ts`'s module doc-comment): it means
the whole pipeline is exercised by the test suite and by casual local use
before anyone has a Firebase project at all.

**Public / browser values** (`NEXT_PUBLIC_` prefix — shipped in the client
bundle, not secret by design; they identify the project, they don't
authenticate anything):

| Variable | Where it comes from |
| --- | --- |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase console → Project settings → General → Your apps → Web app |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | same |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | same |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | same |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | same |
| `NEXT_PUBLIC_FIREBASE_VAPID_KEY` | Firebase console → Project settings → Cloud Messaging → Web configuration → Web Push certificates. Required by `getToken()` — without it the browser cannot mint a push token at all. |

**Server-only values** (no `NEXT_PUBLIC_` prefix — never reaches the browser
bundle; a real credential):

| Variable | Where it comes from |
| --- | --- |
| `FIREBASE_PROJECT_ID` | Firebase console → Project settings → Service accounts → Generate new private key. That downloads a JSON file; take three fields out of it rather than pasting the file. |
| `FIREBASE_CLIENT_EMAIL` | same JSON file |
| `FIREBASE_PRIVATE_KEY` | same JSON file. It's a PEM body with real newlines, which an env var can't hold literally — paste it with newlines escaped as `\n` (and the whole value quoted); `readFirebaseConfig()` unescapes it at load. **Never commit this value anywhere, including `.env.example`.** |

Three separate variables, not the JSON blob pasted whole — the blob form does
not survive some hosting providers' environment variable UIs intact, and a
partially-mangled JSON string fails at the first send rather than at startup.

To check what your own environment currently resolves to, without ever
printing the key itself:

```bash
pnpm notifications:diagnose
```

which prints `isPushConfigured()`'s answer and whether the private key at
least *looks* PEM-shaped, before touching any notification data.

---

## 4. Browser push registration

1. Open Kizunia locally (`pnpm dev`) and sign in.
2. Go to `/user/notification-preferences`. The push permission card there
   calls `usePushRegistration()`'s `enable()` on click.
3. Click to enable. This is the **only** place the browser's permission
   prompt is triggered — the hook asks once, on an explicit click, and never
   re-prompts automatically (a denied permission is treated as a final
   answer).
4. Grant permission when the browser asks.
5. Behind the scenes: `requestPushToken()`
   (`next/src/lib/push/firebase-client.ts`) registers the service worker at
   `/firebase-messaging-sw.js` (with the public Firebase config passed as
   query parameters, since files under `public/` get no build-time env
   substitution), then calls `getToken()`. The resulting token is POSTed to
   `POST /api/v1/me/push-subscriptions`, which upserts a `PushSubscription`
   row for the current user.

**What success looks like:**
- The card's status flips to "enabled".
- `SELECT * FROM push_subscription WHERE "userId" = '<your user id>'` shows a
  row with `status = 'ACTIVE'`.
- In the browser's DevTools → Application → Service Workers, a worker is
  registered at `/firebase-messaging-sw.js`.

**A subtlety that matters for debugging:** "granted" browser permission and a
registered `PushSubscription` row are two different things. Permission is
per-origin and survives a cleared token; the database row is what the server
actually uses to decide whether it can reach this browser. If you granted
permission once, then cleared site data, the permission API still reports
`"granted"` but there is no row — `findActiveSubscriptions` returns nothing,
and delivery ends at `delivery.no_subscriptions` with **no `WEB_PUSH` delivery
row created at all**, not even a `SKIPPED` one. Re-clicking "enable" fixes it.

**A push token identifies a browser, not a person.** If the same browser signs
in as a different Kizunia user, the subscription's owner moves to that user
rather than a second row being created — the token itself is globally unique.

---

## 5. Firebase-only test

Before touching Kizunia's own pipeline, confirm FCM itself reaches your
browser — this isolates "is my Firebase project/VAPID/browser setup correct"
from "is Kizunia's server correctly configured and correctly sending."

1. Register a push subscription as in §4, so you have a real token.
2. Firebase console → your project → Cloud Messaging → **New campaign** or the
   legacy **Send test message** flow. Some console versions want a specific
   registration token, which you'd need to log or read out of the
   `PushSubscription` row (the token itself is not printed by
   `notifications:diagnose`, deliberately — it's a bearer credential for that
   device).
3. Send it.
4. A browser notification should appear.

**If this fails**, the problem is upstream of Kizunia's own server entirely:
browser notification permission, the service worker registration, the VAPID
key, or the Firebase project's own configuration. Fix it here before assuming
anything about Kizunia's delivery code.

**If this succeeds but Kizunia's own pushes still don't arrive**, that
specifically proves the browser/FCM/VAPID/service-worker path is fine and
narrows the problem to Kizunia's own server: either the server-side
`FIREBASE_PROJECT_ID`/`FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY` triple
(a completely separate credential from anything the Firebase Console test used),
or something in the delivery pipeline before the provider is ever called. This
was, in fact, exactly the situation a real defect in this codebase produced —
see §12.

---

## 6. Kizunia end-to-end test

Walks a competition suggestion from submission to a reviewer's push.

1. **As a normal user**, submit a competition suggestion (`/competitions/suggestions/new`
   → `POST /api/v1/competition-suggestions/[id]/submit`) so it reaches
   `SuggestionStatus.UNDER_REVIEW`.
2. **As the reviewer** (an `ADMIN`/`SUPER_ADMIN` account), make sure that
   account has an active push subscription (§4).
3. **Wait past the grace delay**, or shorten it for local testing — see §11.
   The production default is 30 minutes; set
   `NOTIFICATION_ADMIN_SUGGESTION_DELAY_SECONDS=60` in `.env` to make this a
   1-minute wait instead. (Waiting is real: the delay is measured from the
   suggestion's `submittedAt`, not from when you trigger the tick.)
4. **Trigger the tick.** Two ways:

   ```bash
   # The real production endpoint, over HTTP, exactly as Vercel's cron calls it.
   curl -i "http://localhost:3000/api/v1/internal/tick" \
     -H "Authorization: Bearer $CRON_SECRET"
   ```

   `CRON_SECRET` must be set in `.env` for this to work at all — the route
   fails closed with `401` whenever it's unset, regardless of any header sent.
   Never print or commit its value; treat it like any other credential.

   Or, without needing `pnpm dev` running and without touching HTTP:

   ```bash
   pnpm notifications:tick
   ```

   which calls `NotificationTickService.run()` — the exact function the route
   calls — directly. Behavior is identical; this is purely a convenience for
   fast local iteration.

5. One tick call does the whole thing in order: discovers the suggestion,
   generates the `Notification` + `IN_APP` delivery + a `DELIVER_NOTIFICATION`
   job (all in one transaction), then drains the queue in the same call — so
   the push job it just created is also attempted before the tick returns
   (the drain loop stops only on an *empty* claim, specifically so this
   happens within one tick rather than waiting for the next).
6. **Check the result**: `/user/notifications` as the reviewer should show
   the new notice, and — with Firebase configured (§3) and a real subscription
   (§4) — a browser notification should appear. `pnpm notifications:diagnose`
   prints exactly what happened at the database level; see §7.
7. **Click the notification** (#93). The target should open (an existing Kizunia tab is
   focused or navigated; otherwise a new window). Then `/user/notifications` should show that
   row read, and `pnpm notifications:diagnose` / §7 should show `readAt` and `respondedAt` both
   set. Repeat with the session expired or the network off: the target must still open, and the
   row stays unread. In DevTools -> Application -> Service Workers, the worker's console shows the
   `PATCH /api/v1/me/notifications/<id>/responded` request.

---

## 7. Prisma/database verification

`pnpm notifications:diagnose` is the fast path — it prints all of the below
in one shot, read-only. Prisma Studio (`pnpm exec prisma studio`) works too
for browsing interactively.

**`Notification`** — one row per (user, intent, occurrence). If it's missing,
the problem is in generation or scheduling (§8's first branch).

**`NotificationDelivery`**, `channel = 'IN_APP'` — should always be
`status = 'DELIVERED'`, created in the same transaction as the notification.
If this row is missing but the notification exists, something is wrong with
generation's own transaction — that would be a serious, unusual bug (in-app
delivery has no failure mode by design).

**`NotificationDelivery`**, `channel = 'WEB_PUSH'` — the one that needs
reading carefully. Possible states, and what each means:

| `status` | Meaning |
| --- | --- |
| *(no row at all)* | Either the user has zero `ACTIVE` `PushSubscription` rows (`delivery.no_subscriptions`, logged, not an error), or the recipient disabled the intent before the `DELIVER_NOTIFICATION` job ever ran (`intentStillEnabled` returned false with no pre-existing row to mark `SKIPPED`) |
| `PENDING` | Row created, provider not yet invoked, or `nextAttemptAt` is in the future (backing off) — check the job queue (§7 below) to see if a `DELIVER_NOTIFICATION` job is actually being claimed |
| `PROCESSING` | Mid-attempt; should not linger — a stuck `PROCESSING` row usually means a crashed worker whose job lease hasn't expired yet |
| `SENT` | The provider (real FCM, or the fake) accepted it. **Not** the same as "a device displayed it" — see ND-D-03; `providerMessageId` is populated |
| `FAILED` | Either the provider reported a permanent/invalid-token error, or attempts were exhausted (`attempts >= maxAttempts`) — read `failureReason` |
| `SKIPPED` | A deliberate non-send, not an error — read `failureReason`: `"No push provider is configured in this environment"` (Firebase absent, §3), `"Intent disabled by the user after this notification was created"` (ND-D-12), or `"Too old to be worth pushing"` (past `DELIVERY_CONFIG.pushValidForSeconds`, default 6 hours) |

**`NotificationDeliveryAttempt`** — one row per send attempt. `providerResponse`
carries the raw classified outcome (`ACCEPTED`/`INVALID_TOKEN`/`RETRYABLE`/`PERMANENT`)
— the most direct way to see what the provider actually said.

**`NotificationJob`** — `kind = 'DELIVER_NOTIFICATION'` (push) or one of
`EVALUATE_TOP_RELEVANT_COMPETITION` / `EVALUATE_REGISTRATION_CLOSING` /
`FANOUT_ANNOUNCEMENT` / `NOTIFY_ADMINS_OF_SUGGESTION` (generation). `status` is
`PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`, or `CANCELLED`. A job stuck at
`PENDING` with `runAt` in the past means the tick isn't being triggered, or a
crash is leaving `attempts` incrementing without ever completing — `lastError`
carries the exception message from the most recent attempt.

**`PushSubscription`** — `status` is `ACTIVE`, `INVALID` (deactivated after an
`INVALID_TOKEN` response, terminal, never retried), or `REVOKED`.
`consecutiveFailures` climbing toward `DELIVERY_CONFIG.consecutiveFailureCeiling`
(default 5) without a `lastSuccessAt` update means a token that's dead in a
way the provider isn't reporting cleanly.

---

## 8. Debugging decision tree

```text
Notification missing from /user/notifications?
  └─▶ Query `notification_job` for the generation kind (EVALUATE_*,
      FANOUT_ANNOUNCEMENT, NOTIFY_ADMINS_OF_SUGGESTION). No row at all?
      The scheduling pass never ran or found nothing due — check the grace
      delay/lookback window (admin suggestion) or the preference row
      (recommendation intents require an explicit opt-in). A row present
      but not COMPLETED? Read `lastError`.

Notification exists, but no WEB_PUSH delivery row at all?
  └─▶ Check PushSubscription for that userId: any ACTIVE row? None →
      delivery.no_subscriptions (§7), not a bug. A row exists but no
      WEB_PUSH delivery? Check whether the intent was disabled for that
      user (notification_preference) before the DELIVER_NOTIFICATION job
      ran (ND-D-12) — skipPending() only touches EXISTING rows, so a
      disable that lands before the first attempt leaves nothing behind.

WEB_PUSH delivery exists but stuck PENDING?
  └─▶ Is the tick actually running? (`pnpm notifications:diagnose`'s job
      section, or query notification_job directly.) Is CRON_SECRET set,
      if you're hitting the HTTP route? Is `nextAttemptAt` in the future
      (backing off — wait, or re-trigger the tick after that time)?

WEB_PUSH delivery is FAILED?
  └─▶ Read `failureReason` and the matching NotificationDeliveryAttempt's
      `providerResponse`. INVALID_TOKEN → the subscription is now INVALID,
      expected, re-register (§4). PERMANENT → a real FCM rejection, read
      the vendor error code. Exhausted retries → check whether the
      failure is actually transient (network) vs. structural.

WEB_PUSH delivery is SKIPPED?
  └─▶ Read `failureReason` — it names the exact reason (§7's table). "No
      push provider configured" → run `pnpm notifications:diagnose` and
      fix §3. "Intent disabled" → check notification_preference. "Too
      old" → the tick wasn't triggered promptly enough; re-run the whole
      flow rather than waiting on this delivery, which is now terminal.

WEB_PUSH delivery is SENT, but the browser shows nothing?
  └─▶ This is now a browser/service-worker problem, not a server problem
      — SENT means FCM accepted the message. Check DevTools → Application
      → Service Workers for errors, confirm the tab isn't focused (the
      service worker only shows a banner when the page isn't focused —
      onForegroundMessage handles the focused case separately, and only
      if the app actually wires up a foreground handler), and re-run the
      Firebase-only test (§5) to confirm the browser can still receive
      anything at all.

Firebase Console test (§5) itself fails?
  └─▶ Not a Kizunia problem. Check browser notification permission,
      NEXT_PUBLIC_FIREBASE_VAPID_KEY, and the Firebase project's own Web
      Push configuration.
```

---

## 9. Testing current notification intents

| Intent | Trigger | Recipient / audience | Preference default | Timing | Local trigger |
| --- | --- | --- | --- | --- | --- |
| `TOP_RELEVANT_COMPETITION` | `NotificationSchedulerService.scheduleDueEvaluations` during tick | Any user — but only those with an **explicit `enabled: true`** preference row are even scheduled (`findEnabledUserIds`) | `false` (opt-in) | Once per user per day (occurrence keyed on the day) | Set the preference on at `/user/notification-preferences`, then `pnpm notifications:tick` |
| `REGISTRATION_CLOSING` | Same scheduling pass as above | Same opt-in requirement | `false` (opt-in) | Deadline window derived from `SCHEDULE_CONFIG.sweepIntervalSeconds` | Same — opt in, ensure a bookmarked/relevant competition has a deadline inside the window, then tick |
| `FEATURE_ANNOUNCEMENT` | An admin authors one at `/admin/notification-announcements` (`AnnouncementService.create`), which atomically enqueues a `FANOUT_ANNOUNCEMENT` job | Every user (fan-out, resumable across pages) | `true` (opt-out) | Immediate once `scheduledFor` (default now) is reached and the tick drains | Author an announcement, then `pnpm notifications:tick` |
| `ADMIN_COMPETITION_SUGGESTION` | `NotificationSchedulerService.scheduleAdminSuggestionNotices` during tick, discovering suggestions `UNDER_REVIEW` past the grace delay | Every user holding `PlatformAction.REVIEW_COMPETITION_SUGGESTIONS` (currently `ADMIN`/`SUPER_ADMIN`), excluding the submitter | `true` (opt-out) | `suggestionNoticeDelaySeconds` (default 30 min) ≤ latency ≤ delay + tick interval | §6, end to end |

For every intent, expect one `IN_APP` delivery (`DELIVERED`, always) and one
`DELIVER_NOTIFICATION` job, which — with an active subscription and Firebase
configured — produces one `WEB_PUSH` delivery per device, `SENT`.

---

## 10. Failure/retry testing

- **Duplicate tick execution**: run `pnpm notifications:tick` (or curl the
  route) twice in a row. The second run should enqueue/generate nothing new —
  every notification is unique on `(userId, intent, occurrenceKey)`, and every
  job is unique on its `dedupeKey`; a collision is treated as success, not an
  error.
- **Worker failure/recovery**: a job's lease (`JOB_CONFIG.leaseSeconds`,
  default 2 minutes) is what protects against a crashed worker — another
  worker can reclaim it once the lease expires. Not easily forced by hand
  without killing a process mid-job; the automated coverage is in
  `jobs/postgres-work-queue.integration.test.ts` and
  `jobs/job-runner.integration.test.ts`.
- **Push provider failure / invalid subscription**: register a subscription,
  then edit its `token` in the database to something arbitrary before
  triggering delivery. A real FCM call against a garbage token returns
  `INVALID_TOKEN`; the resulting delivery is `FAILED` and the subscription
  flips to `status = 'INVALID'` on the first sighting (never retried — ND-D-09).
- **Disabled push preference**: toggle the intent off at
  `/user/notification-preferences` for the reviewer account, then submit a new
  suggestion and tick. No notification (and hence nothing to push) should
  appear for that reviewer at all — the check happens before generation for
  this intent (`shouldNotifyReviewer`), not only at delivery time.
- **Multiple browser subscriptions**: register the same account from two
  browsers/profiles. Both should get independent `WEB_PUSH` delivery rows for
  the same notification — one device's outcome never affects the other's
  (ND-D-11).
- **Reviewer audience filtering**: confirm a plain `USER` role account never
  receives an `ADMIN_COMPETITION_SUGGESTION` notice, and that a `MODERATOR`
  doesn't either (that role does not currently hold
  `REVIEW_COMPETITION_SUGGESTIONS`).

---

## 11. Local environment reference

Every variable below is read in
`next/src/modules/notifications/config/notification-config.ts` or by the
routes/services this document references. None of these are invented — each
is grep-able in the source under that exact name.

| Variable | Purpose | Recommended local value | Default / production behavior | Public? |
| --- | --- | --- | --- | --- |
| `CRON_SECRET` | Bearer token guarding `GET /api/v1/internal/tick` | Any non-empty local-only string | Route returns `401` unconditionally if unset | Server-only |
| `DATABASE_TEST_URL` | Dedicated database for `pnpm test:integration`; must be distinct from `DATABASE_URL` and contain "test" | `postgresql://…/kizunia_test` (or similar) | Integration tests refuse to run if unset | Server-only |
| `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` | Server-side Admin SDK credentials — what actually sends a push | Your Firebase project's service account | Absent → fake provider, every push `SKIPPED` | Server-only |
| `NEXT_PUBLIC_FIREBASE_API_KEY` / `_AUTH_DOMAIN` / `_PROJECT_ID` / `_MESSAGING_SENDER_ID` / `_APP_ID` | Browser Firebase config | Your Firebase project's web app config | Absent → browser can't initialize Firebase Messaging at all | Public |
| `NEXT_PUBLIC_FIREBASE_VAPID_KEY` | Web Push certificate key pair | Your Firebase project's Cloud Messaging Web Push key | Absent → `getToken()` cannot mint a token | Public |
| `NOTIFICATION_ADMIN_SUGGESTION_DELAY_SECONDS` | Grace delay before an admin suggestion notice is generated | `60` (1 minute) | 1800 (30 minutes) | Server-only |
| `NOTIFICATION_ADMIN_SUGGESTION_LOOKBACK_SECONDS` | How far back discovery looks for un-notified suggestions | Leave default | 604800 (7 days) | Server-only |
| `NOTIFICATION_ADMIN_SUGGESTION_DISCOVERY_LIMIT` | Suggestions one discovery pass enqueues | Leave default | 500 | Server-only |
| `NOTIFICATION_DAILY_HOUR_UTC` | Hour for the (unrelated) daily deadline evaluation | Leave default | 13 | Server-only |
| `NOTIFICATION_SWEEP_INTERVAL_SECONDS` | What the system believes its own tick cadence is; derives the deadline window | Leave default unless you're testing `REGISTRATION_CLOSING` timing specifically | 86400 (1 day) | Server-only |
| `NOTIFICATION_JOB_MAX_ATTEMPTS` | Total attempts per job, including the first | Leave default | 5 | Server-only |
| `NOTIFICATION_WORKER_BUDGET_MS` | Wall-clock budget per drain pass | Leave default | 45000 | Server-only |
| `NOTIFICATION_WORKER_SELF_CONTINUE` | Whether a drain pass with leftover work re-invokes itself over HTTP | Leave off locally (call `pnpm notifications:tick` again instead) | `false` | Server-only |

Two scripts exist purely for local convenience (both wrap production code,
neither is a separate implementation):

- `pnpm notifications:tick` — runs one tick without HTTP or `CRON_SECRET`.
- `pnpm notifications:diagnose` — read-only snapshot of provider config,
  recent notifications/deliveries, subscriptions, attempts, and any job not
  yet `COMPLETED`.

---

## 12. Troubleshooting

| Symptom | Where to look |
| --- | --- |
| Nothing in `/user/notifications` at all | §8, first branch — check `notification_job` for the generation kind |
| In-app notice arrives, no browser push, ever | §8, second/third branch — check for a `PushSubscription` row and a `WEB_PUSH` delivery row |
| Firebase Console test message works, Kizunia's own push doesn't | This is the single most informative test result: it isolates the problem to Kizunia's **server-side** credentials or delivery code, since the console bypasses both entirely. Run `pnpm notifications:diagnose` first — `isPushConfigured()` and the PEM-shape check are the fastest way to rule out a `.env` problem before reading code. If those look correct and pushes still fail, check `notification_job.lastError` on the `DELIVER_NOTIFICATION` job — a provider-construction bug will show up there, not as a delivery-row `failureReason`, because it happens before `DeliveryService` runs. See the historical case below. |
| Integration tests fail immediately with a `DATABASE_TEST_URL` error | Set it, distinct from `DATABASE_URL`, name containing "test" — see `docs/testing/database.md` |
| `GET /api/v1/internal/tick` always returns 401 | `CRON_SECRET` is unset — it fails closed unconditionally, not only on a mismatch |
| A `WEB_PUSH` delivery sits `PENDING` indefinitely | Confirm the tick is actually being triggered somehow (locally: manually; in production: check the Vercel cron and consider an external pinger — see `IMPLEMENTATION-STATUS.md`'s "Vercel tier" section) |

### A historical case worth knowing about

`push-provider.factory.ts`'s `getPushProvider()` once loaded the FCM adapter
with a lazy `require()`. Under Next.js's server runtime that file is part of
the same ESM module graph, and `require()`-ing an ESM sibling does not reliably
return its named export — the result was `TypeError: FcmPushProvider is not a
constructor`, thrown for every intent, on every `DELIVER_NOTIFICATION` job,
with `FIREBASE_*` credentials fully and correctly configured. In-app delivery
was completely unaffected (it never touches the provider), so the visible
symptom was exactly "notifications arrive in the inbox, push never happens,"
with Firebase Console's own test message working the entire time — because
that test never goes through Kizunia's server at all. The fix was to load the
adapter with a dynamic `import()` instead, which does not have this failure
mode. `push-provider.factory.test.ts` now regression-tests this directly: it
asserts `getPushProvider()` returns a real, constructible provider when
credentials are present, with no database and no network. If you hit a similar
symptom — every `DELIVER_NOTIFICATION` job failing with the same
`lastError`, across every intent, despite `isPushConfigured()` returning
`true` — check `notification_job.lastError` first; it will say so directly.
