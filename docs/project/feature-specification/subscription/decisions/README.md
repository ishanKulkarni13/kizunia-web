# Decision Register

> **Status:** Live
>
> **Last Updated:** 2026-09-21

This is the **authoritative record** of finalized decisions for Subscription & Billing — both
product decisions and the engineering decisions made to resolve them against Razorpay's actual
capabilities. Where any other document disagrees with a ruling here, the ruling wins.

Every ruling is additionally tagged by category, because this design set exists specifically to
keep three kinds of statement from being confused with each other:

| Tag | Means |
| --- | --- |
| **[PRODUCT]** | A decision about what Kizunia's membership system does, independent of any provider |
| **[ENGINEERING]** | A decision about how to build it, often resolving a product requirement against a verified Razorpay constraint |
| **[RAZORPAY FACT]** | Not a decision at all — a documented Razorpay behavior the ruling next to it depends on. Facts are cited in full, with sources, in [`../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../architecture/subscription/provider-boundary/razorpay-facts.md); rulings here link to the specific fact rather than restating it |

## How rulings work

Every ruling has:

- **An ID** — stable, never reused, referenced from elsewhere instead of restating the rule.
- **A statement** — what was decided, in one or two sentences.
- **A rationale** — why. A rule without a recorded reason gets re-litigated every six months.
- **A status** — `Accepted`, `Amended` (with a pointer), or `Superseded` (with a pointer).

ID prefixes map to topic files:

| Prefix | Topic | File |
| --- | --- | --- |
| `SB-PL-xx` | Plans and quotas | [plans-and-quotas.md](plans-and-quotas.md) |
| `SB-EA-xx` | Effective access and entitlement sources (including grants) | [effective-access-and-grants.md](effective-access-and-grants.md) |
| `SB-LC-xx` | Lifecycle: trial, upgrade, downgrade, cancellation, Dashboard changes | [lifecycle.md](lifecycle.md) |
| `SB-PF-xx` | Payment failure and recovery | [payment-failure-and-recovery.md](payment-failure-and-recovery.md) |
| `SB-DP-xx` | Data preservation | [data-preservation.md](data-preservation.md) |
| `SB-CP-xx` | Coupons and promotions | [coupons-and-promotions.md](coupons-and-promotions.md) |
| `SB-WH-xx` | Webhook reliability | [webhooks-and-reliability.md](webhooks-and-reliability.md) |
| `SB-RC-xx` | Reconciliation | [reconciliation.md](reconciliation.md) |
| `SB-PB-xx` | Provider boundary and environments | [provider-boundary-and-environments.md](provider-boundary-and-environments.md) |

## Rules for changing this register

1. **Amend, do not silently rewrite.** A changed decision keeps its ID and gains an amendment note.
   A reversed decision is marked `Superseded` and points at its replacement.
2. **A ruling and its prose ship together.** Changing a rule here without updating the document
   that explains it is an incomplete change.
3. **Open questions do not live here.** They live in [`../open-decisions.md`](../open-decisions.md)
   until answered; answering one creates a ruling here and deletes the open item.
4. **Speculation does not live here.** Direction lives in [`../future.md`](../future.md).

---

## Register

### Plans and quotas — [plans-and-quotas.md](plans-and-quotas.md)

| ID | Category | Decision |
| --- | --- | --- |
| SB-PL-01 | PRODUCT | Three plans at launch — Free, Pro, Pro+ — with Monthly/Yearly cycles on paid plans |
| SB-PL-02 | PRODUCT | Capabilities are checked, never plan names, in feature code |
| SB-PL-03 | PRODUCT | Project quotas count ownership only, never membership |
| SB-PL-04 | PRODUCT | The feature matrix is a starting configuration, not permanent |
| SB-PL-05 | PRODUCT | Recommendations require Pro+, not Pro |

### Effective access and grants — [effective-access-and-grants.md](effective-access-and-grants.md)

| ID | Category | Decision |
| --- | --- | --- |
| SB-EA-01 | ENGINEERING | Free has no Subscription record |
| SB-EA-02 | PRODUCT | Effective access is the highest currently valid entitlement across all sources |
| SB-EA-03 | ENGINEERING | Entitlement sources coexist as independent records; none overwrites another |
| SB-EA-04 | PRODUCT | Admin platform-role bypass is not an entitlement source |
| SB-EA-05 | ENGINEERING | Feature code checks capabilities, never Razorpay-derived fields directly |

### Lifecycle — [lifecycle.md](lifecycle.md)

| ID | Category | Decision |
| --- | --- | --- |
| SB-LC-01 | ENGINEERING | Trial is Razorpay-native only; no separate no-card trial system |
| SB-LC-02 | ENGINEERING | Upgrades apply immediately, with Razorpay's automatic prorated charge |
| SB-LC-03 | ENGINEERING | Downgrades take effect at the end of the current billing cycle |
| SB-LC-04 | PRODUCT | Cancellation defaults to end-of-cycle, not immediate |
| SB-LC-05 | PRODUCT | Immediate cancellation is an explicit admin/support action, not the customer default |
| SB-LC-06 | PRODUCT | A Dashboard-originated change is a normal lifecycle path, not an edge case |

### Payment failure and recovery — [payment-failure-and-recovery.md](payment-failure-and-recovery.md)

| ID | Category | Decision |
| --- | --- | --- |
| SB-PF-01 | ENGINEERING | Kizunia does not run a second payment-retry or grace-period engine |
| SB-PF-02 | ENGINEERING | `pending` retains full paid access |
| SB-PF-03 | ENGINEERING | `halted` ends paid access but never cancels the underlying subscription |
| SB-PF-04 | ENGINEERING | Un-halting restores paid access automatically and non-destructively |

### Data preservation — [data-preservation.md](data-preservation.md)

| ID | Category | Decision |
| --- | --- | --- |
| SB-DP-01 | PRODUCT | Downgrade never deletes projects, portfolios, or preferences |
| SB-DP-02 | PRODUCT | Portfolio visibility is never overridden by entitlement loss |
| SB-DP-03 | ENGINEERING | Portfolio public-eligibility is a second, independent gate alongside visibility |

### Coupons and promotions — [coupons-and-promotions.md](coupons-and-promotions.md)

| ID | Category | Decision |
| --- | --- | --- |
| SB-CP-01 | PRODUCT | Billing discounts use Razorpay Offers; free-access grants use Promotions; never conflated |
| SB-CP-02 | PRODUCT | No generic coupon engine in V1 |
| SB-CP-03 | ENGINEERING | Offers are pre-provisioned from a fixed catalog of discount shapes |

### Webhook reliability — [webhooks-and-reliability.md](webhooks-and-reliability.md)

| ID | Category | Decision |
| --- | --- | --- |
| SB-WH-01 | ENGINEERING | Signature is verified against the raw body before anything else happens |
| SB-WH-02 | ENGINEERING | Every received event is persisted with a unique-constraint dedupe key before acknowledgement |
| SB-WH-03 | ENGINEERING | State-changing events trigger an authoritative refetch rather than trusting the payload |
| SB-WH-04 | ENGINEERING | Charges are recorded as append-only facts, separate from current state |
| SB-WH-05 | ENGINEERING | Acknowledgement happens before asynchronous processing, not after |

### Reconciliation — [reconciliation.md](reconciliation.md)

| ID | Category | Decision |
| --- | --- | --- |
| SB-RC-01 | ENGINEERING | A periodic job re-fetches authoritative state for locally-active paid subscriptions |
| SB-RC-02 | ENGINEERING | A webhook-processing failure after signature verification triggers on-demand reconciliation |
| SB-RC-03 | ENGINEERING | Reconciliation corrections are applied transactionally and recorded in history |

### Provider boundary and environments — [provider-boundary-and-environments.md](provider-boundary-and-environments.md)

| ID | Category | Decision |
| --- | --- | --- |
| SB-PB-01 | ENGINEERING | The provider boundary is sized to actual needs, not built as a generic framework |
| SB-PB-02 | ENGINEERING | Provider mode (disabled/test/live) is resolved once at boot |
| SB-PB-03 | PRODUCT | Disabled is a fully supported production state |
| SB-PB-04 | ENGINEERING | Razorpay identifiers never leak past the provider boundary |

---

## Reconciliations

Where the reconciling direction in this design changed or clarified the original product-decision
document, that is recorded in [reconciliations.md](reconciliations.md) rather than silently
applied.

## Source traceability

| Source document | Rulings derived |
| --- | --- |
| `docs/temp/suscriptions.md` | `SB-PL`, `SB-EA` (product half), `SB-DP`, `SB-CP` (product half) |
| `docs/temp/razorpay-feasibility-audit.md` | Early input into `SB-LC`, `SB-PF`, `SB-CP` (engineering half) — superseded where current Razorpay docs disagreed, see [reconciliations.md](reconciliations.md) |
| Current official Razorpay documentation (verified 2026-09-21) | `SB-LC`, `SB-PF`, `SB-WH`, `SB-RC`, `SB-PB` — see [`../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../architecture/subscription/provider-boundary/razorpay-facts.md) |
| `docs/temp/kizunia-authorization-compressed-wind.md` | `SB-DP-02`/`SB-DP-03` (the portfolio gap), `SB-EA-04`/`SB-EA-05` (existing seams) |
