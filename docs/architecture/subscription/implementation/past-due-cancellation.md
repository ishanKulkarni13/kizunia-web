# PAST_DUE Cancellation

> **Status:** Implementation plan — not implemented
>
> **Last Updated:** 2026-09-24
>
> **Blueprint section:** §11 (see the [section map](README.md#blueprint-section-map))

Records the TEST-observed Razorpay behavior (ledger item D2) that a cycle-end cancellation request on a past-due subscription is accepted with HTTP 200 yet has no observable effect. It covers where that affects the architecture, what the design said before, the invariants that hold regardless, and the decision ([IB-1](open-decisions.md#ib-1--past_due-cancellation)).

> **DECIDED 2026-09-24 — product decision (owner): option A.** A customer cancellation of a `PAST_DUE` subscription is **immediate**. The options table below is kept as the record of what was weighed.

**Decisions referenced here:** [IB-1](open-decisions.md#ib-1--past_due-cancellation). All were ruled on 2026-09-24; see [open decisions](open-decisions.md) for each ruling and who made it (product decision (owner) or architecture decision (autonomous)).

---

**What TEST showed (A1, D2):** on a `pending` subscription, `cancel_at_cycle_end: true` returned **200** with no state change, no scheduled-change visibility and no observable effect. Whether Razorpay recorded it or silently ignored it is unknown. On `pending`, an **immediate** cancel is verified to work (→ `cancelled`).

**What the docs said before the decision:** customer cancel for `ACTIVE` **and** `PAST_DUE` was cycle-end (`cancellation.md`, SB-LC-04). The review flag in `cancellation.md` says the result "cannot be presumed effective" and that `CANCELLATION_NOT_EFFECTIVE` is "its only backstop". The operation model resolves `CANCEL_AT_CYCLE_END` "when observed `cancelled` at period end, or offered to the user to re-issue".

**Where it bites the architecture:**

1. **Command settlement.** The runner's generic rule (2xx → `SUCCEEDED`, set `cancelAtPeriodEnd`) would record a claim Razorpay may not honor. The user is told "cancels on `<date>`".
2. **Detection gap.** The documented check fires when "local says cancelling, Razorpay still `active` after `current_end` + margin". From `PAST_DUE` there are two other paths it misses:
   (a) the retry succeeds → `ACTIVE`, and the customer is **charged after asking to cancel**;
   (b) retries exhaust → `HALTED`. The subscription is still recoverable and can bill again via Razorpay's recovery e-mail while Kizunia shows "cancelled".
3. **`current_end` semantics during `pending`** are not documented, so "period end" for a past-due subscription is ill-defined.
4. **UI honesty:** "ends on `<date>`" for a subscription whose current period was never paid.

**Invariants to hold regardless of the decision:**

- **I-1** A cycle-end cancel response is never evidence of cancellation. `cancelAtPeriodEnd` records Kizunia's *request*, never an observation. Display copy says "cancellation requested".
- **I-2** Kizunia never sends cycle-end cancellation in a phase where TEST showed a silent no-op: `HALTED`, `PAUSED`, and (by the IB-1 decision) `PAST_DUE`.
- **I-3** `cancelAtPeriodEnd` is cleared only by an observed `CANCELLED`, or by raising `CANCELLATION_NOT_EFFECTIVE` (which also alerts and tells the user they are still subscribed).
- **I-4** While `cancelAtPeriodEnd` is set, every applied observation is checked for contradiction. `CANCELLATION_NOT_EFFECTIVE` is raised when any of these hold: (i) still `active`/`pending` after `requested currentPeriodEnd` + margin; (ii) a `CHARGE` fact dated after the cancel request's `requestSentAt`; (iii) the phase becomes `HALTED` with the flag set. (ii) and (iii) **extend** the documented rule. They are adopted with IB-1 and protect `ACTIVE` cycle-end cancellations.
- **I-5** Access is never cut on the strength of a cancel request, and never extended beyond what observations show.

**Options that were weighed for IB-1 (option A chosen 2026-09-24):**

| Option | Effect | Trade-off |
| --- | --- | --- |
| **A. `PAST_DUE` customer cancel = immediate (verified to work) — CHOSEN** | Ends access now. The current period was not paid, so nothing paid-for is lost | Changes SB-LC-04 for one phase; needs clear copy |
| B. Refuse customer cancel in `PAST_DUE` ("fix payment, or cancel after it resolves"; support can cancel immediately) | No unverifiable request is ever sent | Blocks self-serve exit while payment fails |
| C. Keep cycle-end, and adopt I-4 (ii)/(iii) detection + "requested, unconfirmed" UI | Matches the current docs | The customer may still be charged; relies on detection after the fact |

*Superseded interim rule (historical):* before the decision, slice S10 would have shipped `ACTIVE` and `TRIALING` cancel only, with the `PAST_DUE` branch returning a typed `CANCEL_UNAVAILABLE_PAST_DUE`. With option A decided, [Phase VI](../implementation-plan/phase-VI/README.md) ships `PAST_DUE` customer cancel as an immediate cancellation.

**Consequences of option A:**

- The command settles like any immediate cancel: access ends when `cancelled` is observed.
- `cancelAtPeriodEnd` is never set for `PAST_DUE`.
- The UI copy says access ends now and no further charge will be made.
- Not verified for UPI subscriptions (UPI has not been observed, [IB-18](open-decisions.md#ib-18--upi-disabled-on-the-razorpay-test-account)). A `REJECTED` response is handled like any refused cancel.

---

## Related documents

**In this directory**

- [Billing Command Model](command-model.md)
- [Synchronization](synchronization.md)
- [Subscription State Model](state-model.md)
- [Open decisions](open-decisions.md) · [Settled decisions](settled-decisions.md) · [Index](README.md)

**Design and specification**

- [Cancellation (design)](../lifecycle/cancellation.md)
- [Payment failure and recovery](../lifecycle/payment-failure-and-recovery.md)
- [Razorpay facts — cancellation](../provider-boundary/razorpay-facts.md#cancellation)
- [Product open decisions — A1 and A2](../../../project/feature-specification/subscription/open-decisions.md#a-resolved-answered-by-test-verification-2026-09-24)
