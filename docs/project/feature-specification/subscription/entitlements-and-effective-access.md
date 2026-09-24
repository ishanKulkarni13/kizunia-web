# Entitlements and Effective Access

> **Status:** Stable
>
> **Last Updated:** 2026-09-24

> **Billing determines access state. Entitlements determine what the application allows.**

This is the central principle the rest of Subscription & Billing follows. Razorpay (or an admin, or
a trial) determines whether a user *has* a given access state. Kizunia's own entitlement model
determines what that access state *means* for any given feature. The two are never merged into one
check.

---

## Entitlement sources

Effective access can come from more than one place at once:

| Source | Requires Razorpay | Owned by |
| --- | --- | --- |
| Default (Free) | No | Nothing — the absence of any other source |
| Paid Subscription | Yes | Razorpay's billing lifecycle, mirrored into Kizunia |
| Trial | Yes (Razorpay-native trial) | A paid Subscription in its trial period — not a separate source type; see [`subscription-lifecycle.md`](subscription-lifecycle.md#trial) |
| Admin grant | No | An administrator, see [`admin-grants.md`](admin-grants.md) |
| Promotion | No | A redeemed promotional code, see [`coupons-and-promotions.md`](coupons-and-promotions.md) |

Future sources (one-time purchases, other grant types) plug into the same list — see
[`future.md`](future.md). Feature code never enumerates sources; it only ever asks for the
resolved result below.

## The highest-wins rule

> **Effective access is the highest currently valid entitlement provided by any currently active
> access source.**

Worked example:

```text
Razorpay Subscription:  PRO       (active)
Admin grant:             PRO_PLUS  (active, expires in 12 days)

Effective access: PRO_PLUS
```

When the grant expires:

```text
Razorpay Subscription:  PRO       (active)
Admin grant:             PRO_PLUS  (expired)

Effective access: PRO
```

Neither source is destroyed by the other. The Razorpay subscription continues billing Pro the
entire time; the grant simply stopped contributing to the maximum once it expired. This is why
grants and subscriptions are modeled as independent, coexisting sources rather than one overwriting
the other — see [`decisions/effective-access-and-grants.md`](decisions/effective-access-and-grants.md).

## If a user ever has two paid subscriptions

Kizunia never creates a second live subscription for a user, but one can arise from outside Kizunia
(for example, a subscription created in the Razorpay Dashboard). Kizunia never picks one arbitrarily:
effective access is the highest plan across all of them — the user always gets at least what they are
being charged for — and the situation is flagged to support to resolve. See
[`decisions/uniqueness-and-resubscription.md`](decisions/uniqueness-and-resubscription.md#sb-uq-05--multiple-open-subscriptions-arising-outside-kizunia-are-detected-never-silently-resolved).

## Free requires nothing

A user with no current paid Subscription (including a trial) and no active grant has effective access `FREE` by
definition — not because a `FREE` record exists somewhere, but because `FREE` is what "no other
source is currently valid" resolves to. This is what makes Free free of any Razorpay dependency:
resolving effective access for a Free user touches zero provider state, in every environment. See
[`decisions/effective-access-and-grants.md`](decisions/effective-access-and-grants.md#sb-ea-01--free-has-no-subscription-record).

## Preferences always survive

Effective access changing never touches a user's *preferences* — notification preferences,
competition preference profile, or any other user-configured setting. A user who loses Pro and
regains it later finds every preference exactly as they left it. This mirrors the notification
subsystem's own Preference-vs-Entitlement distinction (see
[`../notification/overview/glossary.md`](../notification/overview/glossary.md)) and is one of the
[data-preservation](data-preservation.md) invariants.

A user may switch on a notification they are not currently entitled to (a Free user enabling
deadline notifications, for example): the preference is stored as chosen, the settings screen marks
it "requires Pro" (or Pro+), and nothing is delivered until the user is entitled. A user who
upgrades gets exactly what they had switched on, with no second step. (Decided 2026-09-24,
[IB-16](../../../architecture/subscription/implementation/open-decisions.md#ib-16--preferences-for-non-entitled-intents).)

## Admin access is not a subscription tier

A `PlatformRole` of `ADMIN`/`SUPER_ADMIN` bypasses feature gates the same way it bypasses
authorization generally — through the existing `platformOverride()` mechanism, not by being treated
as an entitlement source with effective access `PRO_PLUS`. An admin's *personal* effective access
(as a customer) and their *administrative* bypass are two separate, non-conflated concepts. See
[`../../../architecture/subscription/entitlements/authorization-integration.md`](../../../architecture/subscription/entitlements/authorization-integration.md).

**Scope of the bypass (product decision, 2026-09-24,
[IB-7](../../../architecture/subscription/implementation/open-decisions.md#ib-7--admin-bypass-of-entitlement-gates)):**
the bypass covers the gates an administrator meets directly (creating projects beyond the quota,
creating a portfolio, using MCP). It does **not** cover background eligibility: deadline and
recommendation notifications are sent to an administrator only if their own effective access
includes them, for example through an admin grant made by another administrator. A public
portfolio's display always follows its owner's effective access. See
[SB-EA-04](decisions/effective-access-and-grants.md#sb-ea-04--admin-platform-role-bypass-is-not-an-entitlement-source).

## Related rulings

[`decisions/effective-access-and-grants.md`](decisions/effective-access-and-grants.md).
