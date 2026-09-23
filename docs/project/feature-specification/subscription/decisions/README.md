# Decision Register

> **Status:** Live
>
> **Last Updated:** 2026-09-24

This is the **authoritative record** of finalized decisions for Subscription & Billing — both
product decisions and the engineering decisions made to resolve them against Razorpay's actual
capabilities. Where any other document disagrees with a ruling here, the ruling wins.

Every ruling is additionally tagged by category, because this design set exists specifically to
keep three kinds of statement from being confused with each other:

| Tag | Means |
| --- | --- |
| **[PRODUCT]** | A decision about what Kizunia's membership system does, independent of any provider |
| **[ENGINEERING]** | A decision about how to build it, often resolving a product requirement against a verified Razorpay constraint |
| **[RAZORPAY FACT]** | Not a decision at all — a documented Razorpay behavior the ruling next to it depends on. Facts are cited in full, with sources, in [`../../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../../architecture/subscription/provider-boundary/razorpay-facts.md); rulings here link to the specific fact rather than restating it |

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
| `SB-RC-xx` | Reconciliation and provider synchronization | [reconciliation.md](reconciliation.md) |
| `SB-PB-xx` | Provider boundary and environments | [provider-boundary-and-environments.md](provider-boundary-and-environments.md) |
| `SB-UQ-xx` | Subscription uniqueness and resubscription | [uniqueness-and-resubscription.md](uniqueness-and-resubscription.md) |
| `SB-CM-xx` | Commands (outbound provider mutations) and idempotency | [commands-and-idempotency.md](commands-and-idempotency.md) |

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
| SB-EA-01 | ENGINEERING | Free has no Subscription record — *Amended 2026-09-24: Free is never stored; a Free user may still have terminal or non-contributing rows* |
| SB-EA-02 | PRODUCT | Effective access is the highest currently valid entitlement across all sources |
| SB-EA-03 | ENGINEERING | Entitlement sources coexist as independent records; none overwrites another |
| SB-EA-04 | PRODUCT | Admin platform-role bypass is not an entitlement source |
| SB-EA-05 | ENGINEERING | Feature code checks capabilities, never Razorpay-derived fields directly |
| SB-EA-06 | ENGINEERING | Effective access takes the maximum over every contributing Subscription |
| SB-EA-07 | ENGINEERING | A Subscription contributes only in the provider mode it was created in |
| SB-EA-08 | PRODUCT | Administrators cannot grant access to themselves |
| SB-EA-09 | ENGINEERING | Grant expiry is derived when read, never written by a read |

### Lifecycle — [lifecycle.md](lifecycle.md)

| ID | Category | Decision |
| --- | --- | --- |
| SB-LC-01 | ENGINEERING | Trial is Razorpay-native only; no separate no-card trial system |
| SB-LC-02 | ENGINEERING | Upgrades apply immediately, with Razorpay's automatic prorated charge — *Amended 2026-09-24: paid→paid only, only where Razorpay supports it, access follows synced state* |
| SB-LC-03 | ENGINEERING | Downgrades take effect at the end of the current billing cycle — *Amended 2026-09-24: paid→paid only; Pro→Free is SB-LC-04* |
| SB-LC-04 | PRODUCT | Cancellation defaults to end-of-cycle, not immediate — *Amended 2026-09-24: immediate during a trial* |
| SB-LC-05 | PRODUCT | Immediate cancellation is an explicit admin/support action, not the customer default |
| SB-LC-06 | PRODUCT | A Dashboard-originated change is a normal lifecycle path, not an edge case — *Amended 2026-09-24: includes customer (UPI app) changes* |
| SB-LC-07 | PRODUCT | Razorpay decides whether a plan change is possible; no Kizunia workaround where it cannot |
| SB-LC-08 | ENGINEERING | At most one scheduled change, and cancellation always wins |
| SB-LC-09 | PRODUCT | A requested cycle-end cancellation cannot be undone |
| SB-LC-10 | ENGINEERING | Subscription kind is recorded at creation, never inferred |
| SB-LC-11 | PRODUCT | One trial per account |

### Payment failure and recovery — [payment-failure-and-recovery.md](payment-failure-and-recovery.md)

| ID | Category | Decision |
| --- | --- | --- |
| SB-PF-01 | ENGINEERING | Kizunia does not run a second payment-retry or grace-period engine |
| SB-PF-02 | ENGINEERING | `pending` retains full paid access — *Amended 2026-09-24: own phase `PAST_DUE`* |
| SB-PF-03 | ENGINEERING | `halted` ends paid access but never cancels the underlying subscription — *Amended 2026-09-24: never automatically; user-confirmed supersession only* |
| SB-PF-04 | ENGINEERING | Un-halting restores paid access automatically and non-destructively |
| SB-PF-05 | ENGINEERING | Synchronization of a halted subscription decays; it never stops |

### Data preservation — [data-preservation.md](data-preservation.md)

| ID | Category | Decision |
| --- | --- | --- |
| SB-DP-01 | PRODUCT | Downgrade never deletes projects, portfolios, or preferences |
| SB-DP-02 | PRODUCT | Portfolio visibility is never overridden by entitlement loss |
| SB-DP-03 | ENGINEERING | Portfolio public-eligibility is a second, independent gate alongside visibility |
| SB-DP-04 | PRODUCT | Billing records survive account removal |

### Coupons and promotions — [coupons-and-promotions.md](coupons-and-promotions.md)

| ID | Category | Decision |
| --- | --- | --- |
| SB-CP-01 | PRODUCT | Billing discounts use Razorpay Offers; free-access grants use Promotions; never conflated |
| SB-CP-02 | PRODUCT | No generic coupon engine in V1 |
| SB-CP-03 | ENGINEERING | Offers are pre-provisioned from a fixed catalog of discount shapes |
| SB-CP-04 | ENGINEERING | Code eligibility is checked against the user's own history, and redemption is atomic |
| SB-CP-05 | RAZORPAY FACT | An Offer can be linked to an active subscription, effective at cycle end (not exposed in V1) |

### Webhook reliability — [webhooks-and-reliability.md](webhooks-and-reliability.md)

| ID | Category | Decision |
| --- | --- | --- |
| SB-WH-01 | ENGINEERING | Signature is verified against the raw body before anything else happens |
| SB-WH-02 | ENGINEERING | Every received event is persisted with a unique-constraint dedupe key before acknowledgement |
| SB-WH-03 | ENGINEERING | State-changing events trigger an authoritative refetch rather than trusting the payload — *Amended 2026-09-24: coalesced, stale-apply guarded* |
| SB-WH-04 | ENGINEERING | Charges are recorded as append-only facts, separate from current state |
| SB-WH-05 | ENGINEERING | Acknowledgement happens before asynchronous processing, not after — *Amended 2026-09-24: sync-due marker plus immediate `after()` sync; no daily-drain dependency* |
| SB-WH-06 | ENGINEERING | Events for unknown subscriptions are persisted and matched, never dropped |
| SB-WH-07 | ENGINEERING | The previous webhook secret is accepted during a rotation window |
| SB-WH-08 | ENGINEERING | Kizunia subscribes only to the events it acts on |

### Reconciliation and provider synchronization — [reconciliation.md](reconciliation.md)

| ID | Category | Decision |
| --- | --- | --- |
| SB-RC-01 | ENGINEERING | A periodic job re-fetches authoritative state for locally-active paid subscriptions — *Amended 2026-09-24: all non-terminal, due-based, budgeted* |
| SB-RC-02 | ENGINEERING | A webhook-processing failure after signature verification triggers on-demand reconciliation — *Superseded 2026-09-24 by SB-RC-04* |
| SB-RC-03 | ENGINEERING | Reconciliation corrections are applied transactionally and recorded in history |
| SB-RC-04 | ENGINEERING | One synchronization mechanism serves webhooks, commands and reconciliation |
| SB-RC-05 | ENGINEERING | Reconciliation is due-based, not a sweep |
| SB-RC-06 | ENGINEERING | All outbound Razorpay calls share one bounded request budget |
| SB-RC-07 | ENGINEERING | Provider failures back off, and never change local state |
| SB-RC-08 | ENGINEERING | A synchronization result is applied only if it is newer than the last one applied |
| SB-RC-09 | ENGINEERING | Provider subscriptions Kizunia lost track of are found by a bounded scan |
| SB-RC-10 | ENGINEERING | Synchronization only reads; it never changes provider state |

### Provider boundary and environments — [provider-boundary-and-environments.md](provider-boundary-and-environments.md)

| ID | Category | Decision |
| --- | --- | --- |
| SB-PB-01 | ENGINEERING | The provider boundary is sized to actual needs, not built as a generic framework — *Amended 2026-09-24: operation list extended* |
| SB-PB-02 | ENGINEERING | Provider mode (disabled/test/live) is resolved once at boot |
| SB-PB-03 | PRODUCT | Disabled is a fully supported production state |
| SB-PB-04 | ENGINEERING | Razorpay identifiers never leak past the provider boundary — *Amended 2026-09-24: one record per provider subscription; raw provider state kept inside the billing module* |
| SB-PB-05 | ENGINEERING | Provider plan IDs map to Kizunia plans through a per-mode catalog, many-to-one |
| SB-PB-06 | PRODUCT | Billing execution is scheduler-agnostic; Vercel Pro is not a prerequisite |

### Subscription uniqueness and resubscription — [uniqueness-and-resubscription.md](uniqueness-and-resubscription.md)

| ID | Category | Decision |
| --- | --- | --- |
| SB-UQ-01 | ENGINEERING | A Subscription is one Razorpay subscription, bound once |
| SB-UQ-02 | ENGINEERING | Kizunia never creates a second open subscription for a user |
| SB-UQ-03 | PRODUCT | A new purchase while a paid subscription is live is refused, not duplicated |
| SB-UQ-04 | PRODUCT | A halted or paused subscription is superseded only by a confirmed cancellation |
| SB-UQ-05 | ENGINEERING | Multiple open subscriptions arising outside Kizunia are detected, never silently resolved |

### Commands and idempotency — [commands-and-idempotency.md](commands-and-idempotency.md)

| ID | Category | Decision |
| --- | --- | --- |
| SB-CM-01 | ENGINEERING | Every mutating provider call is a recorded billing operation; one in flight per user |
| SB-CM-02 | ENGINEERING | The local record is written before the provider call |
| SB-CM-03 | ENGINEERING | An outcome-unknown command is resolved by observation, never by blind retry |
| SB-CM-04 | ENGINEERING | Client retries and multiple tabs resolve to the same operation |
| SB-CM-05 | ENGINEERING | Command responses are applied through the same path as synchronization |
| SB-CM-06 | ENGINEERING | Checkout confirmation syncs only the caller's own subscription |

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
| Current official Razorpay documentation (verified 2026-09-21, re-verified 2026-09-24) | `SB-LC`, `SB-PF`, `SB-WH`, `SB-RC`, `SB-PB`, `SB-UQ`, `SB-CM` — see [`../../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../../architecture/subscription/provider-boundary/razorpay-facts.md) |
| `docs/temp/suscriptions-issues.md` (2026-09-24 review input) | `SB-UQ`, `SB-RC-04`–`SB-RC-10`, and the amendments recorded in [reconciliations.md](reconciliations.md) R-04–R-06 |
| `docs/temp/kizunia-authorization-compressed-wind.md` | `SB-DP-02`/`SB-DP-03` (the portfolio gap), `SB-EA-04`/`SB-EA-05` (existing seams) |
