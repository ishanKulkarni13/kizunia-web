# Phase IV — Synchronization, Reconciliation and Webhooks

> **Status:** Implemented 2026-09-25. Every acceptance criterion is met, and the webhook behavior was verified against Razorpay TEST. The missing-subscription rule is decided: operation context ([IB-23](../../implementation/open-decisions.md#ib-23--detecting-a-missing-provider-subscription)); the other open details are ruled in [IB-24](../../implementation/open-decisions.md#ib-24--phase-iv-implementation-rulings).
>
> **Depends on:** Phase III · **Razorpay needed:** TEST, plus a stable public webhook URL · **Old slices:** S6, S7

## Objective

Build the **one synchronization mechanism** that turns Razorpay's authoritative state into Kizunia's subscription phase, and the two things that trigger it outside commands: webhooks and due-based reconciliation. After this phase, any change made at Razorpay (Dashboard, customer, bank, renewal) is observed, applied in order and recorded, even when webhooks are late, duplicated, reordered or missing.

## Scope

- **The remaining provider-boundary piece:** `parseWebhookEvent` and the `ProviderWebhookEvent` catalog, deferred from Phase III because they need the event catalog ([webhooks](../../implementation/webhooks.md)). Phase III's `razorpay/mapping.ts` is wire-shape translation only; everything that turns a provider status into a Kizunia phase starts here.
- **How a missing provider subscription is detected: a decision to rule on first.** *Ruled 2026-09-25: operation context ([IB-23](../../implementation/open-decisions.md#ib-23--detecting-a-missing-provider-subscription)).* Phase III's contract suite observed that an unknown ID is a `400` (`REJECTED`), not the `404` (`NOT_FOUND`) the design assumed (D12 in [Razorpay facts](../../provider-boundary/razorpay-facts.md#documentation-vs-observed-behavior)). So `PROVIDER_SUBSCRIPTION_MISSING` and `PROVIDER_MODE_MISMATCH` cannot be keyed on the `NOT_FOUND` class. The options are **operation context** (a `fetchSubscription` of a stored ID can only be refused because the ID is unknown) or a second documented description-match exception. Rule on it, and record the ruling, before the apply path depends on either ([Phase III open items](../phase-III/README.md#open-items)).
- **State mapping** (`policy/state-mapping.ts`, pure), including the IB-9 trial-conversion rule, whose grace C7 is exercised in Phase VII ([state mapping](../../lifecycle/state-mapping.md#the-mapping)).
- **`nextDue`** (`policy/next-due.ts`, pure): checkpoints and heartbeats per phase, with `HALTED` decay ([reconciliation](../../implementation/reconciliation.md)).
- **`SyncService`** ([synchronization](../../implementation/synchronization.md)):
  - `markDue`;
  - batch and targeted **claim** (`FOR UPDATE SKIP LOCKED` + lease);
  - fetch through `BudgetedProvider`;
  - the guarded **apply** (a stale-apply guard on request send time, mode check, catalog validation, a terminal-out guard, history, operation settling, open-subscription detection);
  - failure backoff.
- **Anomalies** (upsert on the open row) and **subscription history** entries.
- **The `billing:sync` tick task**, registered **before** `notifications:tick` with its own budget ([IB-10](../../implementation/open-decisions.md#ib-10--tick-time-budget)), plus the manual `GET /api/v1/internal/billing/sync` route (`CRON_SECRET`).
- **Webhook ingestion** ([webhooks](../../implementation/webhooks.md)):
  - `POST /api/v1/webhooks/razorpay`: verify the raw body (current, then previous secret), check `account_id`, record the event and money facts in one transaction, then 2xx;
  - an `after()` targeted sync;
  - resolution of unmatched events through `notes`.
- **Admin "sync now"** for one subscription (`VIEW_BILLING`; it only reads from Razorpay, [IB-15](../../implementation/open-decisions.md#ib-15--billing-admin-roles)).
- **Alert events:** every alert condition emits `billing.alert` from here on ([IB-11](../../implementation/open-decisions.md#ib-11--alerting-channel)).
- **A stable TEST webhook endpoint** registered in the Razorpay TEST Dashboard, and **A6 verified** (event-ID header presence and stability across a deliberately failed delivery) ([IB-20](../../implementation/open-decisions.md#ib-20--a-public-test-webhook-endpoint)).

## Architectural components involved

`modules/billing/{policy,backend/sync,backend/webhooks,backend/reconciliation,backend/history,backend/anomalies}`; the tick route and `lib/internal-jobs` registry; the notification queue's **pattern** (claim with lease, `utc()` binding), not its port; Next.js `after()`.

## Dependencies

Phase III: the schema, the provider boundary, the budget, and mode.

## Files and modules likely affected

Paths are relative to `next/src/`.

- `modules/billing/policy/{state-mapping,next-due}.ts`.
- `modules/billing/backend/sync/{sync.service,apply,claim.repository}.ts`.
- `modules/billing/backend/webhooks/*`, `backend/history/*`, `backend/anomalies/*`, `backend/reconciliation/billing-sync.task.ts`.
- `app/api/v1/webhooks/razorpay/route.ts`, `app/api/v1/internal/billing/sync/route.ts`, `app/api/v1/internal/tick/route.ts` (registration order).
- `lib/rate-limit/policies.ts`: an inbound `billing:webhook` policy (by IP, generous, fail-open).
- `modules/notifications/config/notification-config.ts`: a lower default drain budget (IB-10).
- `docs/architecture/workflows/internal-jobs.md`: record the chosen budgets.

## Database and schema work

None beyond Phase III, except one enum value: `BillingAnomalyType.TERMINAL_STATE_CONTRADICTED`, in its own `ALTER TYPE … ADD VALUE` migration, for a terminal-out transition ([IB-24](../../implementation/open-decisions.md#ib-24--phase-iv-implementation-rulings)).

## Domain and application work

- **Mapping:** every Razorpay status × `kind` × `start_at` × clock; unknown → not applied (`MALFORMED`, alert only, [IB-17(d)](../../implementation/open-decisions.md#ib-17--stale-documents-and-leftovers)).
- **Apply:**
  - is **the** write path for provider state; commands (Phase V) reuse it;
  - never applies a transition out of a terminal phase (it raises an anomaly instead);
  - never clears `cancelAtPeriodEnd` because a field is absent;
  - raises `MULTIPLE_OPEN_SUBSCRIPTIONS` when a phase change leaves more than one open subscription for a user in one mode.
- **Payload status is never applied.** Webhooks only mark rows due or trigger a fetch (SB-WH-03).
- **Reconciliation is due-based, never a sweep** (SB-RC-05). The drain stops on the deadline, an empty claim, no budget, or cooldown.
- **Background processes never mutate provider state** (SB-RC-10).

## Provider work

- Fetch-based sync against TEST.
- Register the TEST webhook, subscribed to exactly the SB-WH-08 set.
- Verify A6, and record A3/A9 observations if they arise, in [Razorpay facts](../../provider-boundary/razorpay-facts.md).
- UPI cannot be exercised while it is disabled on TEST ([IB-18](../../implementation/open-decisions.md#ib-18--upi-disabled-on-the-razorpay-test-account)); the mapping is method-agnostic.

## Integration work

- Tick registration order and budgets (IB-10).
- The webhook route needs the raw body (`request.arrayBuffer()`), the Node runtime, and a bypass of Vercel deployment protection for this path only on the TEST deployment.

## Authorization and entitlement implications

- Applied phases change effective access immediately, through the resolver.
- Admin "sync now" requires `VIEW_BILLING`.
- The webhook route is unauthenticated by session, and its only authenticity check is the HMAC signature. It is scoped to the mode's own secrets.

## Concurrency and transaction considerations

- The apply takes `SELECT … FOR UPDATE` on the subscription row and compares `observationAt` with `lastAppliedObservationAt`, applying only strictly newer observations.
- `syncRequestedAt` closes the gap between a webhook and a fetch already in flight.
- Claims are exclusive (`SKIP LOCKED` + lease). A lapsed lease is reclaimable.
- The webhook's single transaction must finish well inside Razorpay's 5 s limit. No provider call happens before the response.
- Raw SQL follows the documented hazards: enum casts, `utc()` binding, an explicit `updatedAt`.

## Observability requirements

- Events: `webhook.*`, `sync.*`, `anomaly.raised|resolved`, `budget.*`, `cooldown.*`.
- `billing.alert` for: `AUTH_FAILURE`, signature failures above baseline, a signed non-JSON body, `WEBHOOK_SILENCE`, 429/`BUDGET_EXHAUSTED`, `SYNC_OVERDUE`, anomalies, and a terminal-out transition.
- The tick returns counts (claimed, applied, stale-discarded, failed by class, remaining due).

## Testing requirements

**Unit:** the mapping table; `nextDue` for every phase, including decay and the cancel checkpoint; signature variants.

**Integration** (fake provider):
- two fetches applied in reverse order → the older one is discarded;
- a webhook during an in-flight fetch → another fetch is due;
- a burst of webhooks → one fetch;
- claim exclusivity, and reclaiming an expired lease;
- a terminal-out transition → anomaly;
- webhook: signature checked before any write; duplicate delivery; unmatched events bound through notes; unmatched without notes → anomaly; money-fact dedupe; unsupported type; non-JSON; a DB failure → 500 with no row;
- reconciliation: stops at the deadline, on an empty claim and with no budget; cooldown skips P2–P4 but allows P1;
- TEST/LIVE isolation in sync.

**Provider-TEST:** webhook delivery against the registered TEST endpoint, including a deliberately failed delivery (A6).

## Acceptance criteria

- [x] A state change made in the Razorpay TEST Dashboard reaches the correct Kizunia phase by webhook, and by the tick when the webhook is withheld. *(A cancel at Razorpay, which is what a Dashboard cancel produces, arrived as `subscription.cancelled` and applied by webhook; the same change with the endpoint stopped was applied by a `billing:sync` run. Other state changes were tested with the fake only, see [Open items](#open-items).)*
- [x] Out-of-order, duplicate and delayed webhooks never regress state. *(Tests: an older fetch answering after a newer one is discarded; a concurrent pair keeps the newer. Real: six attempts and a replay recorded once.)*
- [x] Every applied change has a history entry with the correct cause and trigger.
- [x] No webhook is acknowledged without being recorded, and none is dropped for being unmatched. *(A failed recording transaction is a 500 with no row; unmatched events are kept and bound or flagged.)*
- [x] `billing:sync` respects its budget, and notifications still finish within the tick's `maxDuration`. *(By configuration and a test pinning the arithmetic: 10 s + one 10 s provider timeout + 30 s. **Not yet measured under realistic notification load**, see [Open items](#open-items).)*
- [x] A6 is verified and recorded (or its fallback is confirmed necessary). *(Verified for `subscription.cancelled`; the body-hash fallback stays for the other types.)*
- [x] With billing `disabled`, the webhook fails closed and the tasks report `skipped`.

## Explicit non-goals

- Creating or mutating subscriptions (Phases V–VI).
- Orphan discovery (Phase V, together with creation).
- Payload pruning and admin UI beyond "sync now" (Phase VIII).
- Choosing the alert delivery channel (Phase IX).

## Decisions that must already be settled

IB-9 (the mapping rule), IB-10, IB-11 (log-only for now), IB-17(d), IB-20, SB-WH-01…08, SB-RC-03…10. **All are DECIDED**, or IMPLEMENTATION-TIME for values (C2–C4).

## Risks and blockers

- **Blocker for verification (not for code):** a stable public TEST webhook URL (IB-20).
- **Risk:** the tick time budget. Measure it with realistic notification load.
- **Risk:** raw-SQL hazards in the claim. Mirror `postgres-work-queue.ts` and test it with real Postgres.
- **Risk:** the Hobby plan's daily cron makes the tick a slow backstop in TEST. Use the manual route; the LIVE cadence is decided in Phase IX ([IB-19](../../implementation/open-decisions.md#ib-19--tick-cadence-on-the-vercel-hobby-plan)).

## Expected output

The mapping and `nextDue` policies; `SyncService` with guarded apply; anomalies and history; the `billing:sync` task and manual route; the webhook route and service; admin sync-now; `billing.alert` events; the registered TEST webhook; the A6 record; tests.

## Implementation record

Implemented 2026-09-25 on `feat/suscription`, in 26 commits (listed at the end). Every [acceptance criterion](#acceptance-criteria) is met. Paths are relative to `next/src/`.

**What was built**

- **Rulings** ([IB-23](../../implementation/open-decisions.md#ib-23--detecting-a-missing-provider-subscription), [IB-24](../../implementation/open-decisions.md#ib-24--phase-iv-implementation-rulings)), recorded before the code relied on them. The one Phase III left open: **a missing provider subscription is detected by operation context**. In the sync fetch path only, a `fetchSubscription` of a stored ID failing `REJECTED` or `NOT_FOUND` raises `PROVIDER_SUBSCRIPTION_MISSING`; classification is unchanged and no description text is read; the anomaly resolves itself on a later success. `PROVIDER_MODE_MISMATCH` is detected locally, never from a failure.
- **Pure policies** (`modules/billing/policy/`): `state-mapping` (including the IB-9 trial rule), `next-due` (checkpoints, heartbeats, `HALTED` decay), `sync-failure`, `observation-validation`, `scheduled-change`, `operation-settlement`.
- **Provider boundary:** `parseWebhookEvent` and the event catalog (`provider/razorpay/webhook-events.ts`); `getProviderAccountId()`, `getProviderHealth()`. The fake now answers an unknown ID as Razorpay does, builds Razorpay-shaped events and supports a previous secret.
- **Sync** (`backend/sync/`): `claim.repository` (mark-due, `SKIP LOCKED` claims, leases), `apply` (the one write path), `sync-failure.repository`, `sync.service` (targeted sync and the drain), plus `backend/history/`, `backend/anomalies/` and `backend/sql.ts`.
- **Reconciliation:** the `billing:sync` task (first in the tick, via `app/api/v1/internal/tick/tasks.ts`) and `GET /api/v1/internal/billing/sync`.
- **Webhooks** (`backend/webhooks/`, `app/api/v1/webhooks/razorpay/route.ts`): the service, the controller, and the unmatched-event resolver, also run from the tick.
- **Admin "sync now":** `POST /api/v1/admin/billing/subscriptions/{id}/sync` (`VIEW_BILLING`).
- **Tools:** `pnpm billing:test-plans` (the four TEST plans, with the owner's temporary TEST-only prices) and `pnpm billing:webhook-verify`.
- **Schema:** one enum value, `BillingAnomalyType.TERMINAL_STATE_CONTRADICTED`, in its own migration.
- **Configuration:** C3, C4, C7 and the alert thresholds ([configuration](../../implementation/configuration.md#tuning-values-chosen-in-phase-iv)); the notification drain default lowered from 45 s to 30 s.

**Implementation decisions** (Phase IV choices, not changes to settled decisions)

- **The webhook response is only `{received}`** and the follow-up is scheduled through a parameter (`after` in the route), so tests run it synchronously.
- **Fetch failures never move phase, plan or access;** a call refused before sending (budget, cooldown, auth pin) leaves the row due exactly as it was, counts no attempt and stops the batch.
- **Alerts fire when an anomaly opens**, not on every repeat; logs and alerts are emitted after the transaction commits, so a rolled-back one reports nothing.
- **`matchedSecret` is logged as `signedWith`,** because the shared logger redacts any field whose name contains `secret` (found in the real run).
- **`HALTED` entry time** comes from the latest `PHASE` history entry, so no column was added.
- **The `after()` and admin paths use the same `SyncService`,** so they claim, fetch and apply identically to the tick.

**Deviations from the documentation**

- **`billing:sync` also resolves `UNMATCHED_PENDING` events** (IB-24 item 4). The design left events that `after()` did not reach with nothing to drain them, since they are not subscription rows.
- **An event for a terminal subscription is linked and not marked due** (IB-24 item 5), because the database forbids a due terminal row.
- **`TERMINAL_STATE_CONTRADICTED` is a new anomaly type** (IB-24 item 1); `TRIAL_CONVERSION_OVERDUE` is an alert only until Phase VII adds its enum value (IB-24 item 8).
- **The tick's tasks moved to `tick/tasks.ts`,** so the order can be tested; a route file may not export them.

**Verification**

- **Unit tests:** 1,110 before Phase IV's first commit, 1,232 after (the whole suite passes). **Integration tests:** 553 before, 660 after, with the same single failure as before (`delivery.integration.test.ts` › "skips a push that is no longer worth sending").
- **Mutation checks,** each of which made the intended tests fail and was then reverted: the stale-apply guard, the `syncRequestedAt` rule, and verifying the signature before recording.
- `tsc` is clean and `next build` succeeds, with the three new routes. `eslint` reports no error in any file this phase touched; the errors that remain are in generated Prisma runtime files and the files earlier phases recorded.
- **Against Razorpay TEST (2026-09-25):** see [the run](../../provider-boundary/razorpay-facts.md#phase-iv-webhook-run-2026-09-25). A cancel at Razorpay arrived as a signed `subscription.cancelled` and bound the unmatched subscription through its notes; with the endpoint stopped, the same kind of change was applied by the tick; the event was attempted six times with one `x-razorpay-event-id` and recorded once; a replay was a duplicate. No alert and no error was logged.

**Known issues, not caused by this phase**

- `delivery.integration.test.ts` › "skips a push that is no longer worth sending" still fails on a clean checkout.
- `eslint` still reports errors in `app/api/auth/[...all]/route.test.ts`, `authorization/platform/context.ts` and `components/ui/vortex.tsx`, and in the generated Prisma client.

**An incident during this phase, recorded for honesty.** For part of the phase the integration setup loaded the developer's `.env`, which now held real Razorpay TEST credentials, so one integration test that fell back to the default provider sent a real, **read-only** request (a fetch of a fake, malformed subscription ID, answered by the gateway's 404). Nothing was created or changed at Razorpay. It was fixed by blanking `RAZORPAY_*` in the integration setup, with a test that pins it.

### Open items

- **Every real event other than `subscription.cancelled`,** and money facts from a real payload, were not exercised against Razorpay TEST: authenticating a checkout needs the customer flow (Phase V). Their parsing follows Razorpay's documented sample payloads and is unit-tested.
- **The tick budget has not been measured under realistic notification load** (this document's own risk). It is bounded by configuration (10 s + one provider timeout + 30 s of 60 s) and pinned by a test, and should be measured before LIVE.
- **The ngrok URL used for the run is temporary.** A free ngrok URL that is not a reserved static domain changes when ngrok restarts; a stable hosted URL is needed before a hosted TEST or LIVE deployment (IB-20).
- **`CANCELLATION_NOT_EFFECTIVE` (I-4)** and the anomaly-resolution tools are Phases VI and VIII.
- **UPI** cannot be exercised while it is disabled on TEST ([IB-18](../../implementation/open-decisions.md#ib-18--upi-disabled-on-the-razorpay-test-account)); the mapping is method-agnostic.
- **The TEST plan prices are temporary** and not Kizunia's pricing (B6, a LIVE blocker).

**For Phase V.** `applyObservation` is the write path to reuse for a command response and a checkout confirmation (`ApplyContext.trigger`). Phase V writes `BillingOperation.request` as `{ plan, cycle }` for a plan change (`UpdatePlanRequestSchema`) and sets `notes` (`kz_sub`, `kz_op`, `kz_env`) on every create, since the unmatched resolver binds a lost create by them. The TEST catalog already has the four plans. `SyncService.syncTargeted(id, ProviderPriority.CONFIRMATION, { trigger: "CHECKOUT_CONFIRM" })` is the checkout-confirmation sync.

**Commits**

Run `git log --oneline 2454400..HEAD` for the full list. In order: the rulings; the fake provider; the mapping and next-due policies; the four remaining policies; the webhook catalog; the anomaly enum; history and anomaly repositories; the claim repository; the apply path; `SyncService`; the `billing:sync` task and route; webhook recording; the webhook route; unmatched resolution; admin sync-now; the TEST plan tool and catalog; the verification script; the configuration and operations documents; and this record. Four small fix commits sit beside them (the integration-test provider guard, a log field name, and two test corrections).
