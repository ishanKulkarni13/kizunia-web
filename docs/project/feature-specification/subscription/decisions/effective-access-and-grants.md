# Rulings — Effective Access and Grants

> **Status:** Live
>
> **Last Updated:** 2026-09-24

---

## SB-EA-01 — Free has no Subscription record

**Status:** Amended — 2026-09-24, see the end of this ruling

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

**Amended (2026-09-24):** The statement and its consequence contradicted each other (a user whose
subscription was cancelled is Free *and* has a Subscription row). Restated precisely:

- **`FREE` is never stored.** It is what resolution returns when no source contributes.
- **A user who has never started a checkout has no billing rows at all.** Resolving their access
  reads two empty indexed lookups and touches nothing provider-related.
- **A user may be Free and still have Subscription rows** — terminal ones (`CANCELLED`, `EXPIRED`,
  `COMPLETED`, `ABANDONED`), or non-contributing open ones (`PROVISIONING`, `PENDING_AUTHENTICATION`,
  `HALTED`, `PAUSED`). A row exists from the moment a checkout is started, because the local record
  is written before the provider call ([SB-CM-02](commands-and-idempotency.md#sb-cm-02--the-local-record-is-written-before-the-provider-call)).
  Such rows are history and sync state, never a "Free record".

The property the ruling exists for — Free requires zero Razorpay dependency — is unchanged.

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

**Status:** Amended — 2026-09-24 (scope of the bypass: interactive gates only), see below

**Decision:** `PlatformAccess.canBypassAuthorization` (the existing `ADMIN`/`SUPER_ADMIN` bypass) is
not modeled as contributing `PRO_PLUS` to an administrator's effective access. It remains a
separate, orthogonal authorization concept.

**Rationale:** The authorization audit confirms this separation already holds cleanly in the
codebase today (`kizunia-authorization-compressed-wind.md` §12, §21) and the product direction
requires it stay that way (`suscriptions.md` §17, §81) — an administrator's ability to use a
feature must never be reported as "this administrator has a Pro+ customer subscription."

**Amended (2026-09-24) — product decision (owner), decision close-out
[IB-7](../../../../architecture/subscription/implementation/open-decisions.md#ib-7--admin-bypass-of-entitlement-gates):**
the **scope** of the bypass is now defined. **Interactive gates only.**

- An `ADMIN` or `SUPER_ADMIN` bypasses the entitlement gates they hit directly in a request: the
  owned-project quota, portfolio creation and MCP tool access. The bypass uses the existing
  `.platformOverride()` step of the resource policies, so it covers `ADMIN`/`SUPER_ADMIN` and not
  `MODERATOR`.
- **Background eligibility has no bypass.** Deadline and recommendation notifications are decided
  with no actor present. An administrator who wants them receives an explicit admin grant from
  another administrator ([SB-EA-08](#sb-ea-08--administrators-cannot-grant-access-to-themselves)
  still forbids self-grants).
- Public portfolio display follows the **owner's** effective access, never their role.

*Rationale:* admins already use interactive features such as MCP competition management through the
same override. Background jobs have no actor to evaluate a role against. Keeping the bypass out of
entitlement resolution preserves this ruling's original separation.

## SB-EA-05 — Feature code checks capabilities, never Razorpay-derived fields directly

**Status:** Accepted

**Decision:** No feature module (Portfolio, Notifications, Recommendations, MCP, Projects) ever
inspects a Razorpay status string, plan ID, or subscription ID to decide access. All of them
consume the resolved effective-access/capability result only.

**Rationale:** This is the provider-boundary principle applied at the consumption side — see
[SB-PB-04](provider-boundary-and-environments.md#sb-pb-04--razorpay-identifiers-never-leak-past-the-provider-boundary)
and [`../../../../architecture/subscription/provider-boundary/identifiers.md`](../../../../architecture/subscription/provider-boundary/identifiers.md).

## SB-EA-06 — Effective access takes the maximum over every contributing Subscription

**Status:** Accepted

**Decision:** Effective access is the highest tier among **all** of the user's Subscriptions whose
phase contributes (`TRIALING`, `ACTIVE`, `PAST_DUE`) and all currently valid grants — never "the
user's current Subscription". Resolution never selects one Subscription among several.

**Rationale:** Under [SB-UQ-02](uniqueness-and-resubscription.md#sb-uq-02--kizunia-never-creates-a-second-open-subscription-for-a-user)
Kizunia never creates two open subscriptions, but Razorpay-side events can still produce them
([SB-UQ-05](uniqueness-and-resubscription.md#sb-uq-05--multiple-open-subscriptions-arising-outside-kizunia-are-detected-never-silently-resolved)).
A resolver that reads "the current subscription" has undefined behavior exactly then — it depends
on row order. Taking the maximum is deterministic, is already the rule between subscriptions and
grants ([SB-EA-02](#sb-ea-02--effective-access-is-the-highest-currently-valid-entitlement-across-all-sources)),
and never gives a paying user less than they pay for.

## SB-EA-07 — A Subscription contributes only in the provider mode it was created in

**Status:** Accepted

**Decision:** Every Subscription records the provider mode (`test` or `live`) it was created in.
Each deployment has an **expected billing mode** — `live` for production, `test` everywhere else —
configured independently of whether credentials are present. A Subscription contributes access only
if its mode equals the deployment's expected billing mode. So a production deployment that is
temporarily `disabled` still honors its `live` subscriptions
([SB-PB-03](provider-boundary-and-environments.md#sb-pb-03--disabled-is-a-fully-supported-production-state)),
and a `test` subscription never grants access in production. Synchronization runs only for
Subscriptions whose mode equals the currently resolved provider mode; any other mismatch raises a
`PROVIDER_MODE_MISMATCH` anomaly.

**Rationale:** [RAZORPAY FACT] Test and live keys are non-interchangeable and webhook payloads carry
no mode flag ([razorpay-facts](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#test-vs-live-mode)).
A database restored from staging into production, or a test subscription created against the wrong
database, would otherwise grant real access from a test payment and then fail synchronization
forever. Stamping the mode makes this impossible by construction rather than by operational care.
The deployment's own environment (production or not) decides how `disabled` is interpreted — see
[`environments.md`](../../../../architecture/subscription/provider-availability/environments.md).

## SB-EA-08 — Administrators cannot grant access to themselves

**Status:** Accepted

**Decision:** Creating or extending an `EntitlementGrant` whose recipient is the acting
administrator is refused. Every grant action records actor, recipient, plan, validity window and a
mandatory reason.

**Rationale:** A grant is money-equivalent. Self-grants are the simplest privilege-escalation path in
an admin tool and are never needed: an administrator already has
[platform bypass](#sb-ea-04--admin-platform-role-bypass-is-not-an-entitlement-source) for
operational access, and one administrator can grant another when a customer-side entitlement is
genuinely needed. Refusing it costs nothing and removes a class of audit questions.

## SB-EA-09 — Grant expiry is derived when read, never written by a read

**Status:** Accepted

**Decision:** A grant stops contributing when `now` passes its `validUntil`; this is evaluated by
the resolver and never persisted as a side effect of resolving access. A grant's stored status is
`ACTIVE` or `REVOKED` only; "expired" is a derived, displayed property.

**Rationale:** The earlier design had "whatever process next resolves that user's access" set
`status = EXPIRED`. That turns every authorization check into a potential write — on the hottest read
path in the application, concurrently from many requests — for no behavioral benefit. A derived
property cannot become stale; a stored one written opportunistically can.
