# PAST_DUE Cancellation

> **Status:** Implementation plan — not implemented
>
> **Last Updated:** 2026-09-24
>
> **Blueprint section:** §11 (see the [section map](README.md#blueprint-section-map))

Records the TEST-observed Razorpay behavior (ledger item D2) that a cycle-end cancellation request on a past-due subscription is accepted with HTTP 200 yet has no observable effect. It covers where that affects the architecture, what the current design says, the invariants that hold regardless, and the open decision ([IB-1](open-decisions.md#ib-1--past_due-cancellation)). No option is chosen here.

**Open decisions referenced here:** [IB-1](open-decisions.md#ib-1--past_due-cancellation). Text that follows a recommended resolution is provisional until that item is ruled; see [open decisions](open-decisions.md).

---

**What TEST showed (A1, D2):** on a `pending` subscription, `cancel_at_cycle_end: true` returned **200** with no state change, no scheduled-change visibility and no observable effect. Whether Razorpay recorded it or silently ignored it is unknown. On `pending`, an **immediate** cancel is verified to work (→ `cancelled`).

**What the docs say today:** customer cancel for `ACTIVE` **and** `PAST_DUE` is cycle-end (`cancellation.md`, SB-LC-04). The review flag in `cancellation.md` says the result "cannot be presumed effective" and that `CANCELLATION_NOT_EFFECTIVE` is "its only backstop". The operation model resolves `CANCEL_AT_CYCLE_END` "when observed `cancelled` at period end, or offered to the user to re-issue".

**Where it bites the architecture:**

1. **Command settlement.** The runner's generic rule (2xx → `SUCCEEDED`, set `cancelAtPeriodEnd`) would record a claim Razorpay may not honor. The user is told "cancels on `<date>`".
2. **Detection gap.** The documented check fires when "local says cancelling, Razorpay still `active` after `current_end` + margin". From `PAST_DUE` there are two other paths it misses:
   (a) the retry succeeds → `ACTIVE`, and the customer is **charged after asking to cancel**;
   (b) retries exhaust → `HALTED`. The subscription is still recoverable and can bill again via Razorpay's recovery e-mail while Kizunia shows "cancelled".
3. **`current_end` semantics during `pending`** are not documented, so "period end" for a past-due subscription is ill-defined.
4. **UI honesty:** "ends on `<date>`" for a subscription whose current period was never paid.

**Invariants to hold regardless of the decision:**

- **I-1** A cycle-end cancel response is never evidence of cancellation. `cancelAtPeriodEnd` records Kizunia's *request*, never an observation. Display copy says "cancellation requested".
- **I-2** Kizunia never sends cycle-end cancellation in a phase where TEST showed a silent no-op: `HALTED` and `PAUSED` (already settled). `PAST_DUE` is IB-1.
- **I-3** `cancelAtPeriodEnd` is cleared only by an observed `CANCELLED`, or by raising `CANCELLATION_NOT_EFFECTIVE` (which also alerts and tells the user they are still subscribed).
- **I-4** While `cancelAtPeriodEnd` is set, every applied observation is checked for contradiction. `CANCELLATION_NOT_EFFECTIVE` is raised when any of these hold: (i) still `active`/`pending` after `requested currentPeriodEnd` + margin; (ii) a `CHARGE` fact dated after the cancel request's `requestSentAt`; (iii) the phase becomes `HALTED` with the flag set. (ii) and (iii) **extend** the documented rule and need sign-off as part of IB-1.
- **I-5** Access is never cut on the strength of a cancel request, and never extended beyond what observations show.

**Options for IB-1 (decision required; none chosen here):**

| Option | Effect | Trade-off |
| --- | --- | --- |
| A. `PAST_DUE` customer cancel = **immediate** (verified to work) | Ends access now. The current period was not paid, so nothing paid-for is lost | Changes SB-LC-04 for one phase; needs clear copy |
| B. Refuse customer cancel in `PAST_DUE` ("fix payment, or cancel after it resolves"; support can cancel immediately) | No unverifiable request is ever sent | Blocks self-serve exit while payment fails |
| C. Keep cycle-end, and adopt I-4 (ii)/(iii) detection + "requested, unconfirmed" UI | Matches the current docs | The customer may still be charged; relies on detection after the fact |

Interim rule for implementation until decided: slice S10 ships `ACTIVE` (cycle-end) and `TRIALING` (immediate) customer cancel plus admin immediate cancel; the `PAST_DUE` branch returns a typed `CANCEL_UNAVAILABLE_PAST_DUE` pointing to support. That interim behavior itself needs a product nod.

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
