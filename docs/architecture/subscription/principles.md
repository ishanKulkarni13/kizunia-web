# Principles

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-21

The rules this subsystem is held to. Every other document in this tree follows from these.

---

> **Razorpay is a billing provider, not the foundation of membership.**

Free, effective access, entitlements, quotas, and authorization must all be resolvable with zero
Razorpay calls. See [`provider-boundary/README.md`](provider-boundary/README.md).

> **Free never touches Razorpay.**

Not "Free degrades gracefully if Razorpay is unavailable" — Free performs **zero** provider
operations, in every environment, including one where Razorpay has never been configured. See
[`provider-availability/README.md`](provider-availability/README.md).

> **A webhook payload is a hint, not a fact, for state transitions.**

Razorpay does not guarantee webhook ordering. Any event that would change a Subscription's phase
triggers an authoritative refetch instead of trusting the payload's embedded status. See
[`webhooks/ordering-and-staleness.md`](webhooks/ordering-and-staleness.md).

> **Do not duplicate mechanics Razorpay already owns.**

No second payment-retry engine, no second grace-period timer, no generic coupon engine. Where
Razorpay's own lifecycle already provides reasonable behavior, react to it instead of rebuilding it.
See [`lifecycle/payment-failure-and-recovery.md`](lifecycle/payment-failure-and-recovery.md).

> **Entitlement resolution is the only new authorization seam.**

Subscription & Billing does not replace `AuthorizationEvaluator`, does not build a parallel
permission system, and does not touch resource-level ownership checks. It resolves one new input —
effective access — that existing policies consume. See
[`entitlements/authorization-integration.md`](entitlements/authorization-integration.md).

> **Losing paid access changes what a user can newly do. It never destroys what they already have.**

See [`../../project/feature-specification/subscription/data-preservation.md`](../../project/feature-specification/subscription/data-preservation.md).

> **Provider identifiers stay at the provider boundary.**

No feature module, authorization policy, or domain service outside the provider boundary inspects a
Razorpay ID or status string directly. See [`provider-boundary/identifiers.md`](provider-boundary/identifiers.md).

> **Build the boundary Kizunia needs today. Do not build the framework Kizunia might need someday.**

A `UniversalPaymentProvider` covering hypothetical future providers is explicitly rejected. See
[`provider-boundary/interface-and-abstraction.md`](provider-boundary/interface-and-abstraction.md).

---

## What not to build now

| Do not build | Instead |
| --- | --- |
| A second payment-retry/grace-period engine | React to Razorpay's own `pending`/`halted` lifecycle |
| A generic multi-provider payment framework | A boundary sized to Razorpay's actual operations |
| A generic coupon/campaign engine | Razorpay Offers (discounts) + Kizunia Promotions (free-access grants), nothing more |
| A new, parallel authorization system for entitlements | One more input consumed by the existing `AuthorizationEvaluator` chain |
| A Kizunia-side proration calculator | Razorpay's own `schedule_change_at`/`cancel_at_cycle_end` behavior |
