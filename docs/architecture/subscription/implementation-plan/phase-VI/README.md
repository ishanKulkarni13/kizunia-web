# Phase VI — Subscription Lifecycle Commands

> **Status:** Not started
>
> **Depends on:** Phase V · **Razorpay needed:** TEST (card; UPI once enabled) · **Old slices:** S10, S11, S12

## Objective

Give paying users and administrators every lifecycle action V1 supports, each as a recorded command whose effect is observed rather than assumed:

- cancellation, with the timing each phase requires;
- replacing a halted or paused subscription (supersession);
- entry points for recovering a failed payment;
- native plan changes where Razorpay supports them.

Plan changes sit behind a strategy seam, so a switch flow can be added later.

## Scope

- **Customer cancel** ([cancellation](../../lifecycle/cancellation.md)):

  | Phase | Cancel |
  | --- | --- |
  | `ACTIVE` | cycle end; access continues to `current_end`; "cancellation requested" copy; no undo (SB-LC-09) |
  | `TRIALING` | immediate |
  | **`PAST_DUE`** | **immediate**: product decision (owner), [IB-1](../../implementation/open-decisions.md#ib-1--past_due-cancellation) |
  | `HALTED`, `PAUSED` | immediate only |
  | `PENDING_AUTHENTICATION` | abandon |

  A pending scheduled change is cancelled first (SB-LC-08).
- **`CANCELLATION_NOT_EFFECTIVE` detection**: invariant I-4 (i), (ii) and (iii) in the apply path ([PAST_DUE cancellation](../../implementation/past-due-cancellation.md)).
- **Admin immediate cancel** (`MANAGE_BILLING`, reason required).
- **Supersession** of `HALTED`/`PAUSED` ([multiple subscriptions](../../lifecycle/multiple-subscriptions.md#supersession)):
  - an explicit confirmation that says the old subscription will be cancelled permanently;
  - immediate cancel, **confirmed by sync**, then create;
  - `CONFIRMING` when the confirmation is not visible yet;
  - `supersededById` plus a `SUPERSESSION` history entry.
- **Recovery entry points** for `HALTED` and customer-paused subscriptions: open Razorpay's payment-method change, and offer a "check now" sync trigger.
  - **UPI: PROVIDER-DEPENDENT** ([IB-22](../../implementation/open-decisions.md#ib-22--upi-recovery-ux)). The architecture supports both routes (the payment-method change and supersession). Which option(s) the UI offers a UPI subscriber, and in what order, is settled **only after UPI verification in this phase**, and is recorded then as a new ruling.
- **Native plan change** ([upgrade/downgrade](../../lifecycle/upgrade-downgrade.md)):
  - `CHANGE_PLAN` root with children `CANCEL_SCHEDULED_CHANGE` and `UPDATE_PLAN`;
  - upgrades `now`, downgrades `cycle_end`;
  - the scheduled change mirrored on the Subscription;
  - access follows the observed plan.
  - It is selected by the **plan-change strategy policy** (`NATIVE_UPDATE` | `UNAVAILABLE`), [IB-21](../../implementation/open-decisions.md#ib-21--plan-change-extensibility).
  - UPI, e-mandate and domestic-card subscriptions get `UNAVAILABLE`, shown as the documented V1 limitation (cancel at cycle end, buy the new plan after the period ends).
  - The advisory payment method drives the UI. Razorpay's refusal is authoritative and corrects the advisory value.

## Architectural components involved

The Phase V command runner and preconditions; the Phase IV apply path (detection, settling); `modules/billing/backend/commands/*`; the billing frontend.

## Dependencies

Phase V: the runner, checkout (supersession ends in a create), and the advisory payment method.

## Files and modules likely affected

Paths are relative to `next/src/`.

- `modules/billing/backend/commands/{cancel,admin-cancel,supersede,change-plan}.ts`.
- `modules/billing/policy/{command-preconditions,plan-change-strategy}.ts`.
- `backend/sync/apply.ts` (I-4 detection).
- `app/api/v1/me/billing/{cancel,change-plan}/**` and the supersede flag on checkout.
- `app/api/v1/admin/billing/subscriptions/[id]/cancel/route.ts`.
- `modules/billing/frontend/*`: cancel confirmation, recovery, and plan-change UI.

## Database and schema work

None. `supersededById`, the scheduled-change fields and `cancelAtPeriodEnd` exist from Phase III.

## Domain and application work

- `cancelAtPeriodEnd` records Kizunia's **request**, never an observation (I-1). It is cleared only by an observed `CANCELLED` or by raising `CANCELLATION_NOT_EFFECTIVE` (I-3).
- A cycle-end cancel is sent **only** in `ACTIVE`. Every other cancellable phase uses the immediate form (I-2 and IB-1).
- A re-issued cycle-end cancel after `OUTCOME_UNKNOWN` is harmless (A14). An immediate cancel is resolved by the next sync.
- Supersession never creates before the old subscription is **observed** `cancelled`. If Razorpay refuses the cancel, the user is directed to recovery.
- The plan-change strategy is a pure function of (subscription phase, advisory method, target). Callers and the runner never branch on payment method themselves.
- Refused changes: `REJECTED` is shown as "this plan change isn't available for your subscription". It is never retried and never worked around.
- The ₹0.5 proration floor, `CONCURRENT_OPERATION`, and "plan change after a cancel request" are refused as documented.

## Provider work

- TEST: the cancel matrix on card subscriptions (verified states); supersession of a `halted` card subscription; a plan-change refusal classified for a domestic card.
- A **successful** native plan change needs an international-card TEST subscription. Optional, and it needs the owner's approval; it would also answer A3 and A15.
- **UPI verification (when IB-18 allows):** cycle-end cancel of an `active` UPI subscription; immediate cancel of `pending`/`halted`/`paused`; recovery by switching to a card; the state of a customer-paused subscription ([A16](../../../../project/feature-specification/subscription/open-decisions.md#a-razorpay-behavior-requiring-test-mode-verification-or-support) (c)–(f)). Results go into Razorpay facts and settle IB-22.

## Integration work

- Cancel confirmation copy: no undo; "ends on <date>" for `ACTIVE`; "ends now, no further charge" for `PAST_DUE` and `TRIALING`.
- The recovery screen.
- The plan-change screen, which shows the limitation where the strategy is `UNAVAILABLE`.

## Authorization and entitlement implications

- Customers act only on their own subscription.
- Admin immediate cancel requires `MANAGE_BILLING` (`SUPER_ADMIN`) and a reason.
- Access changes only when observations are applied.
- Customer commands are refused, with "contact support", while a `MULTIPLE_OPEN_SUBSCRIPTIONS` anomaly is open. Admin commands stay available.

## Concurrency and transaction considerations

- All of these are root commands in the per-user slot. Admin commands share it (IB-6).
- Composed commands (supersede, change-plan with a pending change) never outlive the request. Continuation is the user's next request.
- Razorpay's "another operation in progress" is classified `CONCURRENT_OPERATION`: nothing changes, and the user may retry.

## Observability requirements

- `command.*` events per kind.
- `billing.alert CANCELLATION_NOT_EFFECTIVE`.
- Supersession and plan-change outcomes in history, with cause `KIZUNIA_COMMAND`.

## Testing requirements

**Unit:** the cancel matrix per phase (including `PAST_DUE` → immediate); the plan-change strategy table; preconditions.

**Integration:**
- supersession: cancel refused → purchase refused; cancel ok but still `halted` → `CONFIRMING` with no create; confirmed → create plus `supersededById`;
- I-4 (i)–(iii) each raise `CANCELLATION_NOT_EFFECTIVE`;
- a plan change with a pending change cancels it first;
- a refusal leaves state unchanged and corrects the advisory method;
- an admin cancel while a user operation is in flight → `409`.

**Provider-TEST:** as listed above.

## Acceptance criteria

- [ ] Customers can cancel from every cancellable phase with the documented timing, and the UI never claims an effect Razorpay has not shown.
- [ ] `PAST_DUE` cancellation is immediate, and no cycle-end cancel is ever sent outside `ACTIVE`.
- [ ] A user with a halted or paused subscription can start a new one only after the old one is observed cancelled.
- [ ] Native plan changes work where Razorpay allows them. Elsewhere the V1 limitation is shown, and nothing is sent that Razorpay will refuse (except as the authoritative check).
- [ ] The plan-change strategy and the open-subscription precondition are single functions (IB-21), so a later switch flow is local.
- [ ] The UPI recovery UX is either verified and ruled, **or** explicitly recorded as PROVIDER-DEPENDENT and blocking a UPI launch.

## Explicit non-goals

- A switch/successor flow for UPI, e-mandate or domestic cards (**DEFERRED**, IB-21).
- Undo of a cancellation (B5).
- Kizunia-issued refunds.
- Auto-cancelling long-halted subscriptions (B2).
- Pausing or resuming by Kizunia.

## Decisions that must already be settled

IB-1, IB-6, IB-21, SB-LC-02…09, SB-UQ-04/05, SB-PF-01…05: **DECIDED**. IB-22 is **PROVIDER-DEPENDENT**, and is settled inside this phase once UPI can be verified.

## Risks and blockers

- **Provider-dependent:** UPI cancel and recovery behavior (IB-18, IB-22).
- **Risk:** the effect of a cycle-end cancel at `current_end` is not observable in TEST (A2). `CANCELLATION_NOT_EFFECTIVE` is the backstop.
- **Risk:** successful native plan changes are only verifiable with an international card.

## Expected output

Cancel (customer and admin), supersession, recovery entry points, native plan change with the strategy seam, I-4 detection, the UI flows, tests, and TEST records (card; UPI where possible), plus the IB-22 ruling if UPI was verified.
