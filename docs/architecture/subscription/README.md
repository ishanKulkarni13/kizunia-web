# Kizunia Subscription & Billing Architecture

> **Status:** Design — not implemented
>
> **Version:** 1.0
>
> **Audience:** Backend Developers, Contributors
>
> **Last Updated:** 2026-09-21

---

## What this is

This directory describes **how** Subscription & Billing is built so that it can keep changing. It
is the technical counterpart to the product specification at
[`docs/project/feature-specification/subscription/`](../../project/feature-specification/subscription/README.md),
which describes **what** it does and why. Behavioral rules are stated there and referenced here;
they are not restated.

Nothing in this directory is implemented. It is written to the same bar as the (implemented)
notification architecture at [`docs/architecture/notifications/`](../notifications/README.md), so an
implementation phase can begin directly from it.

---

## The core principle

> Razorpay is Kizunia's billing provider. Razorpay is **not** the foundation of Kizunia's
> membership system.

```text
Razorpay (billing provider)
        |
        v
Provider boundary            <- Razorpay-specific code lives only here
        |
        v
Kizunia Subscription / EntitlementGrant state    <- Kizunia-owned, Razorpay-independent
        |
        v
Effective Access                                  <- computed: highest valid entitlement, any source
        |
        v
Authorization  /  Quotas  /  Rate limits  /  Notifications  /  Recommendations  /  MCP
```

Everything below the provider boundary line must remain correct even if Razorpay has never been
configured. See [`provider-availability/README.md`](provider-availability/README.md).

---

## Reading order

| # | Document | Why |
| --- | --- | --- |
| 1 | [principles.md](principles.md) | The rules everything else follows |
| 2 | [module-boundaries.md](module-boundaries.md) | What this subsystem owns and what it may touch |
| 3 | [provider-boundary/README.md](provider-boundary/README.md) | The Razorpay boundary, and the verified facts it rests on |
| 4 | [lifecycle/README.md](lifecycle/README.md) | Trial, upgrade, downgrade, cancellation, payment failure, Dashboard changes |
| 5 | [entitlements/README.md](entitlements/README.md) | Effective-access resolution and where it plugs into the app |
| 6 | [webhooks/README.md](webhooks/README.md) | The most security- and reliability-critical part of this design |
| 7 | [reconciliation/README.md](reconciliation/README.md) | The safety net behind webhooks |
| 8 | [provider-availability/README.md](provider-availability/README.md) | Test, live, and disabled as first-class states |
| 9 | [history-and-audit/README.md](history-and-audit/README.md) | Answering "why does this user have this access" |
| 10 | [cross-cutting/README.md](cross-cutting/README.md) | Observability, security, testing without Razorpay, future extensibility |
| 11 | [verification-checklist.md](verification-checklist.md) | Self-review against every failure scenario this design must survive |

---

## Areas

| Area | Owns |
| --- | --- |
| [`provider-boundary/`](provider-boundary/README.md) | The narrow Razorpay interface, verified facts, identifier isolation |
| [`lifecycle/`](lifecycle/README.md) | Razorpay state mapping, trials, upgrade/downgrade, cancellation, payment failure, Dashboard-originated changes |
| [`entitlements/`](entitlements/README.md) | Effective-access resolution, admin grants, quotas, authorization wiring, coupons/offers |
| [`webhooks/`](webhooks/README.md) | Event catalog, signature security, reliability/idempotency, ordering/staleness |
| [`reconciliation/`](reconciliation/README.md) | The periodic and on-demand authoritative-state sweep |
| [`provider-availability/`](provider-availability/README.md) | Test/live/disabled modes, outage handling |
| [`history-and-audit/`](history-and-audit/README.md) | Subscription history and admin-grant audit trails |
| [`cross-cutting/`](cross-cutting/README.md) | Observability, security hardening, testing without Razorpay, future extensibility |

Related, outside this directory:

