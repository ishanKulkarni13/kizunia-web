# Phase IV — Synchronization, Reconciliation and Webhooks

> **Status:** Not started
>
> **Depends on:** Phase III · **Razorpay needed:** TEST, plus a stable public webhook URL · **Old slices:** S6, S7

## Objective

Build the **one synchronization mechanism** that turns Razorpay's authoritative state into Kizunia's subscription phase, and the two things that trigger it outside commands: webhooks and due-based reconciliation. After this phase, any change made at Razorpay (Dashboard, customer, bank, renewal) is observed, applied in order and recorded, even when webhooks are late, duplicated, reordered or missing.

## Scope

- **The remaining provider-boundary piece:** `parseWebhookEvent` and the `ProviderWebhookEvent` catalog, deferred from Phase III because they need the event catalog ([webhooks](../../implementation/webhooks.md)). Phase III's `razorpay/mapping.ts` is wire-shape translation only; everything that turns a provider status into a Kizunia phase starts here.
- **How a missing provider subscription is detected: a decision to rule on first.** Phase III's contract suite observed that an unknown ID is a `400` (`REJECTED`), not the `404` (`NOT_FOUND`) the design assumed (D12 in [Razorpay facts](../../provider-boundary/razorpay-facts.md#documentation-vs-observed-behavior)). So `PROVIDER_SUBSCRIPTION_MISSING` and `PROVIDER_MODE_MISMATCH` cannot be keyed on the `NOT_FOUND` class. The options are **operation context** (a `fetchSubscription` of a stored ID can only be refused because the ID is unknown) or a second documented description-match exception. Rule on it, and record the ruling, before the apply path depends on either ([Phase III open items](../phase-III/README.md#open-items)).
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

None beyond Phase III. If a new `SyncReason`/`HistoryTrigger` value proves necessary, add it in its own `ALTER TYPE` migration and name it here.

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

- [ ] A state change made in the Razorpay TEST Dashboard reaches the correct Kizunia phase by webhook, and by the tick when the webhook is withheld.
- [ ] Out-of-order, duplicate and delayed webhooks never regress state.
- [ ] Every applied change has a history entry with the correct cause and trigger.
- [ ] No webhook is acknowledged without being recorded, and none is dropped for being unmatched.
- [ ] `billing:sync` respects its budget, and notifications still finish within the tick's `maxDuration`.
- [ ] A6 is verified and recorded (or its fallback is confirmed necessary).
- [ ] With billing `disabled`, the webhook fails closed and the tasks report `skipped`.

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
