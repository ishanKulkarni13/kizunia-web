# Verification Checklist

> **Status:** Live
>
> **Last Updated:** 2026-09-21

Self-review against every failure scenario and requirement this design must survive. Each item is
answered with a reference, not a bare yes/no.

---

| Question | Answer | Where |
| --- | --- | --- |
| Does Free work without Razorpay? | Yes — Free has no Subscription record and effective-access resolution for a Free user makes zero provider calls | [SB-EA-01](../../project/feature-specification/subscription/decisions/effective-access-and-grants.md#sb-ea-01--free-has-no-subscription-record), [`entitlements/effective-access-resolution.md`](entitlements/effective-access-resolution.md) |
| Can production run with paid billing temporarily disabled? | Yes — `disabled` is a first-class, fully supported provider mode | [`provider-availability/disabled-provider-mode.md`](provider-availability/disabled-provider-mode.md) |
| Can development happen without Razorpay credentials? | Yes — admin grants exercise every entitlement-gated feature | [`cross-cutting/testing-without-razorpay.md`](cross-cutting/testing-without-razorpay.md) |
| Can TEST mode be used safely? | Yes — resolved from key-prefix validation at boot, with its own webhook secret, isolated from live | [`provider-availability/environments.md`](provider-availability/environments.md) |
| Can LIVE mode be enabled safely? | Yes — same resolution mechanism; enabling it is a credential/config change, not a code change | [`provider-availability/environments.md`](provider-availability/environments.md) |
| Can Razorpay Dashboard mutations synchronize into Kizunia? | Yes — treated as a normal lifecycle path through the same webhook pipeline as any other change | [`lifecycle/dashboard-originated-changes.md`](lifecycle/dashboard-originated-changes.md) |
| Can duplicate webhooks be processed safely? | Yes — unique-constraint dedupe on `(provider, eventId)` before acknowledgement | [`webhooks/reliability-and-idempotency.md`](webhooks/reliability-and-idempotency.md) |
| Can out-of-order events be handled? | Yes — state-changing events trigger an authoritative refetch instead of trusting payload order | [`webhooks/ordering-and-staleness.md`](webhooks/ordering-and-staleness.md) |
| Can missed events be recovered? | Yes — periodic reconciliation sweep, plus on-demand reconciliation on processing failure | [`reconciliation/reconciliation-job.md`](reconciliation/reconciliation-job.md) |
| Can webhook processing be retried? | Yes — reuses the notification subsystem's bounded-retry, lease-based work queue | [`webhooks/reliability-and-idempotency.md`](webhooks/reliability-and-idempotency.md) |
| Can Kizunia recover from provider outages? | Yes — local state is trusted indefinitely; nothing times out into an assumed downgrade | [`provider-availability/outage-and-stale-state.md`](provider-availability/outage-and-stale-state.md) |
| Can Kizunia recover from its own worker/database failures? | Yes — the same lease/claim crash-recovery pattern the notification queue already uses | [`webhooks/reliability-and-idempotency.md`](webhooks/reliability-and-idempotency.md#crash-recovery) |
| Can internal state be reconciled with Razorpay? | Yes — periodic and on-demand, Razorpay always authoritative | [`reconciliation/README.md`](reconciliation/README.md) |
| Is Razorpay-specific logic isolated? | Yes — a single, narrow provider-boundary interface; no Razorpay ID or status string used outside it | [`provider-boundary/README.md`](provider-boundary/README.md), [`provider-boundary/identifiers.md`](provider-boundary/identifiers.md) |
| Are entitlements independent of Razorpay? | Yes — resolution reads only Kizunia's own `Subscription`/`EntitlementGrant` tables | [`entitlements/effective-access-resolution.md`](entitlements/effective-access-resolution.md) |
| Are admin grants independent of Razorpay? | Yes — no provider call anywhere in grant creation/extension/revocation | [`entitlements/admin-grants.md`](entitlements/admin-grants.md) |
| Does effective access use the highest currently valid entitlement? | Yes | [SB-EA-02](../../project/feature-specification/subscription/decisions/effective-access-and-grants.md#sb-ea-02--effective-access-is-the-highest-currently-valid-entitlement-across-all-sources) |
| Is application authorization still separate from subscription entitlement? | Yes — entitlement is one more input to the existing `AuthorizationEvaluator` chain, never a replacement for it | [`entitlements/authorization-integration.md`](entitlements/authorization-integration.md) |
| Are quotas separate from rate limiting? | Yes — two systems, one shared input, unrelated questions | [`entitlements/quotas-vs-rate-limits.md`](entitlements/quotas-vs-rate-limits.md) |
| Is subscription history/audit sufficient? | Yes — an append-only phase-transition trail plus a separate grant audit trail, together answering "why does this user have this access" | [`history-and-audit/README.md`](history-and-audit/README.md) |
| Are sensitive billing details protected? | Yes — signature verification is unconditional and first; secrets, raw payloads, and payment-instrument data are never logged | [`webhooks/security.md`](webhooks/security.md), [`cross-cutting/observability.md`](cross-cutting/observability.md) |
| Are current Razorpay capabilities actually verified from official documentation? | Yes, on 2026-09-21, with every fact cited to its source | [`provider-boundary/razorpay-facts.md`](provider-boundary/razorpay-facts.md) |
| Are test-mode and live-mode assumptions documented? | Yes | [`provider-availability/environments.md`](provider-availability/environments.md) |
| Are uncertain Razorpay behaviors clearly marked? | Yes — tagged OPEN, distinct from FACT and INTERPRETATION, and listed with what they block | [`provider-boundary/razorpay-facts.md`](provider-boundary/razorpay-facts.md), [`../../project/feature-specification/subscription/open-decisions.md`](../../project/feature-specification/subscription/open-decisions.md) |
| Have unnecessary abstractions been avoided? | Yes — no generic multi-provider framework, no generic coupon engine, no second retry engine, no polymorphic entitlement-source table | [SB-PB-01](../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-01--the-provider-boundary-is-sized-not-generic), [SB-CP-02](../../project/feature-specification/subscription/decisions/coupons-and-promotions.md#sb-cp-02--no-generic-coupon-engine-in-v1), [SB-PF-01](../../project/feature-specification/subscription/decisions/payment-failure-and-recovery.md#sb-pf-01--no-second-retry-engine), [domain overview](../domain/subscription/overview.md#why-subscription-and-entitlementgrant-are-two-entities-not-one-polymorphic-table) |

---

## Before implementation begins

Two items from the pre-existing authorization audit
(`docs/temp/kizunia-authorization-compressed-wind.md` §22, P1) are strongly recommended first, since
this subsystem directly gates the two surfaces they concern:

1. Refactor `PortfolioPolicy` onto `AuthorizationEvaluator` (currently a hand-written `switch`) —
   this design's [`entitlements/authorization-integration.md`](entitlements/authorization-integration.md#portfolio-public-eligibility) wiring is cleanest built on the standard pattern, not
   compounding the existing drift.
2. Add a shared admin-route guard before building admin-grant UI — see
   [`entitlements/admin-grants.md`](entitlements/admin-grants.md#authorization-for-granting).

Neither is a blocker to this documentation set being complete; both are recommended sequencing for
whoever picks up implementation.
