# Security

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-21

Webhook-specific security is covered in [`../webhooks/security.md`](../webhooks/security.md). This
page covers the rest of the subsystem's security surface.

---

## Admin grant authorization

Creating, extending, or revoking an `EntitlementGrant` requires the same platform-action-gated
authorization as any other administrative mutation — never a bespoke check. Admin-grant UI is
exactly the kind of new admin surface the authorization audit recommends sit behind a shared
route guard rather than per-page discipline (`kizunia-authorization-compressed-wind.md` §22, P1-2).

## Provider credential handling

`RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` are configuration, never logged, never returned
in any API response, and read only inside the provider boundary implementation — see
[`../provider-boundary/README.md`](../provider-boundary/README.md).

## Never trust client-supplied billing state

Restated from [`../webhooks/security.md`](../webhooks/security.md#never-trust-client-supplied-subscriptionplan-data)
because it applies beyond the webhook route: no endpoint accepts a plan, subscription id, or
entitlement value from a request body as authoritative. Effective access is always derived
server-side from [`../entitlements/effective-access-resolution.md`](../entitlements/effective-access-resolution.md).

## Environment separation

Test and live credentials, and their respective webhook secrets, are never shared across
environments — see [`../provider-availability/environments.md`](../provider-availability/environments.md). A
staging environment pointed at live Razorpay credentials by mistake is exactly the kind of
misconfiguration the boot-time key-prefix validation exists to catch.

## Refund and cancellation implications

A Dashboard-issued refund or cancellation is data Kizunia receives, not an operation Kizunia
initiates on the admin's behalf through its own UI in V1 — see
[`../lifecycle/dashboard-originated-changes.md`](../lifecycle/dashboard-originated-changes.md). This
means Kizunia's own attack surface for "who can refund a payment" is exactly Razorpay Dashboard
access control, which is outside this subsystem's scope to change.
