# Phase III — Billing Persistence, Mode and Provider Boundary

> **Status:** Not started
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

- [ ] The app boots with no billing configuration (`disabled`), and Free, grants and gates keep working.
- [ ] A misconfigured deployment (partial credentials, an unrecognized key prefix, or a mode differing from the expected mode) fails at boot with a clear message.
- [ ] Every Razorpay call goes through `BudgetedProvider`. The fake can produce every failure class. The ESLint rule rejects Razorpay imports outside the provider directory.
- [ ] The schema matches database design, including the partial indexes and CHECKs, and the migrations follow repository conventions (`ALTER TYPE` in its own migration).
- [ ] The resolver counts only contributing subscriptions in the expected mode.
- [ ] The contract suite passed at least once against TEST, and its results are recorded.

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
