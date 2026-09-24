# Multiple Subscriptions

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24 (decision close-out: IB-6 in-flight semantics)

What "one subscription per user" actually means, how Kizunia keeps it true for everything it does
itself, and what happens when Razorpay reports otherwise. Rulings:
[SB-UQ-01 through SB-UQ-05](../../../project/feature-specification/subscription/decisions/uniqueness-and-resubscription.md).

---

## Vocabulary

| Term | Phases | Meaning |
| --- | --- | --- |
| **Contributing** | `TRIALING`, `ACTIVE`, `PAST_DUE` | Grants its plan's access right now |
| **Open** | contributing + `PROVISIONING`, `PENDING_AUTHENTICATION`, `PAUSED`, `HALTED` | Can still bill, or can still come to grant access, without any Kizunia action |
| **Terminal** | `CANCELLED`, `EXPIRED`, `COMPLETED`, `ABANDONED` | Can never change again (history only) |
| **Historical** | any terminal Subscription | Kept forever; never counted by the invariant |

"Scheduled change" is not a Subscription: a pending `cycle_end` plan change is state *on* an open
Subscription ([`upgrade-downgrade.md`](upgrade-downgrade.md)). V1 never creates a second
Subscription to represent a future plan.

## The invariant

> **Kizunia never creates a new open Subscription for a user who already has one.**
> ([SB-UQ-02](../../../project/feature-specification/subscription/decisions/uniqueness-and-resubscription.md#sb-uq-02--kizunia-never-creates-a-second-open-subscription-for-a-user))

**Where it is enforced.** In one precondition policy, evaluated by every creating command (a single
function, so any later relaxation, for example for a switch flow, is a local change:
[IB-21](../implementation/open-decisions.md#ib-21--plan-change-extensibility)), in the checkout command's precondition step, inside the transaction that
holds the user's in-flight `BillingOperation` ([`../commands/operation-model.md`](../commands/operation-model.md)).
Because only one operation per user can be in flight, two concurrent checkouts cannot both see "no
open Subscription".

**Where it is deliberately *not* enforced.** Not as a database constraint on Subscription phases.
Phases are written by synchronization from Razorpay's authoritative state; if Razorpay reports two
open subscriptions, rejecting the write would make Kizunia's records *less* true, not more.
Violations are detected instead (below).

## How each situation is handled

| Situation | Behavior |
| --- | --- |
| Free user buys | Create ([`../commands/checkout-and-creation.md`](../commands/checkout-and-creation.md)) |
| User with an unfinished checkout buys again | Same plan: reuse it. Different plan or expired: cancel it first, confirmed by sync, then create |
| `ACTIVE`/`TRIALING`/`PAST_DUE` user "buys" another plan | Refused. Directed to a native plan change if Razorpay supports one for this subscription ([SB-LC-07](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-07--razorpay-decides-whether-a-plan-change-is-possible)); otherwise told the change is unavailable for their payment method and that they may cancel and subscribe again after the current period |
| User who cancelled at cycle end wants to continue | Refused until the old Subscription is `CANCELLED` (no undo — [SB-LC-09](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-09--a-requested-cycle-end-cancellation-cannot-be-undone)); then an ordinary purchase |
| `HALTED`/`PAUSED` user buys | [Supersession](#supersession) |
| Old `CANCELLED` Subscription + new purchase | Ordinary purchase; history keeps both |

## Supersession

For a user whose open Subscription is `HALTED` or `PAUSED`
([SB-UQ-04](../../../project/feature-specification/subscription/decisions/uniqueness-and-resubscription.md#sb-uq-04--a-halted-or-paused-subscription-is-superseded-only-by-a-confirmed-cancellation)):

```text
1. UI explains: "Your previous <plan> subscription is on hold because a payment failed.
   You can fix the payment method to resume it, or start a new subscription — which
   permanently cancels the old one." (recovery is offered first)
2. User confirms "start new". The checkout request carries supersedesSubscriptionId + the
   confirmation.
3. Root BillingOperation(SUPERSEDE) opens. It holds the user's single root in-flight slot;
   its children run under that slot (IB-6).
4. Child: CANCEL_IMMEDIATELY on the old provider subscription.
     - REJECTED (Razorpay refuses to cancel this state)  -> root REJECTED; user directed to
       recovery; nothing else happens
     - OUTCOME_UNKNOWN                                   -> root ends; the user sees
       "confirming"; no creation in this request
     - SUCCEEDED                                         -> continue
5. Confirm by sync: one targeted priority-1 fetch of the old subscription inside the request;
   require status `cancelled` (not merely a successful cancel response).
     - not yet visible -> root ends SUCCEEDED for the steps done and returns CONFIRMING.
       The user's next request (same supersedesSubscriptionId, new idempotency key)
       re-evaluates from local state and continues once the old subscription is observed
       CANCELLED. No background process continues the command (SB-RC-10).
6. Mark old.supersededBy = new Subscription id; history entry cause = supersession.
7. Child: CREATE_SUBSCRIPTION — the ordinary checkout flow.
```

**In-flight semantics (decided 2026-09-24, [IB-6](../implementation/open-decisions.md#ib-6--composed-commands-and-the-in-flight-constraint)).**
Until 2026-09-24 this section said the in-flight constraint was "held for the whole sequence" and
that the parent "waits" on an unknown outcome. Taken literally, that blocked composed commands,
because parent and child would both be `IN_FLIGHT`, and it did not say how a composed command
continues. The rulings:

- only **root** operations take the per-user slot;
- a command never outlives its request;
- continuation is the user's next request re-evaluating preconditions.

If step 7 never completes (user abandons checkout), the old subscription stays cancelled: that is
what the user confirmed in step 1. The user is Free until they complete a new checkout.

A `halted` subscription can also become live again without the customer touching Kizunia **and
without a card change**: Razorpay documents that a successful charge of an older unpaid invoice moves
`pending` and `halted` subscriptions back to `active`
([`razorpay-facts.md`](../provider-boundary/razorpay-facts.md#payment-retries)). This does not change
the design — supersession already re-checks state by sync before acting — but it is a recovery path the
earlier ledger did not list.

**Verified 2026-09-24 (TEST mode, card subscriptions; [A1](../../../project/feature-specification/subscription/open-decisions.md#a-resolved-answered-by-test-verification-2026-09-24)).**
Razorpay's Cancel API **accepts an immediate cancellation of both `halted` and `paused`**
subscriptions (`200`, then `cancelled` on refetch; `halted` on two subscriptions), so step 4 is
technically supported. The official documentation names only `active`/`authenticated`, so this is
*observed* behavior, not a documented guarantee
([discrepancy D1](../provider-boundary/razorpay-facts.md#documentation-vs-observed-behavior)) — the
step-4 `REJECTED` branch and the step-5 confirm-by-sync are therefore kept exactly as designed. The
step-4 call **must be the immediate form** (`cancel_at_cycle_end: false`, as `CANCEL_IMMEDIATELY`
already is): a cycle-end request on these states returns `200` yet leaves them unchanged (D2), and
would satisfy neither step 5 nor the user's confirmation. Not verified for UPI/e-mandate subscriptions
(the case this path exists for — a revoked UPI mandate): TEST mode cannot reproduce them, so the first
such case in LIVE remains covered by the `REJECTED` branch.

## Detection

Every successful sync that changes a Subscription's phase re-evaluates, in the same transaction, how
many **open** Subscriptions the user has in the current provider mode. More than one raises
`MULTIPLE_OPEN_SUBSCRIPTIONS` ([SB-UQ-05](../../../project/feature-specification/subscription/decisions/uniqueness-and-resubscription.md#sb-uq-05--multiple-open-subscriptions-arising-outside-kizunia-are-detected-never-silently-resolved)),
recorded as an anomaly row (user, subscriptions involved, first seen, resolved at/by) and alerted.

How it can arise despite the invariant:

| Cause | Example |
| --- | --- |
| Dashboard/Subscription-Link creation carrying a user's `notes` | An operator duplicates a subscription |
| A superseded subscription later reinstated | Support reverses a cancellation (if Razorpay ever permits it) |
| A create whose outcome was unknown, followed by a second purchase after the first was wrongly declared `ABANDONED` | Orphan-discovery window too short (the filter is `created_at`, inclusive — [A5](../../../project/feature-specification/subscription/open-decisions.md#a-resolved-answered-by-test-verification-2026-09-24)) |
| A bug | — |

What Kizunia does, and does not do:

- **Access:** the maximum over all contributing Subscriptions
  ([SB-EA-06](../../../project/feature-specification/subscription/decisions/effective-access-and-grants.md#sb-ea-06--effective-access-takes-the-maximum-over-every-contributing-subscription)) —
  deterministic, independent of row order, never less than the user pays for.
- **Commands:** while the anomaly is open, customer self-serve commands for that user are refused
  with "please contact support"; admin commands remain available.
- **Never:** automatic cancellation, refund, or choosing one subscription as "the real one"
  ([SB-RC-10](../../../project/feature-specification/subscription/decisions/reconciliation.md#sb-rc-10--synchronization-only-reads-it-never-changes-provider-state)).
- **Resolution:** an admin cancels the unwanted subscription through a recorded admin command (and
  refunds in the Razorpay Dashboard if appropriate), then marks the anomaly resolved with a reason.

## An older halted subscription recovers after a newer one exists

This is the case from `docs/temp/suscriptions-issues.md`. Under the rules above it cannot arise from
Kizunia's own actions: the older subscription was cancelled (and the cancellation observed) before
the newer one was created. If it arises anyway (a cause from the table above), it is the detection
case: both contribute, the user has the higher of the two tiers, operations is alerted, and a human
decides which one to cancel and whether to refund.
