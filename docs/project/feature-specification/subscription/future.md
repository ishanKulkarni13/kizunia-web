# Future

> **Status:** Direction — not implemented
>
> **Last Updated:** 2026-09-24

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

## Plan changes Razorpay cannot perform natively

**The most significant V1 limitation.** Razorpay cannot change the plan of a subscription paid by UPI
AutoPay or e-mandate, and for domestic cards can only change its discount
([R-06](decisions/reconciliations.md#r-06--the-update-api-does-not-support-plan-changes-for-most-indian-payment-methods)).
V1 offers plan changes only where Razorpay can perform them
([SB-LC-07](decisions/lifecycle.md#sb-lc-07--razorpay-decides-whether-a-plan-change-is-possible)).

A later phase could offer plan changes to everyone through a *successor subscription*: the current
subscription is cancelled at the end of its period and a new one for the new plan is authorized now
to start then (for downgrades and cycle changes), possibly with a temporary grant bridging an upgrade
until the new billing starts. That would need a deliberate product decision on upgrade pricing (the
partial period), a second mandate authorization from the user, and one explicit relaxation of the
"never a second open subscription" invariant for a linked successor. None of it is designed. See
[open question B1](open-decisions.md#b-genuinely-open-product-questions).

## Undo cancellation

Razorpay offers no way to revoke a requested cycle-end cancellation. Offering "keep my subscription"
would need the same successor-subscription machinery as above ([B5](open-decisions.md#b-genuinely-open-product-questions)).

## Coupon stacking and richer promotions

Combining multiple discounts, per-user dynamic codes minted at runtime, and a general
campaign/promotion framework are all explicitly out of scope for V1
([`coupons-and-promotions.md`](coupons-and-promotions.md)) and undesigned here.

## Finer-grained MCP entitlement

MCP access today is a single Pro+ boolean. Multiple access levels or scopes gated by finer
entitlement are expected — the existing MCP scope model is already extensible without a redesign
(see the authorization audit, §10).

## Multiple/repeatable trials

V1 allows one trial per account ([SB-LC-11](decisions/lifecycle.md#sb-lc-11--one-trial-per-account)).
Re-trials or cooldowns (for example, a new trial a year later) are undesigned. Razorpay has no concept
of "this customer already had a trial" — any such rule is entirely Kizunia's.

## Additional billing providers

The provider boundary is sized to Razorpay's actual needs today, not built as a generic
multi-provider framework. If a second provider is ever required, it implements the same narrow
interface — see
[`../../../architecture/subscription/provider-boundary/interface-and-abstraction.md`](../../../architecture/subscription/provider-boundary/interface-and-abstraction.md).
Nothing here should be read as promising that day will come.
