# Testing Without Razorpay

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24

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

## Testing the billing machinery without Razorpay

The commands, sync mechanism, budget and failure handling are Kizunia code and are tested against a
**fake provider** implementing the boundary interface
([`../provider-boundary/interface-and-abstraction.md`](../provider-boundary/interface-and-abstraction.md)),
which can return every failure class on demand. Scenarios that must be covered:

| Scenario | Asserts |
| --- | --- |
| Create times out; later found by orphan discovery / never found | Bound once / `ABANDONED`; never re-sent |
| Two concurrent checkouts for one user | One provider subscription |
| Two fetches applied in reverse order | The older observation is discarded |
| Webhook arrives while a fetch is in flight | A further fetch happens after it |
| Webhook burst for one subscription | One fetch |
| 429 / 5xx storm | Global cooldown; no local state change; priority-1 still attempted |
| Unknown status / unmapped plan | Not applied; anomaly |
| Halted subscription recovers after a new one exists | Both contribute; anomaly; nothing auto-cancelled |
| Supersession where cancel is refused | New purchase refused |
| Trial restart attempt | Refused |
| Test-mode row in a production-mode resolver | Does not contribute |

## Provider-boundary implementation testing

The provider boundary's own implementation (the thing that actually calls Razorpay) is tested
against Razorpay's TEST mode credentials and TEST-mode webhooks — a fake/mocked Razorpay client
would validate Kizunia's code but not Razorpay's actual behavior, which is exactly what needs
verifying at that layer.

## TEST-mode verification plan

**FACT.** TEST mode has no accelerated billing clock; the Dashboard's "Charge this now" simulates a
successful or failed charge, four failures lead to `halted`, and test card tokens last three days
([razorpay-facts](../provider-boundary/razorpay-facts.md#test-vs-live-mode)). Every item in
[`open-decisions.md` §A](../../../project/feature-specification/subscription/open-decisions.md#a-razorpay-behavior-requiring-test-mode-verification-or-support)
marked TEST is resolved with these tools before `live`, and each result is recorded as a FACT in
[`razorpay-facts.md`](../provider-boundary/razorpay-facts.md).
