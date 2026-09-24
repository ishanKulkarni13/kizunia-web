# Rulings — Data Preservation

> **Status:** Live
>
> **Last Updated:** 2026-09-24

---

## SB-DP-01 — Downgrade never deletes projects, portfolios, or preferences

**Status:** Accepted

**Decision:** See [`../data-preservation.md`](../data-preservation.md) for the full statement and
worked examples across projects, portfolio, notification preferences, and MCP configuration.

**Rationale:** Stated as an explicit, repeated invariant in the original product doc
(`suscriptions.md` §11, §66, §78, §79) and restated as non-negotiable in this design's source
instructions. Preserved without modification.

## SB-DP-02 — Portfolio visibility is never overridden by entitlement loss

**Status:** Accepted

**Decision:** A user's own `Portfolio.visibility` preference (`PUBLIC`/`PRIVATE`) is never changed
by Kizunia in response to an entitlement change. Losing Pro never flips a Pro user's portfolio to
`PRIVATE`; regaining Pro never needs to flip it back.

**Rationale:** The authorization audit identified this as a genuine, unresolved data-model gap
(`kizunia-authorization-compressed-wind.md` §7, §17): Portfolio had no independent "publicly
displayable" axis, only the owner's own `visibility`. The alternative — forcing `visibility` to
`PRIVATE` on downgrade — would silently overwrite a user's own preference and require correctly
restoring it later, which is exactly the kind of state that is easy to get wrong on the "restore"
side. See [SB-DP-03](#sb-dp-03--portfolio-public-eligibility-is-a-second-independent-gate-alongside-visibility).

## SB-DP-03 — Portfolio public-eligibility is a second, independent gate alongside visibility

**Status:** Amended — 2026-09-24 (rationale corrected: the eligibility read is asynchronous), see below

**Decision:** Whether a portfolio is actually shown at its public URL requires **both**
`visibility === PUBLIC` **and** an entitlement-driven "publicly displayable" check to pass. Neither
one is derived from or overwrites the other.

**Rationale:** [ENGINEERING] The codebase already has exactly this seam, unused:
`portfolio/backend/authorization/public-eligibility.ts`'s `resolvePortfolioPublicEligibility()`,
which today always returns `true` and is explicitly commented as "the seam a future Plan/Entitlement
system will gate," already consumed by `PortfolioPolicy.canView` as a second, sequential check after
`visibility`. Wiring effective access into this exact function requires no new schema field and no
change to `PortfolioPolicy`'s shape — see
[`../../../../architecture/subscription/entitlements/authorization-integration.md`](../../../../architecture/subscription/entitlements/authorization-integration.md#portfolio-public-eligibility).
This resolves the audit's flagged gap with the smallest possible change, rather than the
schema-adding alternatives the audit itself considered.

**Amended (2026-09-24) — engineering decision (autonomous), decision close-out
[IB-5](../../../../architecture/subscription/implementation/open-decisions.md#ib-5--async-portfolio-public-eligibility):**
the rationale's "requires … no change to `PortfolioPolicy`'s shape" still holds, but the eligibility
function **does** change signature. It is called from the synchronous context resolver, and an
entitlement read is asynchronous I/O. Eligibility, meaning the **owner's** effective access, is
therefore computed asynchronously before the portfolio context is built and passed into it. The
decision itself (two independent gates, visibility never overwritten) is unchanged.

## SB-DP-04 — Billing records survive account removal

**Status:** Amended — 2026-09-24 (storage decided; removal workflow deferred); retention period open ([B3](../open-decisions.md#b-genuinely-open-product-questions))

**Decision:** Billing records — `Subscription`, `SubscriptionHistoryEntry`, `BillingOperation`,
`BillingEvent`, charge facts, and grant audit entries — are never removed by a database cascade
from `User`. Removing a user account:

1. is refused while the user has any open Subscription
   ([SB-UQ-02](uniqueness-and-resubscription.md#sb-uq-02--kizunia-never-creates-a-second-open-subscription-for-a-user));
   the account-removal flow first cancels it immediately (a recorded command) and waits for the
   cancellation to be confirmed by sync;
2. then pseudonymizes the billing records (the user reference is replaced by an opaque, non-reversible
   identifier) instead of deleting them;
3. deletes raw webhook payloads older than the payload retention horizon (180 days by default) on the
   normal schedule, keeping the event metadata.

**Rationale:** The Better Auth `admin()` plugin enabled in `next/src/lib/auth.ts` exposes user
removal, and the schema's widespread `onDelete: Cascade` would delete a user's billing rows along
with them — while Razorpay, which knows nothing of the deletion, keeps charging the customer.
Refusing removal while billing is open prevents charging someone who no longer has an account;
pseudonymization keeps the financial history needed for disputes and accounting without keeping
the person's identity attached. Unlike [SB-DP-01](#sb-dp-01--downgrade-never-deletes-projects-portfolios-or-preferences),
this concerns account removal, not downgrade.

**Amended (2026-09-24) — engineering decision (autonomous), decision close-out
[IB-14](../../../../architecture/subscription/implementation/open-decisions.md#ib-14--account-removal-storage):**

- **Storage is decided.** Every billing and entitlement table references the user through a
  **nullable** `userId` with `onDelete: Restrict`, plus a `subjectPseudonym` column. Actor columns are
  plain strings, not foreign keys. A hard delete of a user who has billing or grant rows is refused by
  the database.
- **The removal workflow (steps 1–3 above) is deferred** until the platform has an account-deletion
  feature. Kizunia has none today: no deletion route or hook, only Better Auth's admin `remove-user`,
  which fails safely against `Restrict`.
- The retention period (B3) remains open and blocks only that workflow.
