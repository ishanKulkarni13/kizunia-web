# Rulings — Effective Access and Grants

> **Status:** Live
>
> **Last Updated:** 2026-09-21

---

## SB-EA-01 — Free has no Subscription record

**Status:** Accepted

**Decision:** A user with no active paid Subscription, no active grant, and no active trial has no
`Subscription` row at all. `FREE` is what effective-access resolution returns when no other source
is currently valid — it is not a stored state.

**Rationale:** This is the mechanism that makes "Free requires zero Razorpay dependency" literally
true rather than aspirational: resolving a Free user's access never queries, creates, or references
anything Razorpay-related. It also avoids the alternative the original product doc left explicitly
open (`suscriptions.md` §56) of giving every user an explicit Free membership record, which would
require deciding what that record's provider fields even mean.

**Consequence:** The overwhelming majority of users (everyone on Free) never have a billing-related
database row. A `Subscription` row only ever exists for a user who has, at some point, had a paid
relationship with Razorpay.

## SB-EA-02 — Effective access is the highest currently valid entitlement across all sources

**Status:** Accepted

**Decision:** See [`../entitlements-and-effective-access.md`](../entitlements-and-effective-access.md#the-highest-wins-rule)
for the full statement and worked examples.

**Rationale:** Stated as an explicit product decision in this design's source instructions and
consistent with the original product doc's Effective Access concept (`suscriptions.md` §38, §74),
which left the exact precedence rule open. Highest-wins is the simplest rule that satisfies every
worked example in the source material (an admin grant above a paid plan; a grant expiring and
falling back to the paid plan underneath) without needing a separate, harder-to-reason-about
precedence table.

## SB-EA-03 — Entitlement sources coexist as independent records

**Status:** Accepted

**Decision:** A paid Subscription and an admin grant (or trial, or promotion) are stored as
independent records. Granting a higher tier does not modify, pause, or overwrite the Subscription
underneath it; the Subscription keeps billing and keeps its own state throughout.

**Rationale:** Required by [SB-EA-02](#sb-ea-02--effective-access-is-the-highest-currently-valid-entitlement-across-all-sources) — if a grant overwrote the Subscription, the "grant
expires, effective access falls back to whatever the Subscription still provides" behavior the
product doc requires (`suscriptions.md` §74) would be impossible to reconstruct.

## SB-EA-04 — Admin platform-role bypass is not an entitlement source

**Status:** Accepted

**Decision:** `PlatformAccess.canBypassAuthorization` (the existing `ADMIN`/`SUPER_ADMIN` bypass) is
not modeled as contributing `PRO_PLUS` to an administrator's effective access. It remains a
separate, orthogonal authorization concept.

**Rationale:** The authorization audit confirms this separation already holds cleanly in the
codebase today (`kizunia-authorization-compressed-wind.md` §12, §21) and the product direction
requires it stay that way (`suscriptions.md` §17, §81) — an administrator's ability to use a
feature must never be reported as "this administrator has a Pro+ customer subscription."

## SB-EA-05 — Feature code checks capabilities, never Razorpay-derived fields directly

**Status:** Accepted

**Decision:** No feature module (Portfolio, Notifications, Recommendations, MCP, Projects) ever
inspects a Razorpay status string, plan ID, or subscription ID to decide access. All of them
consume the resolved effective-access/capability result only.

**Rationale:** This is the provider-boundary principle applied at the consumption side — see
[SB-PB-04](provider-boundary-and-environments.md#sb-pb-04--razorpay-identifiers-never-leak-past-the-provider-boundary)
and [`../../../architecture/subscription/provider-boundary/identifiers.md`](../../../architecture/subscription/provider-boundary/identifiers.md).
