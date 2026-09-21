# Future

> **Status:** Direction — not implemented
>
> **Last Updated:** 2026-09-21

Direction this design is built to absorb without a rewrite. None of this is scoped, scheduled, or
built. Each item is here because the architecture was deliberately kept open to it — not because it
is coming next.

---

## More plans, including an "unlimited" tier

A future plan with no customer-facing project-ownership quota is expected to still respect an
internal operational safety ceiling (an abuse-protection concept, not a product quota) — see
[`../../../architecture/subscription/entitlements/quotas-vs-rate-limits.md`](../../../architecture/subscription/entitlements/quotas-vs-rate-limits.md).
"Unlimited" means no normal customer-facing limit, never "bypasses all platform safety limits."

## One-time purchases

Purchasable, non-recurring units (for example, a paid portfolio theme) are expected to model
ownership independently of subscription status — a Free user could own a purchased theme without
being Pro. This is a distinct entitlement source from the ones this design builds
([`entitlements-and-effective-access.md`](entitlements-and-effective-access.md)), not yet designed.

## Coupon stacking and richer promotions

Combining multiple discounts, per-user dynamic codes minted at runtime, and a general
campaign/promotion framework are all explicitly out of scope for V1
([`coupons-and-promotions.md`](coupons-and-promotions.md)) and undesigned here.

## Finer-grained MCP entitlement

MCP access today is a single Pro+ boolean. Multiple access levels or scopes gated by finer
entitlement are expected — the existing MCP scope model is already extensible without a redesign
(see the authorization audit, §10).

## Multiple/repeatable trials

Whether a user can receive more than one trial, and any cooldown between them, is undesigned.
Razorpay has no concept of "this customer already had a trial" — any such rule is entirely
Kizunia's to define later.

## Additional billing providers

The provider boundary is sized to Razorpay's actual needs today, not built as a generic
multi-provider framework. If a second provider is ever required, it implements the same narrow
interface — see
[`../../../architecture/subscription/provider-boundary/interface-and-abstraction.md`](../../../architecture/subscription/provider-boundary/interface-and-abstraction.md).
Nothing here should be read as promising that day will come.
