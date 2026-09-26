# Phase VIII — Admin Billing Tools and Operations

> **Status:** Implemented 2026-09-26. The code, the UI and the automated tests are complete. **The phase is not closed:** the [manual UI verification](manual-test.md) has not been run. Decisions are ruled in [IB-28](../../implementation/open-decisions.md#ib-28--phase-viii-decisions-and-implementation-rulings)
>
> **Depends on:** Phase IV (it grows with V–VII) · **Razorpay needed:** TEST · **Old slice:** S15

## Objective

Give support and operators what the [operations runbook](../../cross-cutting/operations-runbook.md) assumes exists, so that every billing question ("why does this user have this access?", "what happened to this subscription?", "is billing healthy?") can be answered and acted on without database access.

## Scope

- **Explain access:** the resolver's explain output for any user: sources, phases, grants, and mode.
- **Billing timeline** per user or subscription: history entries, operations, events (metadata; raw payloads for `SUPER_ADMIN` only), and money facts.
- **Anomalies:** list, detail, and **resolve with a reason**. Resolving records a human decision and never changes billing state by itself.
- **Bulk re-sync:** mark matching subscriptions due at P3 (optionally filtered by `lastSyncedAt < t`).
- **Health summary** (`GET /api/v1/admin/billing/health`) computed from tables:
  - subscriptions by phase;
  - due-backlog age;
  - open anomalies by type;
  - `OUTCOME_UNKNOWN` count and age;
  - the last `billing:sync` result;
  - cooldown state;
  - the last webhook received per mode;
  - the provider mode.
- **Payload pruning** (`billing:payload-prune`): null `rawPayload` older than the retention horizon (180 days, the B3 default), in bounded batches.
- **Runbook alignment:** every runbook procedure maps to a tool that exists, and the runbook is corrected where the tools differ.

"Sync now" (Phase IV) and admin immediate cancel (Phase VI) are already built. This phase gives them a home in the admin billing UI.

## Architectural components involved

`modules/billing/backend/admin.controller.ts` and its services; the resolver's explain function; history, anomaly and event repositories; the internal-jobs registry; admin UI under `app/(dashboard)/admin/billing/**`.

## Dependencies

Phase IV (history, anomalies, events, sync). Checkout, lifecycle and promotion views appear as Phases V–VII land.

## Files and modules likely affected

Paths are relative to `next/src/`.

- `modules/billing/backend/{admin.controller,admin/*}.ts`, `backend/reconciliation/payload-prune.ts`.
- `app/api/v1/admin/billing/**`, `app/api/v1/internal/billing/payload-prune/route.ts` (optional manual route).
- `app/(dashboard)/admin/billing/**`.
- `docs/architecture/subscription/cross-cutting/operations-runbook.md`.

## Database and schema work

None.

## Domain and application work

- Views are read-only apart from these recorded actions:
  - anomaly resolution (with reason and actor);
  - bulk re-sync (a mark-due, never a provider mutation);
  - payload pruning (nulling content, never deleting rows).
- Raw payloads are shown only to `SUPER_ADMIN`, and are never logged.

## Provider work

None new. Bulk re-sync spends the P3 budget.

## Integration work

- Links from anomaly alerts (`billing.alert`) to the admin views.
- The runbook cross-references each tool.

## Authorization and entitlement implications

Role mapping per [IB-15](../../implementation/open-decisions.md#ib-15--billing-admin-roles) (product decision (owner)):

| Tool | Action | Roles |
| --- | --- | --- |
| Explain, timeline, anomaly list, health, sync now | `VIEW_BILLING` | `ADMIN`, `SUPER_ADMIN` |
| Resolve anomaly, bulk re-sync, admin immediate cancel | `MANAGE_BILLING` | `SUPER_ADMIN` |
| Raw payload view | — | `SUPER_ADMIN` only |

The platform bypass never confers billing-admin actions implicitly.

## Concurrency and transaction considerations

- Anomaly resolution uses a conditional update on the open row. A concurrent re-detection creates a new open row after resolution, by design of the partial unique index.
- Pruning runs in bounded batches, with no long transactions.

## Observability requirements

- `anomaly.resolved` events with actor and reason.
- Admin actions logged with actor.
- The health endpoint is the metrics substitute until the Phase IX alert channel exists.

## Testing requirements

**Integration:**
- role checks for every tool (`ADMIN` view-only, `MODERATOR` denied, raw payload `SUPER_ADMIN` only);
- anomaly resolve then re-detect;
- bulk re-sync marks rows due without a provider call;
- the prune nulls only old payloads and keeps rows.

**Unit:** health aggregation.

## Acceptance criteria

- [x] Every procedure in the operations runbook can be performed with a tool from this phase or an earlier one, with no manual SQL. *The runbook is rewritten to name each tool; the one procedure that is deliberately not a tool (removing a mode-mismatched row) is an engineering data migration and says so.*
- [x] An `ADMIN` can diagnose ("explain", timeline, health) but cannot change billing. A `SUPER_ADMIN` can resolve, re-sync and cancel with a reason.
- [x] Raw payloads never appear to non-`SUPER_ADMIN` users or in logs.
- [x] Payload pruning honors the retention default and never deletes rows.

## Explicit non-goals

- Refund issuing (done in the Razorpay Dashboard, recorded as facts).
- A metrics backend.
- The alert delivery channel (Phase IX).
- The account-removal workflow (deferred).

## Decisions that must already be settled

IB-15 (DECIDED). B3 retention: the 180-day default applies, and B3 stays DEFERRED.

## Risks and blockers

- **Risk:** exposing personal data in raw payloads. Mitigated by the role gate and the no-logging rule.
- **Blockers:** none.

## Expected output

The admin billing UI and API (explain, timeline, anomalies, bulk re-sync, health); the payload-prune task; an aligned runbook; tests.

## Implementation record

**What was built** (paths relative to `next/src/`)

- **Authorization.** A new platform action `VIEW_BILLING_RAW_PAYLOADS`, held by `SUPER_ADMIN` only, and `BillingAuthorizer.viewRawPayloads` with the `canManageBilling` / `canViewRawPayloads` UI flags. No platform override, so the admin bypass still confers nothing (`authorization/platform/*`, `modules/billing/backend/authorization/authorizer.ts`).
- **Admin services** (`modules/billing/backend/admin/`), each authorizing through `PlatformContextResolver` then `BillingAuthorizer`, like the grant and sync services:
  - `explain.service.ts`: the resolver's `explainEffectiveAccess`, decorated by id (phase-entered time, sync state, grant reason and granter) with the user's open anomalies, plus a user lookup by id or e-mail.
  - `timeline.service.ts` and `timeline.repository.ts`: history, operations, event metadata and money facts, merged newest first, at most 200 per source. The event query computes `hasPayload` in SQL, so a payload is never loaded.
  - `payload.service.ts`: one raw payload for a `SUPER_ADMIN`, logged without its content.
  - `anomaly-admin.service.ts`: list, detail and resolve (one conditional update; reason mandatory in the service).
  - `bulk-resync.service.ts` with `SyncClaimRepository.markDueBulk`: a keyset-batched mark-due, with a dry run.
  - `health.service.ts` and the pure `health-summary.ts`.
- **Payload pruning.** `backend/reconciliation/payload-prune.ts` (`PayloadPruneTask`), `RETENTION_CONFIG` in `config/billing-config.ts`, its registration in `app/api/v1/internal/tick/tasks.ts` (daily, before the orphan scan) and the manual `GET /api/v1/internal/billing/payload-prune`.
- **Routes.** Ten thin route files under `app/api/v1/admin/billing/` (`health`, `users`, `users/{id}/access`, `users/{id}/timeline`, `subscriptions/{id}/timeline`, `events/{id}/payload`, `anomalies`, `anomalies/{id}`, `anomalies/{id}/resolve`, `resync`), each a method on `BillingAdminController` in the existing `Route.execute` → session → rate limit → schema → service shape. `schemas/admin.ts` holds the inputs; `errors/admin-errors.ts` the four new errors.
- **Observability.** `billing.alert` carries an `adminPath`; the logger redacts `rawPayload` as a safety net; events `anomaly.resolved` (`by: admin`), `resync.bulk_previewed|bulk_marked`, `admin.payload_viewed` and `payload.pruned`.
- **UI** (`app/(dashboard)/admin/billing/**`, components in `modules/billing/frontend/components/`, client in `modules/billing/api/billing-admin-api.ts`): the overview (health, user lookup, bulk re-sync for `SUPER_ADMIN`), a per-user page (explain, timeline, **sync now** and **immediate cancel** calling the existing Phase IV and VI endpoints, raw payload for `SUPER_ADMIN`), and the anomaly list and detail with resolution. Two sidebar entries; the Promotions entry is now `SUPER_ADMIN`-only.
- **Runbook and documents.** The [operations runbook](../../cross-cutting/operations-runbook.md) is rewritten so each procedure names a tool that exists; [IB-28](../../implementation/open-decisions.md#ib-28--phase-viii-decisions-and-implementation-rulings), configuration, the observability documents, and the [TEST runbook](manual-test.md).
- **No schema change and no migration**: `prisma/` is untouched, and `prisma migrate status` reports the database up to date (36 migrations).

**Implementation decisions** (the lasting ones are [IB-28](../../implementation/open-decisions.md#ib-28--phase-viii-decisions-and-implementation-rulings), all architecture/technical, none a product decision)

- **Prune nulls, never deletes** (item 1); **bulk re-sync only marks due, never demotes a pending webhook sync** (item 4); **the timeline never carries a payload for any role** (item 5); **anomaly resolution is one conditional update** (item 10); **explain reuses the resolver, current instant only** (item 7).
- **Admin actions are audited by logs with the actor**, as the phase specifies; no table is added (item 11).

**Deviations from the documentation**

- **No historical explain.** The design allowed `explainEffectiveAccess(userId, at)` answering "as of" from history and grant audit. Only the current instant is exposed; no acceptance criterion needs the other ([IB-28](../../implementation/open-decisions.md#ib-28--phase-viii-decisions-and-implementation-rulings) item 7).
- **"The last `billing:sync` result" is its last run time and status** from `internal_job_run`. The run's counts are logged, not persisted; persisting them would have needed a schema change (item 9).
- **"Links from anomaly alerts" are a field, not a delivered link.** Every `billing.alert` carries an `adminPath`; the channel that delivers alerts is Phase IX.
- **The health summary and the timeline carry more than the scope listed** (the oldest due and `OUTCOME_UNKNOWN` rows, the orphan watermark, the previous-secret match, provider reference ids), because the runbook's procedures need them and the tables already hold them (items 6 and 9).
- **A manual prune route exists.** The scope called it optional; every other billing task has one, and the runbook relies on manual runs.
- **The admin UI has no automated tests.** The repository has no component-test infrastructure (unit and integration tests run in a node environment only). The UI is covered by typecheck, lint, `next build` and the [manual runbook](manual-test.md); the API behind it is covered in full.

**Verification** (2026-09-26)

- **Unit tests:** 1,481 run (1,447 after Phase VII); 1,480 pass. The one failure is not from this phase (see the known issues).
- **Integration tests:** 1,052 run (954 after Phase VII); 1,051 pass. The one failure is not from this phase (see the known issues). The new suites:
  - `admin-billing.controller.integration`: the authorization matrix across all twelve admin tools (the ten new ones plus the Phase IV sync now and Phase VI immediate cancel): 401, `ADMIN` read-only, `SUPER_ADMIN` mutations, `MODERATOR` and `USER` denied; the 4xx envelopes and stable codes; a raw payload only in the `SUPER_ADMIN` payload response and never in a log; the read header and the 61st-write `429`;
  - `explain`, `timeline`, `payload`, `anomaly-admin`, `bulk-resync`, `health` service suites and `payload-prune` plus its route;
  - unit: the health aggregation, the alert `adminPath`, the `rawPayload` redaction, the tick order and budget, the role matrix, and a static test that no Phase VIII file obtains a provider.
- **Typecheck** (`tsc --noEmit`), **`next build`** (the four new pages, the ten admin API routes and the prune route all listed) and **ESLint** on every touched area: clean, including the billing boundary rules. Existing suites for billing, entitlements, sync, webhooks, commands and notifications all run in the totals above.
- **Schema state:** no change in `prisma/`; `prisma migrate status` reports the database up to date; `prisma validate` passes.
- **Provider boundary:** no Phase VIII file imports the provider factory, the budgeted provider, a Razorpay module or the `razorpay` package, or reads a `RAZORPAY_*` variable. The only `provider/` import is the resolved-mode seam (`provider-mode`) that Phase IV already uses. The bulk re-sync test proves the fake provider is untouched by the mark and used only when `billing:sync` runs.
- **Mutation checks.** Each defect was applied on its own, made at least one test fail, and was reverted (`git checkout`, so byte-for-byte). 24 of 24 killed:

  | | Mutation | Killed by |
  | --- | --- | --- |
  | M1 | health: drop the `VIEW_BILLING` check | health service and controller matrix |
  | M2 | anomaly resolve: `MANAGE_BILLING` → `VIEW_BILLING` | anomaly service and matrix |
  | M3 | payload view: raw-payload check → `VIEW_BILLING` | payload service and matrix |
  | M4 | resolve: drop `resolvedAt IS NULL` | the concurrent and repeat resolution tests |
  | M5 | resolve: drop the reason validation in the service | six reason cases |
  | M6 | reason rule: `min(3)` → `min(0)` | reason cases for resolve and bulk re-sync |
  | M7 | bulk re-sync: drop the provider-mode predicate | the other-mode row is marked |
  | M8 | bulk re-sync: drop the bound-row predicate | the unbound row is marked |
  | M9 | bulk re-sync: drop the `lastSyncedAt` filter | the filter test |
  | M10 | bulk re-sync: always set the reason to `ADMIN` | a pending webhook sync is demoted |
  | M11 | bulk re-sync: a dry run writes | the dry-run test |
  | M12 | prune: drop the retention cutoff | a recent payload is pruned |
  | M13 | prune: drop the batch `LIMIT` | the bounded-run test |
  | M14 | prune: delete the row instead of nulling | row-count and stamp tests |
  | M15 | timeline: leak the payload into an event entry | timeline and matrix secrecy tests |
  | M16 | payload view: log the payload | the log-secrecy test |
  | M17 | payload response: drop `no-store` | the matrix cache-header test |
  | M18 | bulk re-sync: `MANAGE_BILLING` → `VIEW_BILLING` | service and matrix |
  | M19 | permission set: give `ADMIN` raw payloads | the role-matrix tests |
  | M20 | logger: stop redacting `rawPayload` | the sanitize test |
  | M21 | tick: drop the prune registration | the tick-order test |
  | M22 | prune route: accept any caller | the 401 tests |
  | M23 | health: keep zero-count anomaly types | the aggregation unit test |
  | M24 | explain: report a mode-mismatched subscription as contributing | the explain service test |

**Known issues, not caused by this phase**

- `modules/billing/config/plan-catalog.test.ts` ("the shipped offer catalogs are empty") fails while the working tree carries an **uncommitted** edit to `config/offer-catalog.ts` that adds a TEST `WELCOME50` Offer. HEAD has no such entry; the test passes without the edit. That edit is left as it was found, and is not part of any Phase VIII commit. If it is committed, the test's expectation needs updating with it.
- `modules/notifications/delivery/delivery.integration.test.ts` ("skips a push that is no longer worth sending") is date-dependent: it fixes `NOW` at 2026-09-17 while the notification is stamped with the real clock, so once the real date has passed the staleness window it no longer holds. Untouched by this phase.
- **`lib/rate-limit/postgres.store.ts` prunes with `"expiresAt" < NOW()`** against a naive-UTC `timestamp` column. If the database session time zone is not UTC (the dev database's is `Asia/Calcutta`), live counters look expired and the 1-in-500 opportunistic prune can delete one mid-window, making a limit intermittently too generous. Production Postgres defaults to UTC, where it is correct. It surfaced here as an intermittently failing rate-limit test, which now pins the random prune off; the store is unchanged.

### Open items

- The manual UI verification ([runbook](manual-test.md), V1–V12) is not run.
- A durable audit table for admin actions (bulk re-sync, payload views) is a possible later addition; today they are recorded in logs with the actor.
- A historical "as of" explain, and indexes for money facts by subscription or user and for operations by `(mode, status, createdAt)`, if the admin queries ever need them.
- The alert delivery channel and LIVE readiness are [Phase IX](../phase-IX/README.md).

**Commits** (in order)

1. `986bd71` feat(subscription-p8): add the raw-payload billing action and authorizer checks
2. `843255b` feat(subscription-p8): add admin explain, billing timeline and raw-payload services
3. `05b8516` feat(subscription-p8): add anomaly listing and human resolution
4. `7b8ca2d` feat(subscription-p8): add bulk re-sync as a batched mark-due at priority 3
5. `a020bad` feat(subscription-p8): add the table-derived billing health summary
6. `d2c9cf3` feat(subscription-p8): add the billing:payload-prune task, tick registration and manual route
7. `dd627e0` feat(subscription-p8): expose the admin billing API routes and link alerts to admin views
8. `6bdfb01` test(subscription-p8): cover the admin billing authorization matrix, envelopes and payload secrecy
9. `68a5d9f` feat(subscription-p8): add the admin billing overview, user and anomaly pages
