# Documentation Structure

> **Status:** Stable
>
> **Last Updated:** 2026-09-21

This document answers three questions:

1. What does every folder and file in the Subscription & Billing documentation own?
2. What must each one **not** contain?
3. When I change something, where does the change go?

If you cannot answer question 3 from this page, the structure is wrong and this page should be
fixed — not worked around.

---

## The two trees, plus domain and ADR

```text
docs/project/feature-specification/subscription/        PRODUCT: what it does, and why
docs/architecture/subscription/                          TECHNICAL: how it is built to keep changing
docs/architecture/domain/subscription/                   DOMAIN: the conceptual entities
docs/architecture/decisions/subscription-billing.md      ADR: the founding architectural choice
```

Same split notification documentation already uses, and the same rule:

> A behavioral rule ("cancellation keeps paid access until the period already paid for ends") is
> product. A structural rule ("state-changing webhooks trigger an authoritative refetch instead of
> trusting the payload") is architecture. When a statement is genuinely both, the product tree
> states the behavior and the architecture tree links to it rather than restating it.

**The rule of one home.** Every fact has exactly one owning document; every other document links to
it. All finalized rulings — product *and* engineering — live in one place:
[`decisions/`](decisions/README.md), not scattered across both trees. The architecture tree
explains mechanism and *links to* the ruling that required it.

---

## Product tree

```text
subscription/
├── README.md                          index, reading order, premise
├── STRUCTURE.md                       this document
├── glossary.md                        canonical terminology
│
├── plans.md                           Free/Pro/Pro+, quotas, the feature matrix
├── entitlements-and-effective-access.md
├── subscription-lifecycle.md          trial, upgrade, downgrade, cancellation, payment failure, Dashboard-originated changes
├── data-preservation.md               the non-destructive-downgrade invariant
├── portfolio-and-entitlements.md      exists / editable / publicly displayable
├── admin-grants.md
├── coupons-and-promotions.md
│
├── decisions/
│   ├── README.md                      ID scheme + full register
│   ├── plans-and-quotas.md            SB-PL-xx
│   ├── effective-access-and-grants.md SB-EA-xx
│   ├── lifecycle.md                   SB-LC-xx (trial, upgrade/downgrade, cancellation)
│   ├── payment-failure-and-recovery.md SB-PF-xx
│   ├── data-preservation.md           SB-DP-xx
│   ├── coupons-and-promotions.md      SB-CP-xx
│   ├── webhooks-and-reliability.md    SB-WH-xx
│   ├── reconciliation.md              SB-RC-xx
│   ├── provider-boundary-and-environments.md SB-PB-xx
│   └── reconciliations.md             contradictions between source material and how each was resolved
│
├── open-decisions.md                  what is deliberately not decided yet
└── future.md                          one-time purchases, more plans, deeper MCP tiers, coupon stacking — not built now
```

### What each product area owns, and must not contain

| Folder / file | Owns | Must not contain |
| --- | --- | --- |
| `plans.md` | Plan tiers, quotas, the feature matrix, and the caveat that it is a starting configuration | Entitlement *resolution* logic — that is architecture |
| `entitlements-and-effective-access.md` | Entitlement sources and the highest-wins rule, in product terms | The resolver's implementation |
| `subscription-lifecycle.md` | User-visible lifecycle behavior | Razorpay API parameters, webhook names |
| `data-preservation.md` | The invariant and what it applies to | Schema fields |
| `portfolio-and-entitlements.md` | The three-state distinction and its product rationale | The `public-eligibility.ts` wiring — that is architecture |
| `admin-grants.md` | Why grants exist, product-facing behavior | Audit table shape |
| `coupons-and-promotions.md` | What V1 supports and explicitly does not | Razorpay Offer API parameters |
| `decisions/` | Finalized rulings, each with an ID and a rationale | Speculation, proposals, unresolved questions |
| `open-decisions.md` | Questions, with what each one blocks | Answers. An answered question becomes a ruling in `decisions/` |
| `future.md` | Direction, clearly marked unbuilt | Anything presented as current behavior |

---

## Architecture tree

See [`docs/architecture/subscription/README.md`](../../../architecture/subscription/README.md) for
its full reading order. In outline: `provider-boundary/` (the Razorpay boundary and verified
facts), `lifecycle/` (state mapping, trials, upgrade/downgrade, cancellation, payment failure,
Dashboard-originated changes), `entitlements/` (effective-access resolution, admin grants, quotas,
authorization wiring, coupons/offers), `webhooks/` (event catalog, security, reliability,
ordering), `reconciliation/`, `provider-availability/` (test/live/disabled), `history-and-audit/`,
`cross-cutting/` (observability, security, testing-without-Razorpay, future extensibility), and
`verification-checklist.md`.

---

## Where does my change go?

| The change is | It goes in |
| --- | --- |
| A new rule about what a plan includes | `plans.md` **and** a ruling in `decisions/plans-and-quotas.md` |
| A change to an existing rule | Amend the ruling in `decisions/`, then update the area that states it |
| A new word that needs a precise meaning | `glossary.md` |
| A change to how the provider boundary, webhooks, or reconciliation work | `docs/architecture/subscription/` only, linking to the ruling that required it |
| A question you cannot answer | `open-decisions.md`, with what it blocks |
| An answer to one of those questions | A ruling in `decisions/`, and delete the open item |
| Something the reconciling direction changed from the original product doc | `decisions/reconciliations.md` |

---

## Source material

See [`README.md`](README.md#source-material).