| Document | Contents |
| --- | --- |
| [`domain/subscription/`](../domain/subscription/README.md) | The conceptual domain model |
| [`decisions/subscription-billing.md`](../decisions/subscription-billing.md) | The founding architectural decision record |
| [`../project/feature-specification/subscription/`](../../project/feature-specification/subscription/README.md) | Product behavior and the full decision register |
| [`workflows/internal-jobs.md`](../workflows/internal-jobs.md) | The repository's scheduled-job convention, reused for reconciliation |
| [`notifications/jobs/README.md`](../notifications/jobs/README.md) | The Postgres-backed work-queue pattern, reused for webhook processing |

---

## Environment facts this design must respect

Verified against the repository and against current official Razorpay documentation, not assumed:

| Fact | Consequence |
| --- | --- |
| There is no message broker or generic job framework — scheduled work is a `GET` route behind `CRON_SECRET`, registered in a task registry dispatched by one Vercel cron tick | Reconciliation is a registered task, not new infrastructure. See [`reconciliation/reconciliation-job.md`](reconciliation/reconciliation-job.md) |
| The notification subsystem already built a Postgres-backed durable work queue with lease-based crash recovery and `P2002`-as-idempotency | Webhook processing reuses this pattern rather than inventing a second queue. See [`webhooks/reliability-and-idempotency.md`](webhooks/reliability-and-idempotency.md) |
| `lib/entitlements/index.ts`'s `resolveEntitlements()` always returns `{tier: "default"}` today, by design, awaiting a real `Plan`/`Subscription` model | This is the exact function this design replaces. See [`entitlements/effective-access-resolution.md`](entitlements/effective-access-resolution.md) |
| `lib/rate-limit/resolver.ts` already threads an (unused) `entitlements` parameter through `resolvePolicy` | Plan-tier rate limits activate by changing that function's body only — no call-site changes. See [`entitlements/quotas-vs-rate-limits.md`](entitlements/quotas-vs-rate-limits.md) |
| `AuthorizationCode.UPGRADE_REQUIRED`/`FEATURE_DISABLED` are already reserved, unused denial codes | These are the codes an entitlement-denial `AuthorizationDecision` uses. See [`entitlements/authorization-integration.md`](entitlements/authorization-integration.md) |
| `portfolio/backend/authorization/public-eligibility.ts`'s `resolvePortfolioPublicEligibility()` is a live, already-wired, always-`true` gate, explicitly commented as this design's seam | Wiring effective access here requires no schema change and no change to `PortfolioPolicy`'s shape. See [`entitlements/authorization-integration.md`](entitlements/authorization-integration.md#portfolio-public-eligibility) |
| Razorpay webhook delivery is documented at-least-once and **not** ordered; a non-2xx or >5s response is treated as failure and retried for 24h with exponential backoff, then the webhook is disabled | Drives the entire receive/verify/persist/ack/process split in [`webhooks/reliability-and-idempotency.md`](webhooks/reliability-and-idempotency.md) |
| Razorpay's subscription state machine has 9 states, including `halted` (retries exhausted, not cancelled, invoices generate indefinitely unpaid) and `paused`/`cancelled`/`expired`/`completed` as terminal or explicit-action states | Drives the state mapping in [`lifecycle/state-mapping.md`](lifecycle/state-mapping.md) |
| Razorpay Offers can only be created from the Dashboard, not via API, and are scoped to payment instruments, not Kizunia accounts | Drives the coupon/promotion split in [`entitlements/coupons-and-offers.md`](entitlements/coupons-and-offers.md) |

---

## Status

**Design, not implemented.** Every decision this document set depends on has been resolved and
recorded as a ruling in the product tree's
[decision register](../../project/feature-specification/subscription/decisions/README.md), except
the items explicitly listed as needing Razorpay TEST-mode verification in
[`open-decisions.md`](../../project/feature-specification/subscription/open-decisions.md).

## Keeping this live

When this subsystem's architecture changes, the owning document here changes in the same commit.
When its *behavior* changes, the product specification changes instead, and a ruling is recorded in
its [decision register](../../project/feature-specification/subscription/decisions/README.md).

> Code and documentation should not intentionally drift apart.
