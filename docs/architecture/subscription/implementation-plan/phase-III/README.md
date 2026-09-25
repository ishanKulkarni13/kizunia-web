# Phase III — Billing Persistence, Mode and Provider Boundary

> **Status:** Implemented 2026-09-25. Every acceptance criterion is met. The contract suite passed against Razorpay TEST and found that an unknown ID is not a `404` as the design assumed; that is routed to Phase IV as a decision (see [Open items](#open-items)).
>
> **Depends on:** Phase I · **Razorpay needed:** TEST keys, for an opt-in contract check only · **Old slices:** S4, S5

## Objective

Lay down everything billing stores, and the single narrow gateway to Razorpay, before any lifecycle behavior exists. After this phase:

- the billing schema exists;
- the deployment knows at boot which provider mode it is in and whether that is allowed;
- every outbound Razorpay call is budgeted, classified and replaceable by a fake;
- effective access also counts contributing subscriptions in the expected mode.

## Scope

- The complete billing schema ([database design](../../implementation/database-design.md); [persistence boundary](../README.md#persistence-boundary)).
- **Mode resolution and validation at boot** in `src/instrumentation.ts` `register()` ([IB-13](../../implementation/open-decisions.md#ib-13--boot-time-mode-validation-and-expected-mode)):
  - `disabled` / `test` / `live` from the credentials;
  - the expected mode from `BILLING_EXPECTED_MODE`, else `VERCEL_ENV`;
  - fail fast on a mismatch.
- **Configuration:**
  - `modules/billing/config/billing-config.ts` (the `envInt` tuning pattern);
  - the per-mode plan catalog (many provider plan IDs map to one Kizunia plan and cycle; retired IDs are kept);
  - an Offer-catalog stub (filled in Phase VII);
  - `.env.example` documents every billing variable (IB-17(e)).
- **The provider boundary** ([provider boundary](../../implementation/provider-boundary.md)):
  - the `BillingProvider` interface and a Kizunia-defined `ProviderSubscriptionState`;
  - a `fetch`-based Razorpay client (no SDK);
  - the failure taxonomy and classification;
  - checkout and webhook signature helpers using constant-time compare;
  - a **fake provider** that can produce every failure class on demand;
  - the `BudgetedProvider` decorator (budget, cooldown, `observationAt` = send time).
- **The outbound request budget:** `incrementIfBelow` on the rate-limit store port (Postgres and in-memory), plus the `BillingProviderState` cooldown and auth-failure pin.
- **The ESLint boundary:** `no-restricted-imports` rules for the forbidden dependencies in [architecture fit](../../implementation/architecture-fit.md#forbidden-dependencies-enforce-with-an-eslint-no-restricted-imports-rule-in-s5).
- **Resolver extension:** contributing phases (`TRIALING`, `ACTIVE`, `PAST_DUE`) whose `providerMode` equals the expected mode now contribute their plan (SB-EA-06/07).
- **Hygiene:** delete the unused Stripe-shaped `interface Subscription` in `types/auth-types.ts` (IB-17(c)).

## Architectural components involved

`modules/billing/provider/**` (the only place that knows Razorpay); `modules/billing/config`; `lib/rate-limit` store port; `lib/entitlements` (the resolver reads `subscription`); `src/instrumentation.ts`; `eslint.config.mjs`.

## Dependencies

Phase I: the plan enum and the resolver structure. Phase II is **not** required.

## Files and modules likely affected

Paths are relative to `next/src/` unless noted.

- `prisma/schema.prisma` and migrations, with `-- CustomIndex` / `-- CustomCheck` blocks for the partial unique indexes and CHECKs.
- `instrumentation.ts` (new).
- `modules/billing/provider/{types,fake-provider,budgeted-provider,provider-mode}.ts` and `modules/billing/provider/razorpay/{razorpay-client,razorpay-provider,mapping,signatures}.ts`.
- `modules/billing/backend/budget/*`.
- `modules/billing/config/{billing-config,plan-catalog,offer-catalog}.ts`.
- `lib/rate-limit/{store,postgres.store,memory.store}.ts`: an additive `incrementIfBelow`.
- `lib/entitlements/*`: read subscriptions.
- `types/auth-types.ts`: remove the dead interface.
- `next/.env.example`, `next/eslint.config.mjs`.

## Database and schema work

Creates the enums and models listed for Phase III in the [persistence boundary](../README.md#persistence-boundary), exactly as specified in [database design](../../implementation/database-design.md). Critical constraints:

- unique `(providerMode, providerSubscriptionId)`: a subscription is bound once (SB-UQ-01);
- partial unique `billing_operation(userId) WHERE status = 'IN_FLIGHT' AND "parentOperationId" IS NULL`: the **root-only** in-flight slot ([IB-6](../../implementation/open-decisions.md#ib-6--composed-commands-and-the-in-flight-constraint));
- unique `(userId, idempotencyKey)` on `billing_operation`;
- unique `(provider, dedupeKey)` on `billing_event`, and `(providerMode, kind, providerObjectId)` on money facts;
- partial `(providerMode, syncDueAt) WHERE "syncDueAt" IS NOT NULL` for the claim;
- partial unique open anomaly `(type, "subjectKey") WHERE "resolvedAt" IS NULL`;
- every user reference: nullable `userId`, `onDelete: Restrict`, plus `subjectPseudonym` (IB-14); actor columns are plain strings;
- no constraint on the *number* of open subscriptions: SB-UQ-02 is a creation rule, enforced in Phase V.

Phase I tables are not altered, apart from Prisma back-relations.

## Domain and application work

- **Mode:** resolved once and memoized. `isBillingProviderEnabled()` is the only runtime question. `disabled` is a supported production state: checkout and commands return `503 BILLING_UNAVAILABLE`, while Free, grants and gates keep working.
- **Classification:** status and code only, never description text, with the single documented exception (`CONCURRENT_OPERATION`, falling back to `REJECTED`).
- **Budget:** priority classes P1–P4 with headroom (configuration C1). A 429 enters a jittered global cooldown (C2). `AUTH_FAILURE` pins the cooldown until the key fingerprint changes.
- **Resolver:** subscriptions contribute only in contributing phases and the expected mode. A `TEST` row never contributes in a `LIVE`-expected deployment.

## Provider work

- A Razorpay `fetch` client with Basic auth, a bounded timeout and epoch→`Date` conversion. Undocumented fields (`payment_method`, `halted_at`) are read defensively (D3).
- An **opt-in provider-TEST contract suite**, never in CI by default: create, fetch, immediate cancel in each state, cycle-end cancel on `active`, update refusals classified `REJECTED`, list-window inclusivity, and `expire_by` lag. Anything new that is observed goes into [Razorpay facts](../../provider-boundary/razorpay-facts.md).

## Integration work

- Resolver integration with Phase I.
- Nothing user-visible yet, apart from the disabled-mode `503` contract being ready.

## Authorization and entitlement implications

- Subscriptions become an entitlement source, beside grants. The maximum over all sources wins (SB-EA-02/03/06).
- Razorpay identifiers never leave `modules/billing` (SB-PB-04). The ESLint rule enforces this.

## Concurrency and transaction considerations

- `incrementIfBelow` is one atomic statement (`INSERT … ON CONFLICT DO UPDATE … WHERE count < ceiling RETURNING`); no row returned means refused.
- No provider call may happen inside a transaction. The boundary's API makes that easy to review: calls are plain async functions, never passed a transaction client.

## Observability requirements

- `budget.acquired|refused` and `cooldown.entered|left` events.
- A mode-resolution log line at boot, giving the mode but never the keys.
- `billing.alert` for `AUTH_FAILURE` and mode mismatches that do not stop boot.

## Testing requirements

**Unit:**
- mode resolution (disabled / partial / mismatched prefix / expected-mode mismatch);
- classification for every HTTP status and code;
- signatures (valid, invalid, previous secret, expired previous; checkout signature uses the server-held ID);
- backoff and cooldown math (jitter bounds);
- the resolver with subscriptions (max across sources; mode filter).

**Integration:**
- migrations apply to an empty database;
- the `IN_FLIGHT` root index rejects a second root and accepts a child;
- `incrementIfBelow` under concurrency;
- **TEST/LIVE isolation:** a `TEST` row contributes nothing when `LIVE` is expected;
- a hard delete of a user with billing rows is refused.

**Provider-TEST:** the opt-in contract suite.

## Acceptance criteria

- [x] The app boots with no billing configuration (`disabled`), and Free, grants and gates keep working.
- [x] A misconfigured deployment (partial credentials, an unrecognized key prefix, or a mode differing from the expected mode) fails at boot with a clear message.
- [x] Every Razorpay call goes through `BudgetedProvider`. The fake can produce every failure class. The ESLint rule rejects Razorpay imports outside the provider directory.
- [x] The schema matches database design, including the partial indexes and CHECKs, and the migrations follow repository conventions (`ALTER TYPE` in its own migration; this phase adds no enum value to an existing type, so needs none).
- [x] The resolver counts only contributing subscriptions in the expected mode.
- [x] The contract suite passed at least once against TEST, and its results are recorded. It ran on 2026-09-25 against a `rzp_test_` key: 16 tests passed, 11 were skipped by design, and every subscription it created was cancelled. The results are in [Razorpay facts](../../provider-boundary/razorpay-facts.md#phase-iii-contract-suite-2026-09-25).

## Explicit non-goals

- Sync, apply, webhooks (Phase IV).
- Commands and checkout (Phase V).
- Refunds, pause/resume, Offer linking after creation, reading invoices (never in V1).

## Decisions that must already be settled

IB-6, IB-13, IB-14, IB-17, SB-PB-01…06, SB-RC-06/07. **All are DECIDED.** Configuration values C1 and C2 are IMPLEMENTATION-TIME.

## Risks and blockers

- **Risk:** partial indexes and enum additions via raw SQL. Follow the existing `-- CustomIndex` convention and test that the migration applies.
- **Risk:** classification mistakes. The contract suite and the table-driven unit tests cover them.
- **Blockers:** none. UPI being disabled on TEST limits the contract suite to cards and e-mandate. That is recorded, not blocking.

## Expected output

The billing schema and migrations; `instrumentation.ts` mode validation; configuration and catalogs; the provider interface, Razorpay client, fake and budget decorator; the store extension; ESLint boundary rules; the resolver reading subscriptions; the dead interface removed; tests and the contract-suite record.

## Implementation record

Implemented 2026-09-25 on `feat/suscription`, in 16 commits (listed at the end). Every [acceptance criterion](#acceptance-criteria) is met and covered by a test, and the contract suite has run against Razorpay TEST. Paths are relative to `next/src/`.

**What was built**

- **Schema** (`prisma/schema.prisma`, migration `20260925000000_add_billing_persistence`):
  - the 16 enums and 7 models exactly as [database design](../../implementation/database-design.md) specifies, with `User` back-relations only;
  - four hand-written partial indexes: the root-only `IN_FLIGHT` slot on `billing_operation(userId)` (IB-6), the sync-claim index, the open-anomaly slot, and the payload-pruning index;
  - four CHECKs: `syncAttempts >= 0`, a terminal phase is never sync-due, and the closed value sets of `dedupeSource` and `matchedSecret`;
  - every user reference is a nullable `userId` with `onDelete: Restrict`, plus `subjectPseudonym`.
- **Mode and boot:**
  - `modules/billing/provider/provider-mode.ts` resolves `DISABLED` / `TEST` / `LIVE` from the credentials, memoizes it, and validates it in `instrumentation.ts` `register()`.
  - The expected mode is `lib/entitlements/billing-mode.ts`.
  - `assertBillingProviderEnabled()` raises `503 BILLING_UNAVAILABLE` (`BillingUnavailableError`).
  - `.env.example` documents every billing variable.
- **Configuration** (`modules/billing/config`): `billing-config.ts` (the C1 and C2 values, with reasons), `plan-catalog.ts` and an `offer-catalog.ts` stub. Both catalogs ship empty (see [Open items](#open-items)).
- **Provider boundary** (`modules/billing/provider`):
  - `types.ts` (the `BillingProvider` interface, `Outcome`, `ProviderSubscriptionState`);
  - `razorpay/{razorpay-client,razorpay-provider,mapping,classification,signatures}.ts`;
  - `fake-provider.ts`, `disabled-provider.ts`, `budgeted-provider.ts` and the composition root `provider-factory.ts`.
- **Request budget** (`lib/rate-limit`, `backend/budget`, `policy`):
  - `incrementIfBelow` on the store port, atomic in Postgres;
  - `ProviderBudget`, `CooldownRepository` and `ProviderHealthTracker`;
  - the pure `policy/{backoff,budget-ceilings,cooldown}.ts`.
- **Resolver** (`lib/entitlements`): `subscription-contribution.ts` (the pure rule) and `subscription-predicate.ts` (the Prisma filter), read by `resolver.ts`, `entitledUsersWhere` and `explain.ts`.
- **ESLint boundary** (`eslint.config.mjs`), proven by `modules/billing/eslint-boundaries.test.ts`.
- **Hygiene:** the Stripe-shaped `interface Subscription` in `types/auth-types.ts` is removed (IB-17(c)).
- **Contract suite:** `razorpay-provider.contract.test.ts`, `vitest.contract.config.mts` and `pnpm test:contract`.

**Implementation decisions** (each a Phase III choice, not a change to a settled decision)

- **The expected mode lives in `lib/entitlements`, not in billing.** The resolver must know it, and the read side never imports billing. The resolved (credential) mode stays in `provider-mode.ts`. Boot requires resolved = expected, or resolved = `DISABLED`.
- **`getBillingProvider(priority)` lives in `provider/provider-factory.ts`, not `provider-mode.ts`.** It is the one caller of the Razorpay implementation, so the ESLint rule forbidding `provider/razorpay/**` imports from outside `provider/` requires it to sit inside `provider/`. The budget and cooldown adapters stay in `backend/budget/` and reach the decorator through two small ports (`ProviderBudgetGate`, `ProviderHealth`), so `BudgetedProvider` touches no database.
- **A provider is obtained per priority** (`getBillingProvider(ProviderPriority.COMMAND)`), not by passing a priority to every call. The `BillingProvider` interface stays free of it, and the fake is unaffected.
- **`Outcome` has a third variant, `PROVIDER_DISABLED`**, for disabled mode, and a failure carries `requestSentAt` exactly when a request left the process. That is what makes a mutation's outcome *unknown* rather than plainly not applied. `BUDGET_EXHAUSTED` and `UNMAPPED_PLAN` never carry it.
- **`observationAt` is stamped by the implementation at send time** (the Razorpay client, the fake), and the decorator passes it through. The design words this as the decorator recording it; the effect is the same (the send time, never the response time) and it is stamped in one place. A test advances the clock during the request to prove it.
- **Cooldown semantics.** Refined where the design left room:
  - a definite answer (a refusal, a not-found, a concurrent-operation reply) counts as the provider being healthy;
  - a `MALFORMED` body says nothing either way;
  - a success *during* a cooldown does not end it, so priorities 2–4 stay off until it has run its course;
  - the level decays by one per healthy result once it is over;
  - a running cooldown never moves earlier.
- **"K consecutive 5xx/timeouts within a short window" is "K in a row, with no success between".** The `billing_provider_state` row has no per-failure timestamp to bound a window with, and a run with no success between is short in any live system.
- **A call refused for cooldown is `BUDGET_EXHAUSTED`**, since it is, in effect, a zero budget and the taxonomy has no cooldown class. A call refused because the key is pinned is `AUTH_FAILURE`, with no `requestSentAt`.
- **Store failures never cost a result.** An unreadable budget fails closed (nothing is sent without a unit). An unreadable cooldown verdict proceeds to the budget check, which uses the same store. A failure to record an outcome is logged and the outcome returned, because a mutation that reached the provider must not become an exception.
- **The cooldown row is updated by compare-and-set on `updatedAt`**, so two instances reacting to one outage cannot overwrite each other with a stale result.
- **The auth pin stores a fingerprint** (a truncated SHA-256) of the key ID, so a key is never written to a table or log and rotating it un-pins the deployment with no SQL.
- **Configuration rules the docs left open:**
  - `RAZORPAY_ACCOUNT_ID` is required once credentials are set;
  - `RAZORPAY_WEBHOOK_SECRET_PREVIOUS_UNTIL` without a previous secret, or an unparseable one, is a boot error;
  - a previous secret with no `_UNTIL` is accepted until it is removed (as the runbook's procedure removes it);
  - the boot hook is skipped during `next build`, since validation belongs to a server about to serve requests.
- **`mapping.ts` is wire-shape translation only.** It renames fields, converts epoch seconds to `Date` and validates the entity. The provider status is carried through as `rawStatus`, and there is no status-to-phase mapping, trial rule, catalog resolution or `notes` comparison: those are Phase IV's apply path. `change_scheduled_at` is read only when it is a timestamp, because the documentation gives two different types. `ProviderSubscriptionState` also carries `endedAt` and `shortUrl`, which the stored columns and the create response need.
- **Classification of the cases the design does not enumerate:** 408 is `TIMEOUT`, every other 4xx is `REJECTED`, and 1xx/3xx is `MALFORMED`. The `CONCURRENT_OPERATION` text match is tolerant (its exact wording has never been observed), and a miss degrades to `REJECTED`, the fallback the design names.
- **`entitledUsersWhere` now returns a top-level `OR`.** It may be spread beside unrelated keys (both existing callers do), but must be composed with `AND` beside another `OR`. The function says so.
- **The plan and Offer catalogs ship empty**, since inventing plan IDs would be fabricating data. `createPlanCatalog` enforces the invariants (a provider plan ID appears once, and at most one current plan per plan and cycle), so it is fully tested with fixtures.
- **Shared test fixtures gain subscription cases**, and `deleteGrantsForUsers` also removes subscriptions, so the existing suites that call it stay correct without a change at each call site.

**Deviations from the documentation**

- `getBillingProvider()` is in `provider/provider-factory.ts`, not `provider-mode.ts` (see above).
- `parseWebhookEvent` is **not yet on the `BillingProvider` interface.** It needs the webhook event catalog, which belongs to Phase IV; [Phase IV](../phase-IV/README.md) adds it with webhook ingestion. Signature verification, which Phase III lists, is present.
- The per-priority ceilings, backoff and cooldown values are the [configuration](../../implementation/configuration.md#tuning-values-chosen-in-phase-iii) defaults, chosen conservatively because Razorpay publishes no limits (A12).
- Two files not in the list above exist because the design needed them: `razorpay/classification.ts` and `provider/disabled-provider.ts`.
- **A design assumption was wrong, found by the contract suite.** The design classified an unknown ID as `404` `NOT_FOUND`. Razorpay answers a well-formed unknown subscription or payment ID with `400 BAD_REQUEST_ERROR` (`REJECTED`), and a `404` only for a malformed ID (D12 in [Razorpay facts](../../provider-boundary/razorpay-facts.md#documentation-vs-observed-behavior)). The classification code needed no change, since it follows the designed rule, status and code only; what the finding changes is what Phase IV can key missing-subscription detection on.

### Open items

- **A decision for Phase IV: how a missing provider subscription is detected.** Because a real unknown ID is a `REJECTED` `400`, `PROVIDER_SUBSCRIPTION_MISSING` and `PROVIDER_MODE_MISMATCH` cannot be keyed on the `NOT_FOUND` class. The two options are **operation context** (a `fetchSubscription` of an ID Kizunia stored can be refused only because the ID is unknown, since a GET has no other business refusal, so no description text is matched) and a second documented description-match exception, like `CONCURRENT_OPERATION`. Phase IV must rule and record it before the apply path depends on either. Nothing in Phase III does.
- **Not exercised by the suite, and still open in [Razorpay facts](../../provider-boundary/razorpay-facts.md#phase-iii-contract-suite-2026-09-25):**
  - every state a customer must authenticate to reach (`authenticated`, `active`, `pending`, `halted`, `paused`). The suite covers them only against subscriptions supplied by ID (`RAZORPAY_CONTRACT_<STATE>_SUBSCRIPTION_ID`), and none were supplied;
  - cycle-end cancellation on an `active` subscription, a native plan change, and the type of `change_scheduled_at` once a change is scheduled;
  - UPI, which is unavailable on TEST ([IB-18](../../implementation/open-decisions.md#ib-18--upi-disabled-on-the-razorpay-test-account)), and every webhook behavior (Phase IV).
- **The plan and Offer catalogs are empty.** Phase V needs TEST plan IDs to start a checkout, and LIVE plans wait for pricing (B6, a LIVE blocker).
- **The local `.env` has only `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.** That is a partial credential set, so `pnpm dev` now stops at boot with a message naming `RAZORPAY_WEBHOOK_SECRET`, as designed. Add that and `RAZORPAY_ACCOUNT_ID`, or clear both, to run the app.

**Verification**

- New test files (unit unless noted):
  - schema (integration), `incrementIfBelow` (unit and integration);
  - `billing-mode`, `provider-mode`, `plan-catalog`;
  - `classification`, `signatures`, `mapping`, `razorpay-provider`, `fake-provider`, `budgeted-provider`;
  - `backoff`, `budget-ceilings`, `cooldown`;
  - budget, health and factory (integration);
  - `subscription-contribution` (unit) and `subscription-resolver` (integration);
  - `eslint-boundaries`.
- Extended tests: the resolver and notification-scheduler agreement tests (now on subscription fixtures), `feature-boundaries`, and the store tests.
- Unit tests: 771 before, 1,110 after. Integration tests: 464 before, 553 after, with the same single failure as before.
- Mutation checks, each of which made the intended tests fail and was then reverted:
  - the atomic ceiling and the compare-and-set guard;
  - the send-time stamp and the never-match-description rule;
  - the resolver's mode filter and the set form's subscription branch;
  - the ESLint zones (four separate rules switched off).
- **The contract suite against Razorpay TEST:** 16 passed and 11 were skipped by design (the ten supplied-state tests and the slow `expire_by` check, recorded separately). Its first run failed two tests, which is how it found the unknown-ID behavior above and showed that two of its own tests used a wrong-length ID (a gateway routing miss, so they did not reach a lookup). Both were corrected to a well-formed ID and to assert the observed behavior, and the observed bodies are pinned as classification unit-test fixtures so the knowledge needs no network.
- The suite's own mechanics (sequencing, assertions, cleanup, report, and reporting a divergence) were also checked against a throwaway local stand-in, before valid keys were available. That proved the suite works, not anything about Razorpay: a stand-in run is labelled `isRealRazorpay: false` in the report and is never recorded as an observation.
- `tsc` is clean, and `next build` succeeds. `eslint` over `src` reports the same 32 errors in the same three unrelated files as before this phase, and none from it.
- A real dev-server start with the incomplete local credentials stops with the configuration error, and with no billing variables it boots, logs `mode.resolved`, and serves.

**Known issues, not caused by this phase**

- `delivery.integration.test.ts` › "skips a push that is no longer worth sending" still fails on a clean checkout (the Phase I and II records note it).
- `eslint` still reports the errors in `app/api/auth/[...all]/route.test.ts`, `authorization/platform/context.ts` and `components/ui/vortex.tsx`, which this phase does not touch.

**For Phase IV.** The provider boundary, schema, budget and resolver are ready. Add `parseWebhookEvent` and the event catalog to the boundary, the state mapping and `nextDue` as pure policy, and the sync apply path. First rule on how a missing provider subscription is detected (see [Open items](#open-items)), since the contract suite showed it cannot be the `NOT_FOUND` class.

**Commits**

`a6daff9` schema · `1e4d47e` `incrementIfBelow` · `63f4445` mode and configuration · `38c8028` catalogs · `b87bfc3` provider contract and fake · `b613ece` Razorpay client and provider · `c9a3157` policy · `343f120` `BudgetedProvider` · `ba4be2d` budget wiring and factory · `94d933f` resolver · `7775a75` ESLint boundary · `071803a` dead interface · `15abb71` contract suite · `d02eb00` the first record of this phase · `b533bb6` the contract tests pinned to observed behavior · and the commit that records the contract results.
