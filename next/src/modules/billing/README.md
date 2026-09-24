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

Subscriptions, the Razorpay provider boundary, checkout, webhooks and synchronization arrive in
Phases III–VI. Nothing here calls a payment provider.

## Responsibilities

| Area | Where |
| --- | --- |
| Grant rules: self-grant refusal, extension rules, final revocation | `backend/grants/grant.service.ts` |
| Grant persistence and row locking | `backend/grants/grant.repository.ts` |
| Grant DTOs; `state` derived at read time | `backend/grants/grant.dto.ts`, `grant.mapper.ts` |
| Billing authorization (`MANAGE_ENTITLEMENT_GRANTS`, `VIEW_BILLING`) | `backend/authorization/authorizer.ts` |
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
│   ├── grants/           service, repository, mapper, DTOs
│   ├── admin.controller.ts
│   ├── controller.ts
│   └── entitlements.service.ts
├── errors/
├── frontend/components/
├── observability/
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
  `subjectPseudonym`, so a user with grant rows cannot be hard-deleted by a cascade.

## Public API

- `index.ts`: DTO types and `BillingErrorCode` (client-safe).
- Route handlers deep-import the controllers:
  - `GET /api/v1/me/entitlements`
  - `GET` and `POST /api/v1/admin/billing/grants`
  - `POST /api/v1/admin/billing/grants/{id}/extend`
  - `POST /api/v1/admin/billing/grants/{id}/revoke`

## Dependencies

`@/lib/entitlements` (catalog, validity, resolver), `@/authorization`, `@/lib/errors`, `@/lib/http`,
`@/lib/rate-limit`, `@/lib/search` (pagination), `@/lib/logger`, and `@/lib/prisma`.

Billing never imports the projects, portfolio, notifications or MCP modules.
