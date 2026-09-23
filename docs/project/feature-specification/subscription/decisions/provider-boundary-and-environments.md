# Rulings — Provider Boundary and Environments

> **Status:** Live
>
> **Last Updated:** 2026-09-24

---

## SB-PB-01 — The provider boundary is sized, not generic

**Status:** Amended — 2026-09-24, see the end of this ruling

**Decision:** Razorpay integration lives behind a narrow interface covering exactly the operations
Kizunia needs — create/fetch/update/cancel a subscription, verify and parse a webhook. It is not
built as a generic, multi-provider payment framework.

**Rationale:** Explicitly required by this design's source instructions: "do not create an enormous
abstraction... instead, create a clean and appropriately sized billing/provider boundary around the
actual domain needs." A generic abstraction sized for hypothetical future providers would be paid
for immediately and used by exactly one implementation for the foreseeable future. See
[`../../../../architecture/subscription/provider-boundary/interface-and-abstraction.md`](../../../../architecture/subscription/provider-boundary/interface-and-abstraction.md).

**Amended (2026-09-24):** "Sized to actual needs" stands; the actual needs grew. The boundary also
lists subscriptions over a time window (orphan discovery,
[SB-RC-09](reconciliation.md#sb-rc-09--provider-subscriptions-kizunia-lost-track-of-are-found-by-a-bounded-scan)),
cancels a pending scheduled update ([SB-LC-08](lifecycle.md#sb-lc-08--at-most-one-scheduled-change-and-cancellation-always-wins)),
fetches a payment (to learn the advisory payment method, [SB-LC-07](lifecycle.md#sb-lc-07--razorpay-decides-whether-a-plan-change-is-possible)),
and verifies a checkout signature ([SB-CM-06](commands-and-idempotency.md#sb-cm-06--checkout-confirmation-syncs-only-the-callers-own-subscription)).
Every operation returns a classified outcome from one failure taxonomy rather than raw SDK errors.
Each addition is still a specific Kizunia need, not a generic capability.

## SB-PB-02 — Provider mode is resolved once at boot

**Status:** Accepted

**Decision:** Whether the billing provider is `disabled`, `test`, or `live` is resolved once, at
application boot, from credential presence and key-prefix validation (`rzp_test_` vs `rzp_live_`) —
never re-derived per request, and never checked via scattered `process.env.RAZORPAY_...` reads
throughout feature code.

**Rationale:** [ENGINEERING] A single resolved mode, exposed through one `isBillingProviderEnabled()`
-style seam, is what makes "paid billing unavailable" a coherent, testable application state instead
of an emergent property of wherever an environment check happened to be missing. Key-prefix
validation at boot catches a misconfigured environment (test secret paired with live keys) as a
fail-fast startup error rather than a silent, dangerous mismatch discovered in production.

## SB-PB-03 — Disabled is a fully supported production state

**Status:** Accepted

**Decision:** Running in production with the billing provider `disabled` (no credentials configured
yet) is a first-class, supported deployment state — not a misconfiguration to work around. Free,
existing paid users' cached entitlement, authorization, and admin grants all continue working
normally; only operations that would need to create or mutate real Razorpay billing state are
unavailable.

**Rationale:** [PRODUCT] Explicitly required: Kizunia may be deployed to production before live
Razorpay credentials exist, and this must not crash the application, break Free, or break
entitlement resolution for anyone. See
[`../../../../architecture/subscription/provider-availability/disabled-provider-mode.md`](../../../../architecture/subscription/provider-availability/disabled-provider-mode.md).

## SB-PB-04 — Razorpay identifiers never leak past the provider boundary

**Status:** Amended — 2026-09-24, see the end of this ruling

**Decision:** Razorpay subscription IDs, plan IDs, payment IDs, and status strings are stored only
as provider-reference metadata attached to a Kizunia `Subscription` record. No domain service,
authorization policy, or feature module outside the provider boundary ever branches on a Razorpay
identifier or status string directly.

**Rationale:** [PRODUCT] Explicitly required by the original product doc (`suscriptions.md` §15,
§82) and this design's source instructions. [ENGINEERING] It is also a practical necessity:
[RAZORPAY FACT] a cancelled Razorpay subscription cannot be reactivated — a resubscribe creates a
brand-new Razorpay subscription object with a new ID (see
[`../../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#lifecycle-states)).
If Kizunia's own continuity (a user's subscription history, their effective-access lineage) were
keyed on the Razorpay ID, that continuity would break every time a user cancelled and resubscribed.
Keeping Kizunia's own identifiers as the domain's backbone, with Razorpay IDs as attached
references, avoids this entirely.

**Amended (2026-09-24):** The rule stands; two details change.

1. **The continuity rationale is corrected.** Kizunia's continuity lives on the *user* and their
   history, not on one long-lived Subscription whose Razorpay reference is swapped on resubscribe.
   Each Razorpay subscription now has its own Kizunia Subscription record, bound once
   ([SB-UQ-01](uniqueness-and-resubscription.md#sb-uq-01--a-subscription-is-one-razorpay-subscription-bound-once)).
   Kizunia's own IDs remain the primary keys and the only identifiers referenced outside the
   billing module.
2. **Raw provider state may be persisted *inside* the billing module.** The last fetched provider
   status and a normalized snapshot of the provider entity are stored on the Subscription for
   diagnostics, command preconditions and anomaly detection. They are read only by the billing
   module's own code; everything outside it still sees only Kizunia phases and capabilities. The
   earlier "raw status is never persisted outside the `BillingEvent` payload" made it impossible to
   answer "what did Razorpay last say about this subscription?" without replaying events.

## SB-PB-05 — Provider plan IDs map to Kizunia plans through a per-mode catalog, many-to-one

**Status:** Accepted

**Decision:** A configuration catalog, one per provider mode, maps each Razorpay plan ID to a
Kizunia `(plan, cycle)`. Several Razorpay plan IDs may map to the same Kizunia plan (a price change
creates a new Razorpay plan while existing subscribers stay on the old one), and a retired plan ID
stays in the catalog for as long as any subscription uses it. A synchronized subscription whose
Razorpay plan ID is not in the catalog is **not applied**: the local record keeps its last known
state, and an `UNMAPPED_PROVIDER_PLAN` anomaly is raised.

**Rationale:** [RAZORPAY FACT] Monthly and yearly are separate Razorpay plan objects, test and live
use different objects, and plans can be changed from the Dashboard
([razorpay-facts](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#upgrade--downgrade)).
An unknown plan ID has no correct automatic interpretation — guessing a tier either grants unpaid
access or removes paid access. Keeping the last known state and alerting is the only choice that is
both deterministic and harmless while a human adds the mapping.

## SB-PB-06 — Billing execution is scheduler-agnostic

**Status:** Accepted — product/operations decision, 2026-09-24

**Decision:** All background billing work — draining sync-due Subscriptions, orphan discovery,
resolving outcome-unknown operations — runs as registered tasks of the existing internal tick
(`GET /api/v1/internal/tick`, `CRON_SECRET`, task registry). The tick may be invoked by Vercel Cron,
by an external scheduler calling the same endpoint with the same secret, or manually. Switching
between them is a deployment-configuration change only; no billing or reconciliation code knows
what invoked it. Kizunia must remain deployable on Vercel Hobby, and Vercel Pro is **not** a
prerequisite for `live` billing.

- **Target cadence:** every 5 minutes; **acceptable upper bound:** 15 minutes. Billing tasks declare
  a minimum interval no larger than that, so a more frequent trigger immediately tightens them.
- **Under a daily-only trigger** (the current `next/vercel.json`), billing stays *correct* but some
  latencies degrade — see the table below. Operating `live` on a daily-only trigger is allowed, and
  the degradation is documented rather than hidden.

| Path | Target cadence | Daily-only trigger |
| --- | --- | --- |
| Checkout → access | Seconds (checkout confirmation + webhook `after()`) | Unchanged |
| Webhook-reported change → local state | Seconds (`after()`) | Unchanged when `after()` succeeds; up to 24 h when it fails |
| Retry after a transient provider failure | Minutes | Up to 24 h |
| Missed webhook detected at a lifecycle checkpoint | Checkpoint + margin + ≤ 15 min | Up to 24 h after the checkpoint |
| Outcome-unknown create resolved | Minutes | Up to 24 h |

**Rationale:** Correctness in this design depends only on durable markers (the sync-due marker, the
`BillingOperation` record), never on when a scheduler fires; the scheduler only bounds latency. That
makes the scheduler a deployment choice rather than an architectural dependency, which is what lets
Kizunia stay on Vercel Hobby. The immediate paths (`after()`, checkout confirmation) are what keep
the common case fast regardless of cadence. See
[`../../../../architecture/subscription/reconciliation/sync-mechanism.md`](../../../../architecture/subscription/reconciliation/sync-mechanism.md)
and [`../../../../architecture/workflows/internal-jobs.md`](../../../../architecture/workflows/internal-jobs.md).
