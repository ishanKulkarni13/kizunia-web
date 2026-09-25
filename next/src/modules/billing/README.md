# Billing

## Purpose

The write side of Subscription & Billing. Billing owns every write to billing and entitlement tables.
The read side — "what may this user do?" — is `src/lib/entitlements`, which every feature consumes
and which never imports this module.

Razorpay is the billing provider, not the foundation of membership. Everything in this module works
with Razorpay never configured.

Architecture: [`docs/architecture/subscription/`](../../../../docs/architecture/subscription/README.md).
Roadmap: [`implementation-plan/`](../../../../docs/architecture/subscription/implementation-plan/README.md).

## Status

**Phase I — entitlement foundation and admin grants.** Implemented:

- admin entitlement grants: create, extend, revoke, with an append-only audit trail;
- `GET /api/v1/me/entitlements`;
- the admin grants page at `/admin/billing/grants`.

**Phase III — billing persistence, mode and provider boundary.** Implemented:

- the billing schema (subscriptions, operations, events, money facts, history, anomalies and
  provider state), with its partial indexes and CHECKs;
- provider mode resolved and validated at boot (`DISABLED`, `TEST` or `LIVE`), with `disabled` a
  supported state that answers `503 BILLING_UNAVAILABLE`;
- the provider boundary: the `BillingProvider` interface, a `fetch`-based Razorpay implementation,
  a fake, and the `BudgetedProvider` that owns the shared request budget, the global cooldown and
  the authentication pin;
- the per-mode plan catalog (empty until plans exist) and an Offer catalog stub;
- the resolver reading contributing subscriptions of the expected mode, beside grants.

Nothing calls the provider yet. Synchronization, webhooks, checkout and the subscription commands
arrive in Phases IV–VI, on top of this boundary.

## Responsibilities

| Area | Where |
| --- | --- |
| Grant rules: self-grant refusal, extension rules, final revocation | `backend/grants/grant.service.ts` |
| Grant persistence and row locking | `backend/grants/grant.repository.ts` |
| Grant DTOs; `state` derived at read time | `backend/grants/grant.dto.ts`, `grant.mapper.ts` |
| Billing authorization (`MANAGE_ENTITLEMENT_GRANTS`, `VIEW_BILLING`) | `backend/authorization/authorizer.ts` |
| Provider mode, resolved once at boot; `isBillingProviderEnabled()`; the `503` contract | `provider/provider-mode.ts`, `errors/billing-unavailable-error.ts` |
| The provider interface and its outcomes | `provider/types.ts` |
| Everything Razorpay (client, mapping, classification, signatures) | `provider/razorpay/` |
| Getting a provider, at a caller's priority | `provider/provider-factory.ts` |
| The request budget, cooldown and auth pin | `provider/budgeted-provider.ts`, `backend/budget/`, `policy/` |
| Plan and Offer catalogs; tuning values | `config/` |
| HTTP (admin grants; my entitlements) | `backend/admin.controller.ts`, `backend/controller.ts` |
| Request validation | `schemas/grant.ts` |
| Errors and error codes | `errors/` |
| Structured logging (`module: "billing"`) | `observability/log.ts` |
| Admin UI and API client | `frontend/components/grant-manager.tsx`, `api/grant-api.ts` |

## Folder structure

```text
billing/
├── README.md
├── index.ts              public, client-safe API (types and error codes)
├── api/                  HttpClient wrappers for the admin grant API
├── backend/
│   ├── authorization/    BillingAuthorizer
│   ├── budget/           request budget, cooldown repository, health tracker
│   ├── grants/           service, repository, mapper, DTOs
│   ├── admin.controller.ts
│   ├── controller.ts
│   └── entitlements.service.ts
├── config/               billing-config (tuning), plan-catalog, offer-catalog
├── errors/
├── frontend/components/
├── observability/
├── policy/               pure: backoff, budget ceilings, cooldown state machine
├── provider/             THE provider boundary; the only place that knows Razorpay
│   ├── razorpay/         client, provider, mapping, classification, signatures
│   ├── types.ts          BillingProvider, Outcome, ProviderSubscriptionState
│   ├── provider-mode.ts  mode resolution and boot validation
│   ├── provider-factory.ts   getBillingProvider(priority)
│   ├── budgeted-provider.ts  the decorator every real call goes through
│   ├── fake-provider.ts, disabled-provider.ts
└── schemas/
```

