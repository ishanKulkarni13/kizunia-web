# Admin Grants

> **Status:** Stable
>
> **Last Updated:** 2026-09-21

Administrators can give a user plan-level access directly, without any payment and without
Razorpay ever being involved.

---

## Why this exists

| Use case |
| --- |
| Development and testing subscription-dependent features without spending real money |
| Internal team members |
| Hackathon or competition prizes |
| Support cases (goodwill access, compensation for an incident) |
| Promotions and marketing campaigns |
| Future gifting between users |

The common thread: **how a user obtained access** and **what a user is allowed to access** are
separate questions. A grant answers the first differently from a payment; the effective-access
resolver does not care which one produced the result. See
[`entitlements-and-effective-access.md`](entitlements-and-effective-access.md).

## What a grant looks like, from the product's side

An administrator chooses a user, a plan, a duration (or no expiry), and records a reason. The grant
takes effect immediately and expires automatically at the end of its duration, with no manual
cleanup step. While active, it contributes to the user's effective access exactly like a paid
subscription would — including being able to *exceed* whatever the user's Razorpay subscription
currently provides (see the [highest-wins example](entitlements-and-effective-access.md#the-highest-wins-rule)).

## Grants must never require Razorpay

Granting, extending, revoking, or letting a grant expire touches nothing on the Razorpay side. This
is what makes admin grants usable in every environment, including local development with no
Razorpay credentials at all — see
[`../../../architecture/subscription/cross-cutting/testing-without-razorpay.md`](../../../architecture/subscription/cross-cutting/testing-without-razorpay.md).

## Auditability

Every grant, extension, and revocation must be attributable: which administrator, which user, which
plan, what duration, and why. The codebase has no existing generic audit-log table to reuse for
this — it is new scaffolding, following the notification subsystem's "record it, never overwrite
it" precedent rather than inventing a new philosophy. See
[`../../../architecture/subscription/history-and-audit/admin-grant-audit.md`](../../../architecture/subscription/history-and-audit/admin-grant-audit.md).

## Admin access is not the same thing as an admin grant

An administrator's own ability to bypass feature gates (via `PlatformAccess.canBypassAuthorization`)
is unrelated to whether that administrator has been *granted* a plan as a customer. The two are
never conflated — see
[`entitlements-and-effective-access.md`](entitlements-and-effective-access.md#admin-access-is-not-a-subscription-tier).

## Related rulings

[`decisions/effective-access-and-grants.md`](decisions/effective-access-and-grants.md).
