# Subscription & Billing as an Independent Subsystem, Behind a Sized Provider Boundary

## Status

Accepted — 2026-09-21. **Amended — 2026-09-24** (see [Amendments](#amendments)). Not implemented.
Documentation-only phase; no code, schema, or migration exists yet.

---

# Context

Kizunia is adding paid membership: Free, Pro, and Pro+, billed through Razorpay. The product
direction (`docs/temp/suscriptions.md`) explicitly refused to prescribe implementation, listing as
non-goals the exact schema, the exact Razorpay integration, and the exact webhook architecture — and
required an architecture-audit phase before implementation could begin.

That audit (`docs/temp/kizunia-authorization-compressed-wind.md`) found something specific: the
codebase already contains inert, not-yet-wired entitlement seams — `lib/entitlements`'s
`resolveEntitlements()` stub, the rate-limit resolver's unused `entitlements` parameter, reserved
`UPGRADE_REQUIRED`/`FEATURE_DISABLED` authorization codes, and a live (if trivial)
`resolvePortfolioPublicEligibility()` gate. The verdict was "ready with changes" — no security
blocker, but a design that must decide how billing state becomes application access without
disturbing any of it.

The obvious implementation is proportionate to what Razorpay itself provides: a service that calls
Razorpay's API and a webhook route that updates a `plan` field on the user. It would work for the
happy path and it would be finished sooner.

It is rejected, for the same reason the notification subsystem's equivalent shortcut was rejected
(see [`notifications-subsystem.md`](notifications-subsystem.md)): the scope of what this area must
absorb is not the initial feature list. Billing is financially sensitive, webhooks are
adversarial-by-default infrastructure (duplicated, reordered, delayed, occasionally missing
entirely), Razorpay's own Dashboard is a second, uncoordinated writer of subscription state, and the
product requires multiple entitlement sources (paid, trial, admin grant, future promotion) to
coexist and be individually revocable without one clobbering another. A `plan` field on the user
model absorbs none of that.

---

# Decision

**Subscription & Billing is built as an independently bounded subsystem, behind a narrow,
Razorpay-specific provider boundary, with Kizunia owning all membership and entitlement state.**

Five commitments follow from that.

### 1. Razorpay is a billing provider, not the foundation of membership

Kizunia owns Free membership, plans, effective access, entitlements, quotas, and subscription
history — independent of whether Razorpay has ever been configured. Razorpay owns billing
mechanics: recurring charges, mandates, and provider-side billing lifecycle. See
[`../subscription/README.md`](../subscription/README.md).

### 2. Effective access is resolved once, from multiple coexisting sources

A Subscription (billing-linked) and an EntitlementGrant (admin grant, promotion) are independent
records; effective access is the highest currently valid tier across all of them, never one source
overwriting another. See
[`../domain/subscription/relationships.md`](../domain/subscription/relationships.md) and
[SB-EA-02](../../project/feature-specification/subscription/decisions/effective-access-and-grants.md#sb-ea-02--effective-access-is-the-highest-currently-valid-entitlement-across-all-sources).

### 3. The provider boundary is sized, not generic

Exactly the operations Kizunia needs — create/fetch/update/cancel a subscription, verify and parse a
webhook — and nothing built for hypothetical future providers. See
[SB-PB-01](../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-01--the-provider-boundary-is-sized-not-generic).

### 4. Webhooks are treated as an adversarial distributed-systems boundary, not a controller

Signature-verified, persisted with a unique-constraint dedupe key before acknowledgement,
acknowledged before asynchronous processing, and never trusted for state transitions without an
authoritative refetch — because Razorpay does not guarantee delivery order. See
[`../subscription/webhooks/README.md`](../subscription/webhooks/README.md).

### 5. Kizunia does not duplicate mechanics Razorpay already owns

No second payment-retry engine, no second grace-period timer, no generic coupon engine. Where
Razorpay's own lifecycle already provides reasonable behavior (retry-then-halt, cycle-end
cancellation, Offers), Kizunia reacts to it instead of rebuilding it. See
[`payment-failure-and-recovery.md`](../../project/feature-specification/subscription/decisions/payment-failure-and-recovery.md).

---

# Consequences

### Accepted costs

**A refetch on every state-changing webhook**, rather than trusting the payload. More API calls to
Razorpay than a naive implementation would make. Paid deliberately, because Razorpay's own
documentation states delivery order is not guaranteed.

**Two entitlement-source tables instead of one.** `Subscription` and `EntitlementGrant` could be
squeezed into one polymorphic table; two honest, narrower entities were chosen instead. See
[`../domain/subscription/overview.md`](../domain/subscription/overview.md).

**New audit-trail scaffolding.** The codebase has no generic `AuditLog` table to reuse for admin
grants or subscription history; this design adds purpose-built history tracking rather than waiting
for a generic audit system that does not exist.

### Explicitly not accepted

**A generic multi-provider payment framework.** The target is a boundary sized for Razorpay's actual
shape, not a `UniversalPaymentProvider` built for providers Kizunia does not use.

**A Kizunia-owned payment-retry or grace-period engine.** Razorpay's own retry-then-halt lifecycle is
used as-is; building a parallel, longer grace timer on top was explicitly rejected — see
[SB-PF-01](../../project/feature-specification/subscription/decisions/payment-failure-and-recovery.md#sb-pf-01--no-second-retry-engine).

**A generic coupon/campaign engine.** V1 supports exactly two mechanisms (Razorpay Offers for real
discounts, Kizunia Promotions for free-access grants) and nothing more speculative.

### What this makes possible

Free operating with zero Razorpay dependency in every environment (no credentials, TEST credentials,
LIVE credentials, or a Razorpay outage); production deployment before live credentials exist;
Razorpay Dashboard-originated changes flowing through the same pipeline as application-initiated
ones; an admin grant temporarily exceeding a user's paid plan and cleanly falling back to it on
expiry; and a future second entitlement source (a one-time purchase) or a future second provider
being added without touching the modules that already consume effective access.

### What it depends on

Nothing here blocks documentation completion — this ADR describes a design, not yet an
implementation. Before implementation begins, the P1 items the authorization audit already flagged
(`kizunia-authorization-compressed-wind.md` §22) — Portfolio's policy refactor onto
`AuthorizationEvaluator`, and a shared admin-route guard — are strongly recommended first, since
Portfolio and admin-grant UI are two of the surfaces this subsystem directly gates. See
[`../subscription/verification-checklist.md`](../subscription/verification-checklist.md).

---

# Alternatives considered

**A `plan` field on `User`, updated directly by a webhook handler.** Rejected: collapses multiple
entitlement sources into one mutable field, cannot express "admin grant currently overrides paid
plan," and gives Razorpay Dashboard mutations no correctness story beyond "hope the webhook arrives
in order."

**Trusting webhook payloads directly for state transitions.** Rejected: Razorpay explicitly does not
guarantee delivery order, so a payload-trusting handler can regress state on out-of-order delivery.

**A Kizunia-owned 7-day grace-period engine**, as originally proposed in the product-decision
document. Rejected during reconciliation against current Razorpay documentation — see
[`reconciliations.md`](../../project/feature-specification/subscription/decisions/reconciliations.md#r-01--the-7-day-grace-period-is-superseded-by-razorpay-anchored-recovery).

**Modeling a free-access promotional code as a Razorpay Offer.** Rejected: Razorpay Offers are
instrument-scoped, not account-scoped, and cannot express "this Kizunia account gets free access
with no real subscription" — see
[SB-CP-01](../../project/feature-specification/subscription/decisions/coupons-and-promotions.md#sb-cp-01--billing-discounts-use-offers-free-access-grants-use-promotions-never-conflated).

**A single polymorphic `AccessGrant` table** covering paid subscriptions, trials, grants, and
promotions. Rejected — see
[`../domain/subscription/overview.md`](../domain/subscription/overview.md#why-subscription-and-entitlementgrant-are-two-entities-not-one-polymorphic-table).

---

# Amendments

## 2026-09-24 — Architecture hardening

An adversarial review, assuming 100k+ users, thousands of paying customers, unreliable networks,
provider outages and rate limits, and Razorpay Dashboard operators as a second writer, found the
founding decision sound and its realization incomplete. The five commitments above stand. What
changed, each recorded as an amended or new ruling in the
[decision register](../../project/feature-specification/subscription/decisions/README.md):

1. **One Kizunia Subscription per Razorpay subscription**, bound once — replacing a single long-lived
   Subscription with a swappable provider reference, which could not represent a halted subscription
   recovering after a new one was bought. Kizunia never creates a second *open* subscription for a
   user; duplicates arising outside Kizunia are detected, never silently resolved (`SB-UQ`).
2. **Commands are a first-class concept.** Every mutation Kizunia asks of Razorpay is recorded before
   it is sent, serialized per user, idempotent for client retries, and never blindly retried when its
   outcome is unknown — Razorpay offers no idempotency for creating subscriptions (`SB-CM`).
3. **One synchronization mechanism, bounded.** Webhook refetches, confirmations and reconciliation
   share a sync-due marker on each Subscription, one stale-apply guard, due-based scheduling instead
   of a sweep, and one global outbound request budget — Razorpay publishes no rate-limit numbers
   (`SB-RC-04`–`SB-RC-10`, `SB-WH-03`/`SB-WH-05` amended).
4. **No user-visible dependency on the daily tick.** The only scheduled trigger fires once a day on
   Vercel Hobby; webhooks and checkout confirmation now sync immediately, and the scheduler is a
   deployment choice (`SB-PB-06`).
5. **Plan changes use Razorpay's native capability only.** Razorpay cannot change the plan of UPI,
   e-mandate or domestic-card subscriptions; V1 documents that limitation rather than building a
   successor-subscription workaround (`SB-LC-07`, [R-06](../../project/feature-specification/subscription/decisions/reconciliations.md#r-06--the-update-api-does-not-support-plan-changes-for-most-indian-payment-methods)).

This extends "Explicitly not accepted" with: a successor-subscription plan-change workaround in V1; a
separate webhook-processing queue beside reconciliation; background processes that mutate provider
state; and any provider call outside the shared request budget. It extends "Accepted costs" with: a
`BillingOperation` record per provider mutation, sync bookkeeping on every Subscription, and a
low-priority orphan-discovery scan.

---

# References

- Product specification:
  [`project/feature-specification/subscription/`](../../project/feature-specification/subscription/README.md)
- Architecture: [`architecture/subscription/`](../subscription/README.md)
- Domain model: [`architecture/domain/subscription/`](../domain/subscription/README.md)
- Prior audits (scratch, not authoritative):
  [`docs/temp/suscriptions.md`](../../temp/suscriptions.md),
  `docs/temp/suscriptions-issues.md` (input to the 2026-09-24 amendments),
  [`docs/temp/razorpay-feasibility-audit.md`](../../temp/razorpay-feasibility-audit.md),
  [`docs/temp/kizunia-authorization-compressed-wind.md`](../../temp/kizunia-authorization-compressed-wind.md)
- Sibling ADR, same shape of decision:
  [`notifications-subsystem.md`](notifications-subsystem.md)
- Scheduled-job convention this design reuses:
  [`../workflows/internal-jobs.md`](../workflows/internal-jobs.md)
