# Architecture Fit

> **Status:** Implementation plan — not implemented
>
> **Last Updated:** 2026-09-24
>
> **Blueprint section:** §1 (see the [section map](README.md#blueprint-section-map))

Where subscriptions belong in the existing architecture: the two homes (a read-side effective-access seam and a write-side billing module), the seams the codebase already provides and what each needs, the small extensions to existing abstractions, dependency direction, and the forbidden couplings.

**Decisions referenced here:** [IB-3](open-decisions.md#ib-3--entitlement-resolver-signature), [IB-4](open-decisions.md#ib-4--portfolio-creation-gate), [IB-5](open-decisions.md#ib-5--async-portfolio-public-eligibility), [IB-15](open-decisions.md#ib-15--billing-admin-roles). All were ruled on 2026-09-24; see [open decisions](open-decisions.md) for each ruling and who made it (product decision (owner) or architecture decision (autonomous)).

---

## Where subscriptions belong

The repository's layering is:

```text
app/api/v1/**/route.ts        thin: exports GET/POST -> Controller
modules/<m>/backend/controller.ts   Route.execute(): session actor, rate limit, zod, call service
modules/<m>/backend/*service.ts     authorize (Authorizer/Policy), business rules, $transaction
modules/<m>/backend/*repository.ts  Prisma
modules/<m>/{policy,config,jobs,observability,errors,schemas,frontend}
lib/*                         cross-cutting, module-agnostic (rate-limit, entitlements, internal-jobs, http, errors)
authorization/*               AuthorizationEvaluator, PlatformPolicy/Authorizer, codes
```

Subscriptions split into **two homes**, following the doc's split between *billing state* and *effective access*:

| Home | Owns | Why here |
| --- | --- | --- |
| **`src/lib/entitlements/`** (exists, stub) | Plan identity and ordering; the plan→capability/quota catalog; the contributing-phase rule; expected billing mode; `resolveEntitlements(userId)`; the set-based predicate; `explainEffectiveAccess`; `EntitlementAuthorizer` helpers | The one seam every feature module already points at. It is read-only and reads `Subscription` + `EntitlementGrant` through Prisma directly, as `lib/rate-limit` does, so feature modules never depend on the billing module. |
| **`src/modules/billing/`** (new) | All writes to billing tables; the provider boundary; commands; webhooks; sync; reconciliation; orphan discovery; admin grants and promotions; anomalies; history; billing admin APIs; billing UI | A module like `notifications`, with the same internal shape. |

Proposed layout of the new module (mirrors `modules/notifications`):

```text
src/modules/billing/
  provider/            THE provider boundary. Only place with Razorpay HTTP, env, shapes, error codes
    types.ts             BillingProvider interface, Outcome<T>, ProviderSubscriptionState, failure classes
    razorpay/            razorpay-client.ts (fetch), razorpay-provider.ts, mapping.ts (wire shape only),
                         classification.ts, signatures.ts
    fake-provider.ts     every failure class on demand (tests, local)
    disabled-provider.ts what a deployment with no credentials gets
    budgeted-provider.ts decorator: auth pin + cooldown + budget around any BillingProvider
    provider-mode.ts     resolve and validate the mode at boot, isBillingProviderEnabled()
    provider-factory.ts  getBillingProvider(priority): the one place a provider is built. It sits inside
                         provider/ because it is the one caller of provider/razorpay/**
  config/              billing-config.ts (envInt tuning), plan-catalog.ts (per mode), offer-catalog.ts
  policy/              pure: state-mapping.ts, next-due.ts, command-preconditions.ts, trial-eligibility.ts
  backend/
    commands/          command-runner.ts, start-checkout, change-plan, cancel, supersede, admin-cancel
    sync/              sync.service.ts (mark/claim/fetch/apply), apply.ts, claim.repository.ts
    webhooks/          webhook.service.ts (verify/record), event.repository.ts
    reconciliation/    billing-sync.task.ts, orphan-discovery.service.ts, payload-prune.ts
    grants/            grant.service.ts, promotion.service.ts
    budget/            provider-budget.ts, cooldown.repository.ts, provider-health.ts (reach the decorator through two ports)
    anomalies/, history/, account-removal/ (S16)
    controller.ts, admin.controller.ts, authorization/ (billing admin actions)
    *.repository.ts
  observability/log.ts   logBillingEvent / logBillingAlert (same shape as notifications/observability/log.ts)
  errors/, schemas/, dto/, frontend/
```

## Seams that already exist, and what each needs

| Seam | Location | State today | What it needs |
| --- | --- | --- | --- |
| `resolveEntitlements()` | `lib/entitlements/index.ts:32` | `{tier:"default"}`, sync, no args | New async per-user API **beside** it; the existing function keeps serving rate limiting (IB-3, decided) |
| `resolvePolicy(…, entitlements)` | `lib/rate-limit/resolver.ts:30` | parameter ignored | Nothing in V1; activate when a plan-tier override is configured |
| `AuthorizationCode.UPGRADE_REQUIRED` / `FEATURE_DISABLED` | `authorization/types/authorization-code.ts:67,72` | reserved; `FEATURE_DISABLED` used by portfolio | Use as the entitlement denial codes; `Authorization.assert` maps them to 403 with that code |
| `resolvePortfolioPublicEligibility()` | `portfolio/backend/authorization/public-eligibility.ts` | always `true`; consumed by `PortfolioPolicy.canView` non-owner branch | Real check, async, computed before the context is built (IB-5, decided) |
| `CREATE_PORTFOLIO` baseline + comment | `authorization/platform/permission-set.ts:17-24`, `PortfolioService.create:145` | every role | Entitlement `.require` in the portfolio create chain (IB-4) |
| `ProjectService.create` after `PlatformAuthorizer.can(CREATE_PROJECT)` | `projects/backend/service.ts:295-331` | one `$transaction` creating the project and `OWNER` member | Per-user lock + owned count + quota inside that transaction |
| Notification scheduler query | `notification-scheduler.service.ts:336-358` `findEnabledUserIds` | filters `enabled`, `banned`, `status` | Add the set-based entitlement predicate per intent |
| Handler / policy re-checks | `evaluate-registration-closing.handler.ts:60`, `notification-policy.service.ts:48`, `delivery.service.ts:211` | preference only | Parallel `hasCapability(userId, cap)`; new suppression reason `NOT_ENTITLED` |
| MCP dispatch | `mcp/server/transport/dispatch.ts:125-195` | scope + domain authorizers | One capability check after the actor is resolved |
| Internal tick + registry | `app/api/v1/internal/tick/route.ts`, `lib/internal-jobs/registry.ts` | 3 tasks | Register `billing:sync`, `billing:orphan-discovery`, `billing:payload-prune` |
| Claim-with-lease raw SQL, `utc()` binding, `P2002` idempotency | `notifications/jobs/postgres-work-queue.ts:93,162-212` | notification-specific table | Reuse the **pattern** on the `subscription` row; not the `WorkQueue` port, whose kinds are notification-typed |
| Postgres rate-limit store | `lib/rate-limit/postgres.store.ts` | unconditional `increment` | Add a **conditional** increment for the outbound budget |
| Constant-time compare | `lib/security/timing-safe-equal.ts` `secretEquals` | used by tick | Webhook and checkout HMAC comparison |
| Optional-provider pattern | `notifications/delivery/push-provider.factory.ts` | config → real or fake provider | Same shape for `getBillingProvider()` / disabled mode |
| Error hierarchy | `lib/errors` (`AppError`, `ConflictError`, `ExternalServiceError`, `ForbiddenError`) + `ErrorHandler` | — | Billing errors extend `AppError`; no new HTTP plumbing |
| Structured logging | `notifications/observability/log.ts` | `[notifications] {json}` | `[billing] {json}` sibling |

## Existing abstractions that need extension (small, additive)

1. `lib/entitlements`: from a stub to the effective-access facade.
2. `PostgresRateLimitStore` (+ `InMemoryRateLimitStore`, `RateLimitStore` port): add `incrementIfBelow(key, ceiling, expiresAt)`. It is a single `INSERT … ON CONFLICT DO UPDATE SET count = count + 1 WHERE count < $ceiling RETURNING count`, where no row returned means refused.
3. `PlatformAction` + `PlatformPermissionSet`: `MANAGE_ENTITLEMENT_GRANTS`, `VIEW_BILLING`, `MANAGE_BILLING`. Role assignment (IB-15, decided): `SUPER_ADMIN` holds all three; `ADMIN` holds `VIEW_BILLING`; `MODERATOR` holds none.
4. `RATE_LIMIT_POLICIES`: inbound policies `billing:checkout`, `billing:checkout-confirm`, `billing:command`, `billing:webhook` (IP, fail-open), `promotions:redeem`.
5. `PortfolioContext`/resolver: async eligibility, plus actor entitlements for create.
6. `ProjectRepository`: `countOwnedByUser(userId, tx)`; schema index on `ProjectMember(userId, role)`.
7. Notification policy types: suppression reason `NOT_ENTITLED`.
8. `ProjectMember`, `NotificationPreference` and similar are untouched otherwise.

## Dependency direction

```text
app routes ──> <feature>/backend controllers ──> services
                                                   │
projects, portfolio, notifications, mcp ───────────┼──> lib/entitlements ──> prisma (READ Subscription, EntitlementGrant)
                                                   │
modules/billing/backend ──> lib/entitlements (catalog, types) · lib/rate-limit (store) · lib/internal-jobs (types)
                        ──> authorization · lib/errors · lib/http · prisma (WRITE billing tables)
                        ──> modules/billing/provider (interface only)
modules/billing/provider/razorpay ──> fetch, node:crypto, provider env vars
app/api/v1/internal/tick ──> modules/billing/backend/reconciliation (task factories)
```

## Forbidden dependencies (enforced by ESLint since Phase III)

Enforced in `next/eslint.config.mjs` as disjoint zones (a later `no-restricted-imports` **replaces** an earlier one for the same file, so each file matches exactly one), and proven by `modules/billing/eslint-boundaries.test.ts`. The provider-call, sync and UI rules below are enforced by review: ESLint cannot express them.

- Anything outside `modules/billing/**` importing `modules/billing/**`, except `app/` routes and the tick route.
- Anything outside `modules/billing/provider/**` importing `modules/billing/provider/razorpay/**`, reading `process.env.RAZORPAY_*`, or holding a Razorpay ID or status string (SB-PB-04, SB-EA-05).
- `lib/entitlements` importing `modules/billing` (it reads tables, not billing code).
- `modules/billing` importing projects, portfolio, notifications or MCP modules (billing never reaches into features).
- Feature code branching on a plan name (`if (plan === "PRO")`). Only capability or quota questions are allowed (SB-PL-02).
- A provider call inside `prisma.$transaction` or while holding a row lock (SB-RC-08).
- A provider mutation from sync, reconciliation or orphan discovery (SB-RC-10).
- UI components computing access, quota or plan rules. The UI renders server-computed DTO flags.

---

## Related documents

**In this directory**

- [Subscription State Model](state-model.md)
- [Billing Command Model](command-model.md)
- [Existing Feature Integration](feature-integration.md)
- [Configuration and Environment](configuration.md)
- [Open decisions](open-decisions.md) · [Settled decisions](settled-decisions.md) · [Index](README.md)

**Design and specification**

- [Module boundaries](../module-boundaries.md)
- [Principles](../principles.md)
- [Entitlements — authorization integration](../entitlements/authorization-integration.md)
- [Internal / scheduled job convention](../../workflows/internal-jobs.md)
- [Notification jobs (claim-with-lease pattern)](../../notifications/jobs/README.md)
- [Authorization architecture](../../authorization/README.md)
