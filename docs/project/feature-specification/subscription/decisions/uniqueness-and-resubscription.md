# Rulings — Subscription Uniqueness and Resubscription

> **Status:** Live
>
> **Last Updated:** 2026-09-24

This topic resolves the contradiction recorded as
[R-04](reconciliations.md#r-04--one-active-subscription-per-user-versus-preserving-halted-subscriptions):
the original design said "one active Subscription per user" while also deliberately preserving
`halted` Razorpay subscriptions so they can recover — which, once a user buys again, allows two
provider subscriptions that can both bill and both grant access. The mechanism is described in
[`../../../../architecture/subscription/lifecycle/multiple-subscriptions.md`](../../../../architecture/subscription/lifecycle/multiple-subscriptions.md).

---

## SB-UQ-01 — A Subscription is one Razorpay subscription, bound once

**Status:** Accepted

**Decision:** A Kizunia `Subscription` record corresponds to exactly one Razorpay subscription for
its whole life. Its provider subscription ID is bound once, when Razorpay confirms creation, and is
never replaced. A user has zero or more Subscriptions; a cancel → resubscribe cycle produces a new
Subscription record. The record is written **before** Kizunia asks Razorpay to create the provider
subscription, in phase `PROVISIONING`.

**Rationale:** The earlier design described one long-lived Subscription whose provider reference is
swapped on resubscribe. That breaks the moment the old provider subscription does anything after
being "replaced": a late webhook for it has no record to land on, and a `halted` subscription that
recovers (which [SB-PF-04](payment-failure-and-recovery.md#sb-pf-04--un-halting-restores-paid-access-automatically-and-non-destructively)
explicitly allows) would either be lost or overwrite the newer relationship. One record per provider
subscription makes every provider object individually addressable, synchronizable and auditable.
Continuity of a user's history lives on the user (all of their Subscriptions, plus history entries),
not on a reused row. Writing the record before the create call is what makes a lost create response
recoverable — see [SB-CM-02](commands-and-idempotency.md#sb-cm-02--the-local-record-is-written-before-the-provider-call).

## SB-UQ-02 — Kizunia never creates a second open subscription for a user

**Status:** Accepted

**Decision:** A Subscription is **open** while its phase is `PROVISIONING`,
`PENDING_AUTHENTICATION`, `TRIALING`, `ACTIVE`, `PAST_DUE`, `PAUSED` or `HALTED` — any phase from
which it can still bill or still come to grant access. Kizunia never creates a new provider
subscription for a user who already has an open Subscription, except by first making the existing
one terminal under [SB-UQ-04](#sb-uq-04--a-halted-or-paused-subscription-is-superseded-only-by-a-confirmed-cancellation).
The check runs inside the per-user command serialization of
[SB-CM-01](commands-and-idempotency.md#sb-cm-01--every-mutating-provider-call-is-a-recorded-billing-operation),
never as an unguarded read-then-create.

**Rationale:** "One active subscription" is not enough: `HALTED`, `PAUSED` and an unauthenticated
checkout can all become billing, access-granting subscriptions again without any Kizunia action. The
invariant must cover every non-terminal phase or it does not prevent double billing. It is stated as
a rule on what Kizunia *creates*, not as a database constraint on provider-mirrored state, because
Razorpay is authoritative: if Razorpay reports two open subscriptions, Kizunia must record that truth
rather than fail to write it — see [SB-UQ-05](#sb-uq-05--multiple-open-subscriptions-arising-outside-kizunia-are-detected-never-silently-resolved).

## SB-UQ-03 — A new purchase while a paid subscription is live is refused, not duplicated

**Status:** Accepted

**Decision:** When a user with an open Subscription asks to buy a plan:

| Existing open Subscription | Outcome |
| --- | --- |
| `TRIALING`, `ACTIVE`, `PAST_DUE` | Purchase refused. If Razorpay natively supports the requested plan change for that subscription, the user is directed to it ([SB-LC-07](lifecycle.md#sb-lc-07--razorpay-decides-whether-a-plan-change-is-possible)); otherwise the V1 limitation applies (the user may cancel and subscribe again once the current subscription has ended) |
| `PENDING_AUTHENTICATION` (checkout started, not completed), same plan and cycle, not expired | The existing checkout is returned — no new provider subscription |
| `PENDING_AUTHENTICATION`, different plan/cycle or expired | The existing checkout is cancelled (and confirmed) first, then a new one is created |
| `PROVISIONING` | The in-flight creation is returned (idempotent retry) — see [SB-CM-04](commands-and-idempotency.md#sb-cm-04--client-retries-and-multiple-tabs-resolve-to-the-same-operation) |
| `HALTED`, `PAUSED` | Supersession — [SB-UQ-04](#sb-uq-04--a-halted-or-paused-subscription-is-superseded-only-by-a-confirmed-cancellation) |

**Rationale:** A live, access-granting subscription never needs a second one; creating one is double
billing. An abandoned checkout is cheap to reuse and dangerous to multiply (each is a real provider
object a user could still authenticate later). Refusing — rather than quietly creating a successor —
follows the V1 plan-change decision: no successor-subscription workflow is built
([R-06](reconciliations.md#r-06--the-update-api-does-not-support-plan-changes-for-most-indian-payment-methods)).

## SB-UQ-04 — A halted or paused subscription is superseded only by a confirmed cancellation

**Status:** Accepted — product decision, 2026-09-24

**Decision:** A user whose open Subscription is `HALTED` or `PAUSED` may buy again. After explicit
user confirmation ("your previous subscription will be cancelled and cannot be recovered"), Kizunia
cancels the existing provider subscription **immediately**, confirms the cancellation through an
authoritative sync (phase `CANCELLED`), and only then creates the new Subscription. The old record
is linked to the new one (`supersededBy`). If Razorpay refuses or fails the cancellation, the new
purchase is refused and the user is directed to recover the existing subscription instead — Kizunia
never proceeds to create while the old one is still open.

**Rationale:** Keeping a recoverable `halted` subscription alongside a new one is the double-billing
scenario this topic exists to prevent — a `halted` subscription can return to `active` whenever the
customer updates their payment method through a Razorpay-sent link, outside Kizunia's UI
([razorpay-facts](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#payment-retries)).
Blocking the purchase entirely would strand users whose mandate is gone (a UPI mandate revoked in
their UPI app cannot be recovered on the same rail). Supersession keeps the invariant while letting
the user move on; the cost — losing the ability to recover the old subscription — is exactly what
the user is asked to confirm. Confirmation *by sync* rather than by the cancel response alone
follows [SB-WH-03](webhooks-and-reliability.md#sb-wh-03--state-changing-events-trigger-an-authoritative-refetch):
Kizunia acts on Razorpay's observed state, not on an assumed one.

**Consequence:** This is the only path by which Kizunia itself cancels a `halted` subscription —
see the amendment to [SB-PF-03](payment-failure-and-recovery.md#sb-pf-03--halted-ends-paid-access-but-never-cancels-the-subscription).
Whether the Cancel API accepts `halted`/`paused` subscriptions is not documented
([open item A1](../open-decisions.md#a-razorpay-behavior-requiring-test-mode-verification-or-support));
until verified, the refusal fallback above is the defined behavior.

## SB-UQ-05 — Multiple open subscriptions arising outside Kizunia are detected, never silently resolved

**Status:** Accepted

**Decision:** If synchronization finds a user with more than one open Subscription — for example a
superseded subscription whose cancellation was later reversed by support, a Dashboard-created
subscription carrying the user's identifiers, or a replayed recovery — Kizunia:

1. records every one of them faithfully (each is its own Subscription, per [SB-UQ-01](#sb-uq-01--a-subscription-is-one-razorpay-subscription-bound-once));
2. computes effective access as the highest tier across all contributing Subscriptions
   ([SB-EA-06](effective-access-and-grants.md#sb-ea-06--effective-access-takes-the-maximum-over-every-contributing-subscription)) —
   the user gets what they are actually paying for;
3. raises a `MULTIPLE_OPEN_SUBSCRIPTIONS` anomaly for operations;
4. never cancels, refunds, or picks one automatically.

A provider subscription that cannot be matched to any Kizunia user at all is recorded as unmatched
and alerted ([SB-WH-06](webhooks-and-reliability.md#sb-wh-06--events-for-unknown-subscriptions-are-persisted-and-matched-never-dropped)),
never attached to a user by guesswork.

**Rationale:** Once two provider subscriptions exist, every automatic choice is wrong for someone:
cancelling the newer one may cancel the one the user meant to keep; cancelling the older one issues
no refund for charges already taken. These are money-affecting judgments that need a human with
Razorpay Dashboard access. What Kizunia *can* guarantee deterministically is that access never falls
below what the user is being charged for, and that the situation is visible within one sync.
