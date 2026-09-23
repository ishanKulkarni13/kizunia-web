# Kizunia Subscription & Billing Architecture

> **Status:** Design — not implemented
>
> **Version:** 1.0
>
> **Audience:** Backend Developers, Contributors
>
> **Last Updated:** 2026-09-24

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
| 4 | [lifecycle/README.md](lifecycle/README.md) | Phases, the open-subscription invariant, trial, plan changes, cancellation, payment failure, provider-side changes |
| 5 | [commands/README.md](commands/README.md) | Every mutation Kizunia asks Razorpay to perform: recorded, serialized, never blindly retried |
| 6 | [entitlements/README.md](entitlements/README.md) | Effective-access resolution and where it plugs into the app |
| 7 | [webhooks/README.md](webhooks/README.md) | The most security- and reliability-critical part of this design |
| 8 | [reconciliation/README.md](reconciliation/README.md) | One sync mechanism: webhook refetches, due-based reconciliation, the request budget, orphan discovery |
| 9 | [provider-availability/README.md](provider-availability/README.md) | Test, live, and disabled as first-class states |
| 10 | [history-and-audit/README.md](history-and-audit/README.md) | Answering "why does this user have this access" |
| 11 | [cross-cutting/README.md](cross-cutting/README.md) | Observability, security, the operations runbook, testing without Razorpay, future extensibility |
| 12 | [verification-checklist.md](verification-checklist.md) | Self-review against every failure scenario this design must survive |

---

## Areas

| Area | Owns |
| --- | --- |
| [`provider-boundary/`](provider-boundary/README.md) | The narrow Razorpay interface, verified facts, identifier isolation |
| [`lifecycle/`](lifecycle/README.md) | Razorpay state mapping, multiple subscriptions and supersession, trials, plan changes, cancellation, payment failure, provider-side changes |
| [`commands/`](commands/README.md) | `BillingOperation`, per-user serialization, idempotency, checkout and creation, outcome-unknown resolution |
| [`entitlements/`](entitlements/README.md) | Effective-access resolution, admin grants, quotas, authorization wiring, coupons/offers |
| [`webhooks/`](webhooks/README.md) | Event catalog, signature security, reliability/idempotency, ordering/staleness |
| [`reconciliation/`](reconciliation/README.md) | The sync mechanism, due-based scheduling, the outbound request budget and failure taxonomy, orphan discovery |
| [`provider-availability/`](provider-availability/README.md) | Test/live/disabled modes, outage handling |
| [`history-and-audit/`](history-and-audit/README.md) | Subscription history and admin-grant audit trails |
| [`cross-cutting/`](cross-cutting/README.md) | Observability, security hardening, operations runbook, testing without Razorpay, future extensibility |

Related, outside this directory:

| Document | Contents |
| --- | --- |
| [`domain/subscription/`](../domain/subscription/README.md) | The conceptual domain model |
| [`decisions/subscription-billing.md`](../decisions/subscription-billing.md) | The founding architectural decision record |
| [`../project/feature-specification/subscription/`](../../project/feature-specification/subscription/README.md) | Product behavior and the full decision register |
| [`workflows/internal-jobs.md`](../workflows/internal-jobs.md) | The repository's scheduled-job convention, reused for the `billing-sync` and orphan-discovery tasks |
| [`notifications/jobs/README.md`](../notifications/jobs/README.md) | The claim-with-lease (`SKIP LOCKED`) pattern, reused for claiming due Subscriptions |

---

## Environment facts this design must respect

Verified against the repository and against current official Razorpay documentation (re-verified
2026-09-24), not assumed:

