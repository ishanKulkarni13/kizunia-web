# Rulings — Provider Boundary and Environments

> **Status:** Live
>
> **Last Updated:** 2026-09-21

---

## SB-PB-01 — The provider boundary is sized, not generic

**Status:** Accepted

**Decision:** Razorpay integration lives behind a narrow interface covering exactly the operations
Kizunia needs — create/fetch/update/cancel a subscription, verify and parse a webhook. It is not
built as a generic, multi-provider payment framework.

**Rationale:** Explicitly required by this design's source instructions: "do not create an enormous
abstraction... instead, create a clean and appropriately sized billing/provider boundary around the
actual domain needs." A generic abstraction sized for hypothetical future providers would be paid
for immediately and used by exactly one implementation for the foreseeable future. See
[`../../../architecture/subscription/provider-boundary/interface-and-abstraction.md`](../../../architecture/subscription/provider-boundary/interface-and-abstraction.md).

## SB-PB-02 — Provider mode is resolved once at boot

**Status:** Accepted

**Decision:** Whether the billing provider is `disabled`, `test`, or `live` is resolved once, at
application boot, from credential presence and key-prefix validation (`rzp_test_` vs `rzp_live_`) —
never re-derived per request, and never checked via scattered `process.env.RAZORPAY_...` reads
throughout feature code.

**Rationale:** [ENGINEERING] A single resolved mode, exposed through one `isBillingProviderEnabled()`
-style seam, is what makes "paid billing unavailable" a coherent, testable application state instead
of an emergent property of wherever an environment check happened to be missing. Key-prefix
validation at boot catches a misconfigured environment (test secret paired with live keys) as a
fail-fast startup error rather than a silent, dangerous mismatch discovered in production.

## SB-PB-03 — Disabled is a fully supported production state

**Status:** Accepted

**Decision:** Running in production with the billing provider `disabled` (no credentials configured
yet) is a first-class, supported deployment state — not a misconfiguration to work around. Free,
existing paid users' cached entitlement, authorization, and admin grants all continue working
normally; only operations that would need to create or mutate real Razorpay billing state are
unavailable.

**Rationale:** [PRODUCT] Explicitly required: Kizunia may be deployed to production before live
Razorpay credentials exist, and this must not crash the application, break Free, or break
entitlement resolution for anyone. See
[`../../../architecture/subscription/provider-availability/disabled-provider-mode.md`](../../../architecture/subscription/provider-availability/disabled-provider-mode.md).

## SB-PB-04 — Razorpay identifiers never leak past the provider boundary

**Status:** Accepted

**Decision:** Razorpay subscription IDs, plan IDs, payment IDs, and status strings are stored only
as provider-reference metadata attached to a Kizunia `Subscription` record. No domain service,
authorization policy, or feature module outside the provider boundary ever branches on a Razorpay
identifier or status string directly.

**Rationale:** [PRODUCT] Explicitly required by the original product doc (`suscriptions.md` §15,
§82) and this design's source instructions. [ENGINEERING] It is also a practical necessity:
[RAZORPAY FACT] a cancelled Razorpay subscription cannot be reactivated — a resubscribe creates a
brand-new Razorpay subscription object with a new ID (see
[`../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../architecture/subscription/provider-boundary/razorpay-facts.md#lifecycle-states)).
If Kizunia's own continuity (a user's subscription history, their effective-access lineage) were
keyed on the Razorpay ID, that continuity would break every time a user cancelled and resubscribed.
Keeping Kizunia's own identifiers as the domain's backbone, with Razorpay IDs as attached
references, avoids this entirely.
