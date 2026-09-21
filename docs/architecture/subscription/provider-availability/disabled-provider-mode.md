# Disabled Provider Mode

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-21

What "paid billing unavailable" means concretely, when provider mode resolves to `disabled`. See
[SB-PB-03](../../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-03--disabled-is-a-fully-supported-production-state).

---

## What keeps working, unconditionally

| Works normally | Why |
| --- | --- |
| Authentication | Unrelated to billing |
| Free membership, in full | Resolves with zero provider calls — see [SB-EA-01](../../../project/feature-specification/subscription/decisions/effective-access-and-grants.md#sb-ea-01--free-has-no-subscription-record) |
| Existing paid users' effective access | Resolved from Kizunia's own `Subscription`/`EntitlementGrant` tables, not from a live Razorpay call — see [`effective-access-resolution.md`](../entitlements/effective-access-resolution.md) |
| Admin grants (create/extend/revoke) | Never touch the provider boundary — see [`../entitlements/admin-grants.md`](../entitlements/admin-grants.md) |
| Authorization, quotas, rate limits | All consume already-resolved effective access, not a live provider call |
| Portfolio, projects, notifications, recommendations, MCP | Unconditionally, per their own entitlement checks against already-resolved effective access |

## What is gated behind `isBillingProviderEnabled()`

| Unavailable | User-facing behavior |
| --- | --- |
| Starting a new paid subscription | A clear "paid subscriptions are temporarily unavailable" response, not a crash or a generic 500 |
| Changing an existing paid subscription (upgrade/downgrade/cancel) | Same |
| Processing an actual payment | Same — no attempt to reach Razorpay is made |
| Receiving/processing real webhooks | The webhook route itself can remain mounted (so enabling later requires no redeploy of routing), but signature verification against a `disabled` mode's absent secret fails closed — nothing is trusted or processed while disabled |

## Why this must be one seam, not a scattered set of checks

Explicitly required: the disabled state must not become "an ugly hardcoded environment check
scattered across the application." Every one of the gated operations above calls
`isBillingProviderEnabled()` (or is unreachable because the provider boundary implementation itself
raises a typed `BillingProviderUnavailableError` when invoked in `disabled` mode) — never a local
`if (process.env.RAZORPAY_KEY_ID)` re-implemented at each call site.

## What must never happen while disabled

- The application must not crash on startup or on any unrelated request.
- Free must not become unavailable.
- Authorization and entitlement resolution must not fail.
- A raw provider error must never reach a normal user — the typed unavailability error is caught at
  the API boundary and translated into the clear, generic message above.
- No attempt to reach Razorpay happens at all — not a retried, failing call, just none.