| Fact | Consequence |
| --- | --- |
| There is no message broker or generic job framework — scheduled work is a `GET` route behind `CRON_SECRET`, registered in a task registry dispatched by one tick | Billing background work is registered tasks, not new infrastructure. See [`reconciliation/reconciliation-job.md`](reconciliation/reconciliation-job.md) |
| The only cron entry (`next/vercel.json`) fires **once a day** on Vercel Hobby | Nothing user-visible may wait for the tick in the normal case: webhooks and checkout confirmation sync immediately; the tick is the backstop, and the scheduler is a deployment choice ([SB-PB-06](../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-06--billing-execution-is-scheduler-agnostic)) |
| Next.js 16 provides `after()` for work after the response | Used for the immediate post-webhook sync. See [`webhooks/reliability-and-idempotency.md`](webhooks/reliability-and-idempotency.md) |
| `lib/rate-limit` has a Postgres-backed fixed-window store | Reused as the global outbound Razorpay request budget. See [`reconciliation/provider-rate-limits.md`](reconciliation/provider-rate-limits.md) |
| The Better Auth `admin()` plugin allows user removal, and the schema cascades widely from `User` | Billing records must not cascade; account removal is gated on open subscriptions ([SB-DP-04](../../project/feature-specification/subscription/decisions/data-preservation.md#sb-dp-04--billing-records-survive-account-removal)) |
| The notification subsystem already built a Postgres-backed work queue with lease-based crash recovery and `P2002`-as-idempotency | The claim/lease and `P2002` conventions are reused; the work item is the Subscription row itself. See [`reconciliation/sync-mechanism.md`](reconciliation/sync-mechanism.md) |
| `lib/entitlements/index.ts`'s `resolveEntitlements()` always returns `{tier: "default"}` today, by design, awaiting a real `Plan`/`Subscription` model | This is the exact function this design replaces. See [`entitlements/effective-access-resolution.md`](entitlements/effective-access-resolution.md) |
| `lib/rate-limit/resolver.ts` already threads an (unused) `entitlements` parameter through `resolvePolicy` | Plan-tier rate limits activate by changing that function's body only — no call-site changes. See [`entitlements/quotas-vs-rate-limits.md`](entitlements/quotas-vs-rate-limits.md) |
| `AuthorizationCode.UPGRADE_REQUIRED`/`FEATURE_DISABLED` are already reserved, unused denial codes | These are the codes an entitlement-denial `AuthorizationDecision` uses. See [`entitlements/authorization-integration.md`](entitlements/authorization-integration.md) |
| `portfolio/backend/authorization/public-eligibility.ts`'s `resolvePortfolioPublicEligibility()` is a live, already-wired, always-`true` gate, explicitly commented as this design's seam | Wiring effective access here requires no schema change and no change to `PortfolioPolicy`'s shape. See [`entitlements/authorization-integration.md`](entitlements/authorization-integration.md#portfolio-public-eligibility) |
| Razorpay webhook delivery is documented at-least-once and **not** ordered; a non-2xx or >5s response is treated as failure and retried for 24h with exponential backoff, then the webhook is disabled | Drives the receive/verify/record/ack/sync split in [`webhooks/reliability-and-idempotency.md`](webhooks/reliability-and-idempotency.md) |
| Razorpay publishes no API rate-limit numbers; Create Subscription has no idempotency mechanism; plan updates are refused for UPI, e-mandate and domestic cards | Drive the request budget, the command model, and the native-only plan-change decision. See [`provider-boundary/razorpay-facts.md`](provider-boundary/razorpay-facts.md) |
| Razorpay's subscription state machine has 9 states, including `halted` (retries exhausted, not cancelled, recoverable by the customer at any time outside Kizunia) and `cancelled`/`expired`/`completed` as terminal | Drives the state mapping and the multiple-subscriptions rules in [`lifecycle/`](lifecycle/README.md) |
| Razorpay Offers can only be created from the Dashboard, not via API, and their limits are per card, not per customer | Drives the coupon/promotion split and Kizunia-side code eligibility in [`entitlements/coupons-and-offers.md`](entitlements/coupons-and-offers.md) |

---

## Status

**Design, not implemented.** Hardened on 2026-09-24 by an adversarial architecture review; its
conclusions are recorded as amended and new rulings in the
[decision register](../../project/feature-specification/subscription/decisions/README.md) and as
R-04–R-06 in [`reconciliations.md`](../../project/feature-specification/subscription/decisions/reconciliations.md).
Every decision this document set depends on is a ruling there, except the items in
[`open-decisions.md`](../../project/feature-specification/subscription/open-decisions.md) — each of
which has a defined fallback behavior. What implementation-readiness means, and what remains, is in
[`verification-checklist.md`](verification-checklist.md).

## Keeping this live

When this subsystem's architecture changes, the owning document here changes in the same commit.
When its *behavior* changes, the product specification changes instead, and a ruling is recorded in
its [decision register](../../project/feature-specification/subscription/decisions/README.md).

> Code and documentation should not intentionally drift apart.
