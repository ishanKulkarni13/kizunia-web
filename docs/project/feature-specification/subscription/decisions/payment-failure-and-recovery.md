# Rulings — Payment Failure and Recovery

> **Status:** Live
>
> **Last Updated:** 2026-09-24

This topic resolves the original product doc's most explicitly open area (`suscriptions.md` §23–24,
§84: "these should be explicitly decided before implementation of failed-payment handling") against
Razorpay's actual, verified retry behavior.

---

## SB-PF-01 — No second retry engine

**Status:** Accepted

**Decision:** Kizunia does not build its own payment-retry or grace-period timer. It reacts to
Razorpay's own retry/dunning lifecycle instead of running a parallel one.

**Rationale:** Explicitly required by this design's source instructions: "if Razorpay can handle
the recovery/grace behavior naturally, let Razorpay handle it." [RAZORPAY FACT] Razorpay already
retries failed card/UPI charges automatically for about three to four days before giving up (see
[`../../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#payment-retries)).
Building a second, independent grace timer on top — which is what the original product doc's
"7-day configurable grace period" concept would have required — would duplicate exactly the system
the instructions say not to duplicate, and would need to be reconciled against a retry timeline
Kizunia does not control and Razorpay does not guarantee is constant across payment rails. See
[`reconciliations.md`](reconciliations.md) for how this supersedes the original 7-day proposal.

## SB-PF-02 — `pending` retains full paid access

**Status:** Amended — 2026-09-24, see the end of this ruling

**Decision:** While a Razorpay subscription is in the `pending` state (an auto-charge failed and
Razorpay is actively retrying), the user keeps full paid access, unchanged.

**Rationale:** The payment has not definitively failed — Razorpay is still trying. Revoking access
during an in-progress retry would punish a transient card issue (an expired-but-about-to-be-updated
card, a momentary bank decline) as if it were a real cancellation.

**Amended (2026-09-24):** `pending` now maps to its own Kizunia phase, `PAST_DUE`, instead of
`ACTIVE`. The access rule is unchanged — `PAST_DUE` contributes full paid access exactly as `ACTIVE`
does. The distinction exists because two things other than access need it: [RAZORPAY FACT] Razorpay
refuses plan updates for `pending` subscriptions, so a UI reading `ACTIVE` would offer changes that
must fail; and "your payment is failing, update your payment method" is a state the user must be
able to see. The earlier rationale for folding `pending` into `ACTIVE` considered only effective
access. See [`state-mapping.md`](../../../../architecture/subscription/lifecycle/state-mapping.md).
A trial whose first real charge fails is expected to follow this same path (TEST verification,
[open item A7](../open-decisions.md#a-razorpay-behavior-requiring-test-mode-verification-or-support)).

## SB-PF-03 — `halted` ends paid access but never cancels the subscription

**Status:** Amended — 2026-09-24, see the end of this ruling

**Decision:** When a Razorpay subscription reaches `halted` (all automatic retries exhausted), paid
access ends and the user's effective access falls back to Free. Kizunia does **not** call Razorpay's
cancel API on this subscription — it is left exactly as Razorpay put it: halted, not cancelled.

**Rationale:** Two facts drive this. [RAZORPAY FACT] Razorpay's own retry window (three to four days
for cards/UPI) already constitutes the "reasonable time" the product doc asked for — extending it
further with a Kizunia-owned timer is the duplicate engine [SB-PF-01](#sb-pf-01--no-second-retry-engine) rules out.
[RAZORPAY FACT] `halted` itself has no natural end on Razorpay's side: invoices keep generating
indefinitely without being auto-charged again until the customer acts (see
[`../../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#payment-retries)).
Since Razorpay will not itself decide when "too long unpaid" has been reached, Kizunia must pick a
stopping point for entitlement purposes regardless — and `halted`, the point at which Razorpay's own
automation has already given up, is the only stopping point available that isn't invented from
nothing.

**Consequence:** A user can remain `halted` in Razorpay indefinitely while being Free in Kizunia.
This is intended: it costs nothing (no further charge attempts happen) and preserves their billing
history and mandate for a frictionless return.

**Amended (2026-09-24):** "Never cancels" is refined to "never cancels *automatically*". The one
path by which Kizunia cancels a `halted` subscription is a user who chooses to buy again and
explicitly confirms that the halted subscription will be cancelled —
[SB-UQ-04](uniqueness-and-resubscription.md#sb-uq-04--a-halted-or-paused-subscription-is-superseded-only-by-a-confirmed-cancellation).
Without that, leaving the halted subscription alive while creating a new one would allow both to
bill once the old one recovers — [RAZORPAY FACT] a halted subscription returns to `active` whenever
the customer updates their payment method through a Razorpay-sent link, outside Kizunia's UI
([razorpay-facts](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#payment-retries)).
Whether Kizunia should ever cancel a long-halted subscription on its own is open product question
[B2](../open-decisions.md#b-genuinely-open-product-questions).

## SB-PF-04 — Un-halting restores paid access automatically and non-destructively

**Status:** Accepted

**Decision:** If a `halted` subscription later resumes (the customer updates their payment method
and Razorpay successfully charges it, moving the subscription back to `active`), Kizunia's webhook
handler restores paid access automatically. Nothing about the user's projects, portfolio, or
preferences needs to be recreated, because [SB-PF-03](#sb-pf-03--halted-ends-paid-access-but-never-cancels-the-subscription) never deleted the subscription record or any
user data.

**Rationale:** Direct consequence of choosing not to cancel on halt. This is what makes the
halted-ends-access decision safe from the user's perspective: falling back to Free is never a
one-way door while the underlying subscription still exists.

**Note (2026-09-24, no change to the ruling):** [RAZORPAY FACT] After recovery "Only future payments
are charged automatically" — invoices missed while halted are not collected. Kizunia restores access
on recovery regardless and does not attempt to collect them. If the user has meanwhile superseded the
halted subscription ([SB-UQ-04](uniqueness-and-resubscription.md#sb-uq-04--a-halted-or-paused-subscription-is-superseded-only-by-a-confirmed-cancellation)),
it is cancelled and cannot recover; if it somehow does return to `active` alongside a newer one, that
is a detected anomaly ([SB-UQ-05](uniqueness-and-resubscription.md#sb-uq-05--multiple-open-subscriptions-arising-outside-kizunia-are-detected-never-silently-resolved)).

## SB-PF-05 — Synchronization of a halted subscription decays; it never stops

**Status:** Accepted

**Decision:** A `HALTED` subscription stays in reconciliation scope indefinitely (it is not
terminal), but its heartbeat interval lengthens with time spent halted — frequent in the first days,
then weekly, then monthly — rather than staying at the active-subscription cadence. Recovery is
normally observed immediately through the `subscription.activated` webhook; the heartbeat is only
the backstop for a missed one.

**Rationale:** [RAZORPAY FACT] A halted subscription has no documented end
([razorpay-facts](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#payment-retries)),
so without decay the population synchronized forever grows without bound and competes with live
subscriptions for the provider request budget ([SB-RC-06](reconciliation.md#sb-rc-06--all-outbound-razorpay-calls-share-one-bounded-request-budget)).
Stopping entirely would mean a recovery whose webhook was missed never restores access to a paying
customer. Decay bounds the cost while keeping the worst-case restoration delay finite. Exact
intervals are implementation configuration ([C3](../open-decisions.md#c-implementation-time-configuration)).
