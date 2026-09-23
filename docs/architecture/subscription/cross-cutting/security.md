# Security

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24

Webhook-specific security is covered in [`../webhooks/security.md`](../webhooks/security.md). This
page covers the rest of the subsystem's security surface.

---

## Authorization boundaries

| Surface | Who | Check |
| --- | --- | --- |
| Checkout, confirm, cancel, plan change | The signed-in user, for **their own** billing only | Session actor; every command is scoped by `userId` from the session, never from the request body |
| Admin billing actions (sync now, immediate cancel, resolve anomaly) | Admins with a billing platform action | `PlatformAuthorizer` behind the shared admin-route guard (`kizunia-authorization-compressed-wind.md` §22, P1-2) |
| Grant / extend / revoke | Admins with `MANAGE_ENTITLEMENT_GRANTS` | Same; self-grants refused ([SB-EA-08](../../../project/feature-specification/subscription/decisions/effective-access-and-grants.md#sb-ea-08--administrators-cannot-grant-access-to-themselves)) |
| Billing views (history, events, raw payloads, anomalies) | Admins with a billing-read action | Same; raw payloads are the most sensitive view |
| Internal tick | `CRON_SECRET` (constant-time) | Existing convention |

Platform-role bypass (`canBypassAuthorization`) never confers billing-admin actions implicitly; the
billing actions are explicit permissions, so the bypass does not become a way to grant or cancel
subscriptions without an audit trail.

## Tenant isolation

A user-facing endpoint never accepts a Kizunia or Razorpay subscription ID that it then acts on
without checking ownership. Checkout confirmation uses the server-held provider ID of the caller's own
`PENDING_AUTHENTICATION` record and ignores the client-supplied one for anything but the signature
check ([SB-CM-06](../../../project/feature-specification/subscription/decisions/commands-and-idempotency.md#sb-cm-06--checkout-confirmation-syncs-only-the-callers-own-subscription)).
A webhook can only affect the Subscription its provider ID is bound to.

## Provider credential handling

`RAZORPAY_KEY_SECRET` and the webhook secret(s) are configuration, never logged, never returned in any
API response, and read only inside the provider boundary. The key secret is also the checkout
signature key. Rotation procedures: [`operations-runbook.md`](operations-runbook.md#rotating-api-keys)
and [`operations-runbook.md`](operations-runbook.md#rotating-the-webhook-secret).

## Never trust client-supplied billing state

No endpoint accepts a plan, subscription state or entitlement value from a request body as
authoritative. Effective access is always derived server-side from records written by authoritative
observations ([`../entitlements/effective-access-resolution.md`](../entitlements/effective-access-resolution.md)).
Idempotency keys are client-supplied but only ever *deduplicate* a user's own requests.

## Race conditions with security impact

| Race | Protection |
| --- | --- |
| Two concurrent checkouts creating two paid subscriptions | One in-flight `BillingOperation` per user (DB constraint) |
| Two concurrent trial starts bypassing one-trial-per-account | Same serialization around the eligibility check |
| Promotion redeemed twice / last slot taken twice | Unique `(promotion, user)` + conditional decrement |
| Quota bypass by parallel project creation | Per-user lock around count-and-insert ([`../entitlements/quotas-vs-rate-limits.md`](../entitlements/quotas-vs-rate-limits.md#project-ownership-quota)) |
| Stale provider state overwriting newer state | Stale-apply guard |

## Environment separation

Test and live credentials, secrets, plan catalogs and Offer maps are never shared across environments;
every provider-linked row is mode-stamped and a `test` subscription never grants access in production
([`../provider-availability/environments.md`](../provider-availability/environments.md)).

## Personal data

- `notes` sent to Razorpay contain only opaque Kizunia identifiers.
- Raw webhook payloads (which may include contact details) are kept only in `BillingEvent`, behind
  billing-admin access, and deleted after the payload retention horizon.
- On account removal, billing records are pseudonymized rather than deleted, and removal is refused
  while a subscription is open ([SB-DP-04](../../../project/feature-specification/subscription/decisions/data-preservation.md#sb-dp-04--billing-records-survive-account-removal)).
  Billing tables must not use `onDelete: Cascade` from `User`.

## Refunds and Dashboard access

Kizunia does not issue refunds in V1; refunds happen in the Razorpay Dashboard and arrive as recorded
facts. Kizunia's attack surface for "who can move money back" is therefore exactly Razorpay Dashboard
access control, which should be limited to named operators with individual logins.
