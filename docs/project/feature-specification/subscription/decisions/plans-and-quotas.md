# Rulings — Plans and Quotas

> **Status:** Live
>
> **Last Updated:** 2026-09-21

---

## SB-PL-01 — Three plans at launch, Monthly/Yearly on paid plans

**Status:** Accepted

**Decision:** `FREE`, `PRO`, `PRO_PLUS`. Paid plans additionally choose `MONTHLY` or `YEARLY`.
Monthly and yearly are the same product at a different cycle, never modeled as separate plans.

**Rationale:** Matches the original product direction exactly (`suscriptions.md` §1–§6). Treating
monthly/yearly as one plan with a cycle, rather than two plans, keeps the domain model from
doubling for no product reason — even though Razorpay itself represents them as two distinct Plan
objects underneath (see [`../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../architecture/subscription/provider-boundary/razorpay-facts.md)).

## SB-PL-02 — Capabilities are checked, not plan names

**Status:** Accepted

**Decision:** Feature code never checks `if (user.plan === "PRO")`. It checks a capability or quota
question (`canCreatePortfolio`, `ownedProjectLimit`) resolved from effective access.

**Rationale:** This is the entire reason an entitlement layer exists rather than a plan field on
the user. It is what lets a capability move between plans as a configuration change instead of a
code change — see [`../plans.md`](../plans.md).

## SB-PL-03 — Project quotas count ownership only

**Status:** Accepted

**Decision:** The 5/10/20 owned-project limit counts only `ProjectMember` rows with
`role = OWNER` for the acting user. Membership in any number of other projects never counts.

**Rationale:** This distinction already exists in the codebase (`ProjectMember.role`) and is
exactly what the authorization audit confirmed is ready to be queried for this purpose
(`kizunia-authorization-compressed-wind.md` §6, §21). No new concept is introduced.

## SB-PL-04 — The feature matrix is a starting configuration

**Status:** Accepted

**Decision:** Which capability sits behind which plan is not treated as fixed. The entitlement
model is the mechanism that makes moving a capability between plans a data change.

**Rationale:** Stated explicitly in the original product direction (`suscriptions.md` §7) and
reinforced by this design's own philosophy — see [SB-PL-02](#sb-pl-02--capabilities-are-checked-not-plan-names).

## SB-PL-05 — Recommendations require Pro+, not Pro

**Status:** Accepted

**Decision:** Competition deadline notifications are available to Pro and Pro+. Competition
recommendations are available only to Pro+. A Pro user may still configure recommendation-relevant
preferences; they simply produce no recommendation deliveries until Pro+.

**Rationale:** Matches the original product direction's feature matrix exactly
(`suscriptions.md` §6) and is consistent with the notification subsystem's existing
Preference-vs-Entitlement separation.
