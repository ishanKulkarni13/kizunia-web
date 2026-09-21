# Rulings — Payment Failure and Recovery

> **Status:** Live
>
> **Last Updated:** 2026-09-21

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
[`../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../architecture/subscription/provider-boundary/razorpay-facts.md#payment-retries)).
Building a second, independent grace timer on top — which is what the original product doc's
"7-day configurable grace period" concept would have required — would duplicate exactly the system
the instructions say not to duplicate, and would need to be reconciled against a retry timeline
Kizunia does not control and Razorpay does not guarantee is constant across payment rails. See
[`reconciliations.md`](reconciliations.md) for how this supersedes the original 7-day proposal.

## SB-PF-02 — `pending` retains full paid access

**Status:** Accepted

**Decision:** While a Razorpay subscription is in the `pending` state (an auto-charge failed and
Razorpay is actively retrying), the user keeps full paid access, unchanged.

**Rationale:** The payment has not definitively failed — Razorpay is still trying. Revoking access
during an in-progress retry would punish a transient card issue (an expired-but-about-to-be-updated
card, a momentary bank decline) as if it were a real cancellation.

## SB-PF-03 — `halted` ends paid access but never cancels the subscription

**Status:** Accepted

**Decision:** When a Razorpay subscription reaches `halted` (all automatic retries exhausted), paid
access ends and the user's effective access falls back to Free. Kizunia does **not** call Razorpay's
cancel API on this subscription — it is left exactly as Razorpay put it: halted, not cancelled.

**Rationale:** Two facts drive this. [RAZORPAY FACT] Razorpay's own retry window (three to four days
for cards/UPI) already constitutes the "reasonable time" the product doc asked for — extending it
further with a Kizunia-owned timer is the duplicate engine [SB-PF-01](#sb-pf-01--no-second-retry-engine) rules out.
[RAZORPAY FACT] `halted` itself has no natural end on Razorpay's side: invoices keep generating
indefinitely without being auto-charged again until the customer acts (see
[`../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../architecture/subscription/provider-boundary/razorpay-facts.md#payment-retries)).
Since Razorpay will not itself decide when "too long unpaid" has been reached, Kizunia must pick a
stopping point for entitlement purposes regardless — and `halted`, the point at which Razorpay's own
automation has already given up, is the only stopping point available that isn't invented from
nothing.

**Consequence:** A user can remain `halted` in Razorpay indefinitely while being Free in Kizunia.
This is intended: it costs nothing (no further charge attempts happen) and preserves their billing
history and mandate for a frictionless return.

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
