# Rulings — Coupons and Promotions

> **Status:** Live
>
> **Last Updated:** 2026-09-24

---

## SB-CP-01 — Billing discounts use Offers; free-access grants use Promotions; never conflated

**Status:** Accepted

**Decision:** See [`../coupons-and-promotions.md`](../coupons-and-promotions.md) for the full
statement. A real, ongoing paid subscription that happens to be discounted is a Razorpay **Offer**.
Free plan-level access with no real subscription behind it is a Kizunia **Promotion**, modeled
identically to an [admin grant](../admin-grants.md).

**Rationale:** [RAZORPAY FACT] Razorpay has no concept of a Kizunia user account, and therefore no
way to represent "give this Kizunia account free access" as a billing construct — its Offers are
scoped to payment instruments (cards, UPI handles), not to Kizunia identities (see
[`../../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#offers)).
The earlier feasibility research identified attempting to force a free-access grant through a
Razorpay discount as the single largest risk in the coupon area; modeling it as an `EntitlementGrant`
instead — the exact same mechanism as an admin grant — removes the risk entirely and requires no
new concept.

## SB-CP-02 — No generic coupon engine in V1

**Status:** Accepted

**Decision:** V1 does not build coupon stacking, a campaign/promotion framework, or per-user dynamic
discount minting as a Razorpay-native concept.

**Rationale:** Explicitly required by this design's source instructions ("keep V1 simple... do not
over-engineer coupons"). [RAZORPAY FACT] There is no documented Razorpay support for combining
multiple Offers on one subscription, and Offer usage limits are instrument-scoped rather than
account-scoped, so a large part of what a "coupon engine" would normally guarantee (per-account
redemption limits) cannot be enforced by Razorpay regardless — it would have to be Kizunia-side
bookkeeping layered on top of a system not designed for it.

## SB-CP-03 — Offers are pre-provisioned from a fixed catalog of discount shapes

**Status:** Accepted

**Decision:** Rather than creating a new Razorpay Offer per promotional code, Kizunia maintains a
small, pre-provisioned catalog of discount *shapes* (e.g. 10% off, 50% off, 99% off first cycle,
flat ₹100 off) in the Razorpay Dashboard, and maps marketing codes onto that fixed catalog.

**Amended (2026-09-26) — product decision (owner), Phase VII ([IB-27](../../../../architecture/subscription/implementation/open-decisions.md#ib-27--phase-vii-decisions-and-implementation-rulings)):** in V1 the catalog is
**static configuration** (Dashboard → `offer_id` → an entry in `config/offer-catalog.ts` → deploy). Adding an
Offer needs a code change and a deployment; this is an **intentional V1 limitation**, not an open problem. The
catalog is read through one narrow asynchronous port so that a later, admin-managed, database-backed catalog
(an admin copies the `offer_id` and its metadata into a Kizunia dashboard, no deploy) replaces only the source.
That admin tool is not built in Phase VII.

**Rationale:** [RAZORPAY FACT] Razorpay Offers can only be created from the Dashboard, not via API
(see [`../../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#offers)).
A bounded catalog of shapes, decided once, avoids needing dashboard access as part of any runtime
operation — creating a new marketing code is a mapping-table change, not a Dashboard visit.

## SB-CP-04 — Code eligibility is checked against the user's own history, and redemption is atomic

**Status:** Accepted

**Decision:** A marketing code (for an Offer) or a Promotion code may carry one eligibility rule
from a small fixed set — `ANY_USER`, `FIRST_PAID_SUBSCRIPTION_ONLY` (the user has no prior
Subscription that ever reached `TRIALING`, `ACTIVE` or `PAST_DUE`), or `ONCE_PER_USER`. The rule is
evaluated against the user's Kizunia records inside the per-user command serialization
([SB-CM-01](commands-and-idempotency.md#sb-cm-01--every-mutating-provider-call-is-a-recorded-billing-operation)),
before any Razorpay call. The code used is stored on the resulting Subscription or grant. Promotion
redemption is enforced by a unique `(promotion, user)` record and a conditional decrement of the
remaining-redemptions counter, in one transaction.

**Amended (2026-09-26), Phase VII ([IB-27](../../../../architecture/subscription/implementation/open-decisions.md#ib-27--phase-vii-decisions-and-implementation-rulings)):**

- **A code is consumed only by a subscription that carried it and reached a contributing phase** (product decision, owner). An abandoned or expired checkout that carried it consumes nothing.
- **`FIRST_PAID_SUBSCRIPTION_ONLY` is evaluated from the user's Subscription records only** (`TRIALING`, `ACTIVE` or `PAST_DUE`, so a trial counts). Access from an admin grant or a promotion is not a paid subscription and never makes a user ineligible.
- Eligibility is read in the current provider mode only.
- Promotion redemption is one transaction (the conditional decrement, the grant, the redemption and the audit entry, all or nothing).

**Rationale:** [RAZORPAY FACT] Offer usage limits are per card, not per customer, and nothing
prevents the same customer from reusing an Offer on a new subscription
([razorpay-facts](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#offers)).
Without a Kizunia-side check, "99% off your first month" is reusable indefinitely by cancelling and
resubscribing. A fixed set of three rules evaluated against records Kizunia already keeps closes
this without the per-user redemption engine [SB-CP-02](#sb-cp-02--no-generic-coupon-engine-in-v1)
rules out. A read-then-increment counter would let two tabs both redeem the last slot.

## SB-CP-05 — An Offer can be linked to an active subscription, effective at cycle end

**Status:** Accepted — resolves a former open decision

**Decision:** [RAZORPAY FACT] Razorpay allows linking an Offer to an `active` subscription; it takes
effect at the end of the current billing cycle, never immediately
([razorpay-facts](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#offers)).
V1 does not expose this to customers: Offers are applied at subscription creation only. Support may
link one from the Razorpay Dashboard (for example as a retention gesture); that is a
Dashboard-originated change observed through synchronization like any other.

**Rationale:** Resolves the former open question "can an Offer be attached to an already-active
subscription". Keeping V1 to creation-time Offers avoids a second redemption path (and its
eligibility checks) for a use case nobody has asked for yet.
