# Phase VI — Subscription Lifecycle Commands

> **Status:** Implemented 2026-09-26. The code, the UI and the automated tests are complete, and every acceptance criterion holds on the Kizunia side. Two API-only scenarios are verified against Razorpay TEST (a cancelled checkout, and an update refusal). **The phase is not closed:** the card TEST runs its provider work lists are recorded as open until the owner completes the manual checkouts in the [TEST runbook](manual-test.md): the cancel matrix through the new commands, supersession of a `halted` subscription, and the domestic-card refusal through ChangePlan. So is UPI (IB-18, IB-22). Implementation details the documents left open are ruled in [IB-26](../../implementation/open-decisions.md#ib-26--phase-vi-implementation-rulings).
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

The step-by-step runbook, its evidence list and the current status of every scenario are in [manual-test.md](manual-test.md).

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

- [x] Customers can cancel from every cancellable phase with the documented timing, and the UI never claims an effect Razorpay has not shown. *(The cancel matrix is tested per phase against the fake provider, and the UI says "cancellation requested" and answers `CANCELLED` only after a fetch. In TEST: abandoning a `created` checkout (C1). Card-state cancels through the command are open (runbook C2, C4–C6); the raw API matrix is A1's.)*
- [x] `PAST_DUE` cancellation is immediate, and no cycle-end cancel is ever sent outside `ACTIVE`. *(Policy and integration tests. A mutation that allowed cycle-end for `PAST_DUE` failed six tests. A cycle-end request whose own response shows a non-`ACTIVE` phase sets no flag and raises the anomaly.)*
- [x] A user with a halted or paused subscription can start a new one only after the old one is observed cancelled. *(Supersession tests: refused cancel → no create; accepted but still `halted` → `CONFIRMING`, no create; recovered before the cancel → nothing sent. A mutation that created before the observation failed. TEST run of a halted supersession: open, runbook S1.)*
- [x] Native plan changes work where Razorpay allows them. Elsewhere the V1 limitation is shown, and nothing is sent that Razorpay will refuse (except as the authoritative check). *(Upgrade `now`, downgrade `cycle_end`, pending change cleared first, refusal authoritative with the advisory corrected, `UNAVAILABLE` sending nothing: all tested. In TEST: an update refused on a non-active subscription (P6). A successful native change needs an international card: optional, and open (P4, P5).)*
- [x] The plan-change strategy and the open-subscription precondition are single functions (IB-21), so a later switch flow is local. *(`policy/plan-change-strategy.ts`, `planChangeStrategy`; `policy/command-preconditions.ts`, which also holds the cancel and plan-change preconditions.)*
- [x] The UPI recovery UX is either verified and ruled, **or** explicitly recorded as PROVIDER-DEPENDENT and blocking a UPI launch. *(Recorded: [IB-22](../../implementation/open-decisions.md#ib-22--upi-recovery-ux) update of 2026-09-26, runbook U1–U4.)*

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

## Implementation record

Implemented 2026-09-26 on `feat/suscription`, in the commits listed at the end. Every [acceptance criterion](#acceptance-criteria) holds on the Kizunia side. The card TEST runs are still open (see [Open items](#open-items)). Paths are relative to `next/src/modules/billing/`.

**What was built**

- **Rulings.** [IB-26](../../implementation/open-decisions.md#ib-26--phase-vi-implementation-rulings) was recorded before the code relied on it.
- **One precondition module.** `policy/command-preconditions.ts` is still the single place a command's local rules live:
  - the checkout table, now with supersession;
  - the customer cancel matrix (`requiredCancelTiming`: `CYCLE_END` only for `ACTIVE`);
  - the plan-change preconditions;
  - `allowedBillingActions`: cancel with its timing, plan-change options, supersession, recovery.

  So `/me/billing` and the commands cannot disagree.
- **The plan-change strategy** (`policy/plan-change-strategy.ts`) is one pure function of phase, advisory method and direction. It returns `NATIVE_UPDATE` (`now` for an upgrade, `cycle_end` for a downgrade) or `UNAVAILABLE` (`PAYMENT_METHOD`, `SUBSCRIPTION_STATE`, `PRICE_UNKNOWN`, `SAME_PRICE`). Direction is by price, from an optional `amountMinor` on each catalog entry (IB-26 item 6). The advisory treats `advisoryInternationalCard = false` as the limitation, which is how a refusal corrects it (item 7).
- **I-4 in the apply path** (`policy/cancellation-effectiveness.ts`, `backend/sync/apply.ts`). While `cancelAtPeriodEnd` is set, each applied observation is checked for:
  - (i) still `active`/`pending` after the requested period end + the checkpoint margin, where the period end comes from the cancel operation's request;
  - (ii) a `CHARGE` dated after the request;
  - (iii) `HALTED`.

  A hit clears the flag (history `CANCEL_AT_PERIOD_END true → false`) and raises `CANCELLATION_NOT_EFFECTIVE` (`billing.alert`). The apply path also settles an unknown `cycle_end` update that only the provider flag proves, and adopts its target.
- **Shared steps, not a second framework.**
  - The Phase V runner gained:
    - `MutationSpec.call(provider, operation)`, so a child create's `kz_op` is its own;
    - `insertChild`, so a create child is written in the same transaction as its `PROVISIONING` record;
    - `confirmBySync`, where a stale-discarded fetch counts as observed, because the row holds a newer observation.
  - The repository gained `closeParent`, `closeUnsent` and `completeRequest`.
  - New shared steps: `commands/immediate-cancel.ts`, `commands/scheduled-change-step.ts` and `commands/create-subscription-step.ts`, the create extracted from StartCheckout. `abandon-checkout.ts` is now a thin wrapper. StartCheckout's behavior is unchanged: all its Phase V tests pass unmodified.
- **Commands** (`backend/commands/`):
  - `cancel.ts`: the customer cancel. The acknowledged timing selects the root kind, and tx A refuses a changed timing. A cycle-end cancel records `cancelAtPeriodEnd` / `cancelRequestedAt` / `cancelRequestedByOperationId` as a request, first clearing a pending scheduled change as a child confirmed by sync. An immediate cancel answers `CANCELLED` only after a fetch.
  - `admin-cancel.ts`: `MANAGE_BILLING` in the service, a reason on the operation, and the customer's slot.
  - `supersede.ts`: a `SUPERSEDE` root. A re-check by sync, then an immediate-cancel child, then the observation of `cancelled`. After that, `supersededById` and the `SUPERSESSION` history, then a create child. Or `CONFIRMING`, with continuation on the next request.
  - `change-plan.ts`: a `CHANGE_PLAN` root, an optional `CANCEL_SCHEDULED_CHANGE` child, then an `UPDATE_PLAN` child. A `cycle_end` change Razorpay shows pending is mirrored as Kizunia's target; a refusal corrects the advisory.
- **Recovery** (`backend/recovery.service.ts`):
  - `POST /me/billing/recovery` returns the card-change parameters for the caller's own on-hold subscription;
  - `POST /me/billing/sync` is "check now".
- **Routes:**
  - `app/api/v1/me/billing/{cancel,change-plan,recovery,sync}/route.ts`;
  - the supersede fields on `…/checkout`;
  - `app/api/v1/admin/billing/subscriptions/[id]/cancel/route.ts`.

  Rate limits are `billing:command`, `billing:checkout-confirm` and `billing-admin:write` ([configuration](../../implementation/configuration.md#values-chosen-in-phase-vi)).
- **`/me/billing`** adds:
  - the Kizunia subscription `id`, the scheduled change and `cancelRequestedAt`;
  - the `paused` and `cancellationNotEffective` facets;
  - the new allowed actions.

  It still carries no provider identifier.
- **UI** (`frontend/components/subscription-actions.tsx`, `billing-panel.tsx`):
  - the cancel confirmation, with no-undo copy and "ends on `<date>`" or "ends now, no further charge";
  - "cancellation requested" (never "cancelled"), and the not-effective banner;
  - the on-hold card: payment-method change and "check now" first, then "start new", which needs the permanent-cancel confirmation;
  - plan-change options with their timing, or the V1-limitation text.

  One `Idempotency-Key` per click.
- **Test seams and tools:**
  - the fake's `acceptWithoutEffect` (a `200` that changes nothing, A1/D2);
  - `src/testing/billing-lifecycle-fixtures.ts`;
  - `pnpm billing:lifecycle-verify`;
  - a domestic-card case in the opt-in contract suite;
  - the [TEST runbook](manual-test.md).
- **Schema:** none.

**Implementation decisions** (the lasting ones are in IB-26)

- **Orphan discovery now closes child creates too.** It filtered to root creates, which would have left a lost supersession create `PROVISIONING` forever. A mutation check confirms the test catches the filter.
- **A stale-discarded confirming fetch is evidence.** An integration test found it: a webhook fetch that overtook the command's own fetch made the command answer `CONFIRMING` about a subscription already observed `CANCELLED`.
- **A cycle-end cancel's request is completed in tx A** (`completeRequest`) with the period end it is sent in: the runner inserts the root before `prepare` reads the row. This happens inside the uncommitted tx A, so no reader sees another request.
- **"Check now" uses the `CHECKOUT_CONFIRM` sync reason and trigger**: the command model calls it a ConfirmCheckout-style trigger, and no enum value is added.

**Deviations from the documentation**

- **Cancel with a pending scheduled change is rooted at the cancel**, not at a parent kind (IB-26 item 1; the command model said "(parent)").
- **The cancel request carries the acknowledged timing** (IB-26 item 2): an addition the documents do not mention, so the customer's consent is never widened.
- **A composed root's own status on an unknown child is `REJECTED`** with a null `failureClass` (IB-26 item 4). The command model said "ends `SUCCEEDED` for the steps completed", which Kizunia keeps for children that did succeed.

**Verification**

- **Unit tests:** 1,275 after Phase V, 1,372 now. All pass, including `lib/auth.mcp-scopes.test.ts` this run.
- **Integration tests:** 717 after Phase V, 821 now, of which 820 pass. The failure is not in code Phase VI touched: `delivery.integration.test.ts` › "skips a push that is no longer worth sending", the known failure recorded in Phase V. The new suites are:
  - `cancel.integration` (26);
  - `supersede.integration` (16);
  - `change-plan.integration` (19);
  - `admin-cancel.integration` (15);
  - `billing-lifecycle.controller.integration` (18);
  - I-4 and adoption in `apply.integration` (+8);
  - child creates in `orphan-discovery.service.integration` (+2).
- **Mutation checks.** Each of these made its tests fail, and each was reverted byte-for-byte:
  - dropping I-4 detection;
  - allowing a cycle-end cancel for `PAST_DUE`;
  - creating before the old subscription is observed cancelled;
  - skipping the scheduled-change cancel;
  - removing the `UNAVAILABLE` short-circuit;
  - restoring the root-only orphan filter;
  - not counting a stale-discarded fetch;
  - removing the `MANAGE_BILLING` check;
  - setting the cycle-end flag outside `ACTIVE`.
- **Build and lint:**
  - `tsc` is clean (source and tests);
  - `next build` succeeds, with the five new routes and `/user/billing`;
  - `eslint` reports nothing in any file this phase touched.
  - *Environment:* the first build failed on `.next/dev/types/routes.d.ts`, which a running `next dev` had written corrupted while the new route folders appeared. That dev server regenerated the file cleanly when a route file was touched, and the build then passed.
- **Against Razorpay TEST (2026-09-25 UTC, API-only).** Details are in [the run](../../provider-boundary/razorpay-facts.md#phase-vi-lifecycle-run-2026-09-25-utc):
  - C1, a customer cancel of a `created` checkout: `CANCELLED` after a fetch read `cancelled`;
  - P6, a plan update on a non-active subscription at both timings: `REJECTED` / `BAD_REQUEST_ERROR`, with the subscription unchanged.

**Known issues, not caused by this phase**

- `delivery.integration.test.ts` › "skips a push that is no longer worth sending" still fails.
- `asset-admin.integration.test.ts` › "paginates" (a clock flake) and `lib/auth.mcp-scopes.test.ts` (a timeout flake) remain intermittent; both passed in this run.

### Open items

- **Card TEST runs (this phase's provider work).** These need a customer's authenticated card subscription, which only the owner can create (hCaptcha):
  - the cancel matrix through the new commands (runbook C2, C4–C6, C8);
  - supersession of a `halted` subscription (S1, S2);
  - the domestic-card refusal through ChangePlan (P1, P2);
  - the admin cancel (A1);
  - recovery through Razorpay's card change (R1).

  Each is scripted in [the runbook](manual-test.md). None may be recorded as verified until it is run.
- **A successful native plan change** (P4, P5; A3, A15) needs an international-card subscription and the owner's approval.
- **UPI** (IB-18, IB-22, A16 (c)–(f)): no UPI subscription has been authenticated in TEST. The recovery UX is PROVIDER-DEPENDENT and blocks a UPI launch.
- **Not manufacturable in TEST:**
  - I-4 (i) and (ii), and a cycle-end cancel taking effect at `current_end` (A2);
  - a refused supersession cancel (S4);
  - `CONCURRENT_OPERATION` (P7).

  Automated tests cover them, and the first LIVE cycle-end cancel is the one to watch.
- **The LIVE catalog needs an `amountMinor` on every entry** when pricing is set (B6, Phase IX); without one, plan changes stay `UNAVAILABLE`.
- **Undoing a scheduled downgrade** (asking to stay on the current plan) is not a documented command, so it is refused as "the same plan". Raise it as a product question if it is wanted.

**Commits**

In order:

1. the IB-26 rulings
2. the policies, catalog prices and shared command steps
3. `CANCELLATION_NOT_EFFECTIVE` in the apply path
4. the customer cancel
5. the admin immediate cancel
6. supersession, and orphan discovery for child creates
7. the native plan change
8. recovery, "check now", the routes and the summary fields
9. the lifecycle UI
10. the TEST verification script and the contract case
11. the TEST runbook and the TEST run
12. this record and the status updates