## Invariants

- **Grants are money-equivalent.** Only `SUPER_ADMIN` manages them (`MANAGE_ENTITLEMENT_GRANTS`).
  `ADMIN` can view them (`VIEW_BILLING`). The platform-role bypass (`platformOverride`) is never
  used here (IB-15).
- **No self-grants** (SB-EA-08). Refused by the service when creating *and* extending, and by a
  CHECK constraint.
- **A mandatory reason** on every create, extend and revoke. It is recorded in `grant_audit_entry`,
  in the same transaction as the change.
- **Expiry is derived, never written** (SB-EA-09). There is no expiry job. A grant contributes while
  `status = ACTIVE` and `validFrom <= now < validUntil`.
- **Revocation is final.** Extend and revoke take a row lock first, so concurrent mutations
  serialize, and a revoked grant can never be extended or resurrected.
- **User references restrict deletion** (IB-14). `userId` is nullable with `onDelete: Restrict`, plus
  `subjectPseudonym`, so a user with grant or billing rows cannot be hard-deleted by a cascade.
- **Razorpay never leaves `provider/`** (SB-PB-04). Nothing outside it imports the `razorpay` package
  or `provider/razorpay/**`, or reads a `RAZORPAY_*` variable. ESLint enforces it, and
  `eslint-boundaries.test.ts` proves the rules fire.
- **Every provider call is budgeted.** A provider comes only from `getBillingProvider(priority)`,
  which returns the disabled provider or the Razorpay provider inside `BudgetedProvider`. There is no
  way to obtain the bare implementation from outside `provider/`.
- **A failure to observe is never an observation.** A timeout, a 5xx or a malformed body changes no
  local state. For a mutation it means the outcome may be unknown (`requestSentAt` is set), and it is
  resolved by reading the provider later, never by resending.
- **No provider call inside a transaction or under a row lock.** Provider methods are plain async
  functions and are never given a database client.
- **Mode is stamped, and only the expected mode contributes** (SB-EA-07). `DISABLED` is never
  stamped, and a `TEST` row grants nothing in a `LIVE`-expected deployment.
- **Disabled is a supported state.** With no credentials the app boots, Free, grants and gates keep
  working, and only starting or changing a paid subscription is refused.

## Public API

- `index.ts`: DTO types and `BillingErrorCode` (client-safe).
- Route handlers deep-import the controllers:
  - `GET /api/v1/me/entitlements`
  - `GET` and `POST /api/v1/admin/billing/grants`
  - `POST /api/v1/admin/billing/grants/{id}/extend`
  - `POST /api/v1/admin/billing/grants/{id}/revoke`

## Dependencies

`@/lib/entitlements` (catalog, validity, resolver, and the expected mode), `@/authorization`,
`@/lib/errors`, `@/lib/http`, `@/lib/rate-limit` (the store port, for the request budget),
`@/lib/security` (constant-time comparison), `@/lib/search` (pagination), `@/lib/logger`, and
`@/lib/prisma`.

Billing never imports the projects, portfolio, notifications or MCP modules, and ESLint enforces it.
Only this module, app routes and pages, and `instrumentation.ts` import billing.

## Configuration

All billing variables are documented in `next/.env.example`; the tuning values and the reasoning behind
their defaults are in `config/billing-config.ts` and
[configuration](../../../../docs/architecture/subscription/implementation/configuration.md).

## Contract tests

`pnpm test:contract` runs an opt-in suite against the real Razorpay TEST API
(`provider/razorpay/razorpay-provider.contract.test.ts`). It is never part of `pnpm test`, the
integration suite or CI. Its header lists what it needs and what it creates.
