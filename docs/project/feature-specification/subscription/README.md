# Kizunia Subscription & Membership

> **Status:** Stable — product direction finalized; **not implemented**
>
> **Version:** 1.0
>
> **Audience:** Product, Backend Developers, Contributors
>
> **Last Updated:** 2026-09-21

---

## What this is

This directory describes **what** Kizunia's paid membership does and why — Free/Pro/Pro+ plans,
what each unlocks, how access changes over time, and the product invariants that must survive any
implementation. It is the product counterpart to the technical design at
[`docs/architecture/subscription/`](../../../architecture/subscription/README.md), which describes
**how** it is built. Behavioral rules are stated here and referenced there; they are not restated.

Payment/billing mechanics belong to Razorpay and are described from the *product-behavior* angle
here (e.g. "cancellation keeps access until the period you already paid for ends") — the mechanism
(which Razorpay API, which webhook) lives in the architecture tree.

Nothing in this document set is implemented yet. It is the finalized direction an implementation
phase will build from — see
[`docs/architecture/subscription/verification-checklist.md`](../../../architecture/subscription/verification-checklist.md)
for what "ready to implement" means.

---

## The premise

> Razorpay is Kizunia's billing provider. Razorpay is **not** the foundation of Kizunia's
> membership system.

Kizunia owns Free membership, plans, effective access, entitlements, quotas, authorization, admin
grants, and subscription history. Razorpay owns billing mechanics: recurring charges, payment
authorization, mandates, retries, and provider-side billing lifecycle. The application never asks
"what does Razorpay say" when deciding what a user can do — it asks Kizunia's own, always-available
effective-access state. See [`entitlements-and-effective-access.md`](entitlements-and-effective-access.md).

A direct consequence: **Free must work with zero Razorpay dependency**, in every environment —
local development with no credentials, production before live credentials exist, and production
during a Razorpay outage. See [`../../../architecture/subscription/provider-availability/README.md`](../../../architecture/subscription/provider-availability/README.md).

---

## Reading order

| # | Document | Why |
| --- | --- | --- |
| 1 | [glossary.md](glossary.md) | The vocabulary everything else assumes |
| 2 | [plans.md](plans.md) | What Free/Pro/Pro+ are, today |
| 3 | [entitlements-and-effective-access.md](entitlements-and-effective-access.md) | How "what can this user do" is decided |
| 4 | [subscription-lifecycle.md](subscription-lifecycle.md) | Trial, upgrade, downgrade, cancellation, payment failure — from the user's side |
| 5 | [data-preservation.md](data-preservation.md) | Why losing paid access never deletes data |
| 6 | [portfolio-and-entitlements.md](portfolio-and-entitlements.md) | The one module with a genuine pre-existing gap this closes |
| 7 | [admin-grants.md](admin-grants.md) | Access without Razorpay |
| 8 | [coupons-and-promotions.md](coupons-and-promotions.md) | The deliberately small V1 |
| 9 | [decisions/README.md](decisions/README.md) | Every finalized ruling, with an ID |
| 10 | [open-decisions.md](open-decisions.md) | What is deliberately still unresolved |
| 11 | [future.md](future.md) | What this is designed to absorb later, not built now |

---

## Areas

| Area | Owns |
| --- | --- |
| [`plans.md`](plans.md) | Plan tiers, quotas, the feature matrix |
| [`entitlements-and-effective-access.md`](entitlements-and-effective-access.md) | Entitlement sources, the highest-wins rule |
| [`subscription-lifecycle.md`](subscription-lifecycle.md) | Trial, upgrade/downgrade, cancellation, payment failure, Dashboard-originated changes |
| [`data-preservation.md`](data-preservation.md) | The non-destructive-downgrade invariant |
| [`portfolio-and-entitlements.md`](portfolio-and-entitlements.md) | Exists / editable / publicly displayable |
| [`admin-grants.md`](admin-grants.md) | Non-billing access grants and their audit expectations |
| [`coupons-and-promotions.md`](coupons-and-promotions.md) | The V1 discount/promotion boundary |
| [`decisions/`](decisions/README.md) | Finalized rulings, each with an ID and a rationale |
| [`open-decisions.md`](open-decisions.md) | Questions, with what each blocks |
| [`future.md`](future.md) | Direction, clearly marked unbuilt |

Related, outside this directory:

| Document | Contents |
| --- | --- |
| [`architecture/subscription/`](../../../architecture/subscription/README.md) | How this is built |
| [`architecture/domain/subscription/`](../../../architecture/domain/subscription/README.md) | The conceptual domain model |
| [`architecture/decisions/subscription-billing.md`](../../../architecture/decisions/subscription-billing.md) | The founding architectural decision record |
| [`kizunia-authorization-compressed-wind.md`](../../../temp/kizunia-authorization-compressed-wind.md) | The authorization-readiness audit this design builds on (scratch, not authoritative) |

---

## Source material

Derived from three working documents in `docs/temp/` (a scratch directory, not authoritative),
reconciled against current official Razorpay documentation:

| Source | Contributed |
| --- | --- |
| `suscriptions.md` | Plan tiers and quotas, entitlement-source philosophy, data-preservation invariants, the original open-decisions list |
| `razorpay-feasibility-audit.md` | First-pass Razorpay capability research; several of its own flagged uncertainties, re-verified below |
| `kizunia-authorization-compressed-wind.md` | Confirmation of the existing, already-wired entitlement seams this design plugs into |

Where the reconciling direction changed or clarified the original product doc (payment-failure
handling, upgrade/downgrade/cancellation timing, coupon scope), that resolution is recorded in
[`decisions/reconciliations.md`](decisions/reconciliations.md) rather than silently applied.

---

## Keeping this live

When subscription *behavior* changes, this tree changes and a ruling is recorded in
[`decisions/`](decisions/README.md). When the *mechanism* changes, only
[`docs/architecture/subscription/`](../../../architecture/subscription/README.md) changes.

> Code and documentation should not intentionally drift apart.
