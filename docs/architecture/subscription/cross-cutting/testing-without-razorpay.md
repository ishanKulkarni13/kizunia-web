# Testing Without Razorpay

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-21

---

## What admin grants make possible

Every entitlement-gated feature — project quotas, portfolio, notifications, recommendations, MCP,
downgrade behavior, entitlement expiration — can be exercised by granting a test user a plan via
[`../entitlements/admin-grants.md`](../entitlements/admin-grants.md), with zero Razorpay
configuration, in any environment. This is what makes local development possible in
[`../provider-availability/disabled-provider-mode.md`](../provider-availability/disabled-provider-mode.md).

```text
Grant a local test user PRO_PLUS, no expiry
  -> exercise portfolio creation, project quota at 20, deadline notifications,
     recommendations, MCP access — all real code paths, no Razorpay involved
Revoke the grant
  -> exercise downgrade behavior: data preserved, new limits enforced
```

## What this does not validate

This validates Kizunia's own entitlement-consuming logic. It does **not** validate:

- Real Razorpay API request/response shapes
- Real webhook payloads and signature verification against genuine Razorpay-signed events
- Real payment retry timing
- Real Offer application

Those require Razorpay TEST mode (see
[`../provider-availability/environments.md`](../provider-availability/environments.md)) and, for the
items listed in
[`../../../project/feature-specification/subscription/open-decisions.md`](../../../project/feature-specification/subscription/open-decisions.md),
direct observation rather than documentation reading. This distinction is stated explicitly so that
a full test suite passing on admin grants alone is never mistaken for "the Razorpay integration is
verified."

## Provider-boundary implementation testing

The provider boundary's own implementation (the thing that actually calls Razorpay) is tested
against Razorpay's TEST mode credentials and TEST-mode webhooks — a fake/mocked Razorpay client
would validate Kizunia's code but not Razorpay's actual behavior, which is exactly what needs
verifying at that layer.
