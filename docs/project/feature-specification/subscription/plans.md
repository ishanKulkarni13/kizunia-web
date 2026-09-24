# Plans

> **Status:** Stable
>
> **Last Updated:** 2026-09-21

Three plans exist at launch: `FREE`, `PRO`, `PRO_PLUS`. Paid plans additionally choose a billing
cycle, `MONTHLY` or `YEARLY`. Razorpay has no "plan family" concept — monthly and yearly are two
distinct Razorpay Plan objects underneath, but that is a provider-boundary detail; see
[`../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../architecture/subscription/provider-boundary/razorpay-facts.md). Kizunia's own domain
never treats monthly and yearly Pro as different products — they are the same plan, a different
cycle.

> **This is a starting configuration, not a permanent one.** Which capability sits behind which
> plan is expected to change. The entitlement model exists precisely so that moving a capability
> between plans is a data change, not a code change — see
> [`entitlements-and-effective-access.md`](entitlements-and-effective-access.md).

---

## Feature matrix

| Capability | Free | Pro | Pro+ |
| --- | --- | --- | --- |
| Owned projects | 5 | 10 | 20 |
| Member of other projects | Unlimited | Unlimited | Unlimited |
| Create a portfolio | No | Yes | Yes |
| Competition deadline notifications | No | Yes | Yes |
| Competition recommendations | No | No | Yes |
| MCP access | No | No | Yes |
| Monthly billing | — | Yes | Yes |
| Yearly billing | — | Yes | Yes |

Every row is a **quota or capability**, resolved through effective access — never a literal
`if (plan === "PRO")` check anywhere in feature code. See
[`decisions/plans-and-quotas.md`](decisions/plans-and-quotas.md#sb-pl-02--capabilities-are-checked-not-plan-names).

---

## Ownership, not membership

The 5/10/20 project limit counts only projects where the user holds `ProjectMember.role = OWNER`.
Being a member (`MAINTAINER`/`CONTRIBUTOR`) of any number of other projects never counts against a
plan's quota. This distinction already exists in the codebase's `ProjectMember` model and is
preserved exactly as-is — no new ownership concept is introduced.

## MCP access is not a single boolean forever

Pro+ today grants MCP access as a single on/off capability. The model is expected to grow more
granular access levels later (see [`future.md`](future.md)) without requiring a redesign — MCP
already resolves capability through the same authorization chain the rest of the app uses, so a
finer-grained entitlement is an additional check on that chain, not a new system.

## Recommendations require Pro+, not Pro

Pro unlocks portfolio and deadline notifications but *not* competition recommendations. A Pro user
can still configure their recommendation-relevant preferences (competition preference profile) —
the notification subsystem already keeps preference configuration independent of delivery
eligibility (see [`entitlements-and-effective-access.md`](entitlements-and-effective-access.md#preferences-always-survive)) —
but the recommendation engine will not act on them until the user is Pro+.

---

## What is not decided here

Exact pricing (₹ amounts) is not part of this document set — it is a commercial decision made at
implementation time, not an architectural one. What plans include and their relative ordering
(Free < Pro < Pro+) is decided; the price attached to each cycle is not.

## Related rulings

[`decisions/plans-and-quotas.md`](decisions/plans-and-quotas.md).
