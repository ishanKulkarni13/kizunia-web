# Phase V — Commands and Checkout

> **Status:** Not started
>
> **Depends on:** Phase IV · **Razorpay needed:** TEST (card; UPI once enabled) · **Old slices:** S8, S9

## Objective

Let a Free user become a paying Pro or Pro+ subscriber, safely. After this phase:

- checkout creates exactly one Razorpay subscription per intent, even under double clicks, two tabs, timeouts and crashes;
- access starts only when Razorpay reports it;
- a create whose outcome was lost is found again or closed.

This phase also builds the **command runner** every later mutation uses.

## Scope

- **The command runner** ([command model](../../implementation/command-model.md)):
  - authorize, then idempotency (`Idempotency-Key` required, unique per user);
  - tx A: expire this user's lapsed root, refuse on a young `OUTCOME_UNKNOWN`, refuse on an open multiple-subscriptions anomaly, insert the operation, check preconditions;
  - budget (P1), then the call (no transaction held), then classify;
  - tx B: settle through the **Phase IV apply path**, then respond from local state.
  - Composed commands: a root plus children, no hidden continuation, `CONFIRMING` ([IB-6](../../implementation/open-decisions.md#ib-6--composed-commands-and-the-in-flight-constraint)).
- **The open-subscription precondition** as **one policy function** (SB-UQ-02). This is the seam a later switch flow relaxes ([IB-21](../../implementation/open-decisions.md#ib-21--plan-change-extensibility)).
- **StartCheckout** (`CREATE_SUBSCRIPTION`):
  - the reuse and uniqueness table ([checkout flow](../../implementation/checkout-flow.md));
  - a `PROVISIONING` row before the call;
  - `notes {kz_sub, kz_op, kz_env}`, `expire_by` (C5), `total_count` per cycle;
  - **AbandonCheckout** as a composed child when a pending checkout has a different plan or cycle.
- **ConfirmCheckout:** verify the signature against the **server-held** provider ID, mark due, run a targeted P2 sync, and best-effort fetch the advisory payment method.
- **Orphan discovery** (`billing:orphan-discovery`, P4): a windowed list scan, binding through notes, and closing the window to `ABANDONED` / `NOT_APPLIED` ([orphan discovery](../../reconciliation/orphan-discovery.md)).
- **`GET /api/v1/me/billing`:** a summary DTO with effective plan, capabilities, allowed actions, and state facets ("finishing up", "confirming").
- **A thin UI:** a pricing/plan picker, Razorpay Checkout (`checkout.js`, with `keyId` from the server response), a "finishing up" poll of `/me/billing` (never of Razorpay), and a disabled-mode message.

## Architectural components involved

`modules/billing/backend/commands/*`, the controller, the billing frontend; the Phase IV apply path; the Phase III provider and budget; the internal-jobs registry.

## Dependencies

Phase IV: apply, sync, and webhooks binding `PROVISIONING` rows through notes.

## Files and modules likely affected

Paths are relative to `next/src/`.

- `modules/billing/backend/commands/{command-runner,start-checkout,confirm-checkout,abandon-checkout}.ts`, `policy/command-preconditions.ts`, `backend/reconciliation/orphan-discovery.service.ts`.
- `app/api/v1/me/billing/**` (summary, `checkout`, `checkout/confirm`), `app/api/v1/internal/billing/orphan-discovery/route.ts`.
- `modules/billing/frontend/*`.
- `lib/rate-limit/policies.ts`: `billing:checkout`, `billing:checkout-confirm`, `billing:command`.

## Database and schema work

None beyond Phase III.

## Domain and application work

- A create is **never re-sent** on an unknown outcome (SB-CM-03). It is bound by a webhook or orphan scan, or closed when its window ends.
- Reuse rules:
  - a `PENDING_AUTHENTICATION` checkout with the same plan and cycle whose `expire_by` has not passed returns the stored checkout parameters, with no provider call;
  - one with another plan, or expired, is abandoned (immediate cancel, confirmed by sync), then the new checkout is created.
- Purchases are refused while a `TRIALING`, `ACTIVE` or `PAST_DUE` subscription exists. The response says whether a native plan change might be offered (advisory) or the V1 limitation applies (SB-LC-07).
- `HALTED` and `PAUSED` users are routed to supersession (Phase VI) and refused here until it exists.
- Disabled mode: `503 BILLING_UNAVAILABLE`, with nothing written.

## Provider work

- Manual TEST checkouts with the documented domestic test card, and with e-mandate where TEST completes it.
- **UPI checkout is verified once Razorpay enables UPI on TEST** ([IB-18](../../implementation/open-decisions.md#ib-18--upi-disabled-on-the-razorpay-test-account), [A16](../../../../project/feature-specification/subscription/open-decisions.md#a-razorpay-behavior-requiring-test-mode-verification-or-support) (a), (g)), and recorded in Razorpay facts.
- Observe the `expire_by` lag for abandoned checkouts (A8).

## Integration work

- The checkout UI and polling.
- The server-provided `keyId`: there is no `NEXT_PUBLIC_RAZORPAY_*`.
- Surfacing the "finishing up" and "confirming" states.

## Authorization and entitlement implications

- Commands act only on the session user's own billing. `userId` never comes from the request body.
- Confirm uses the server-held provider ID of the caller's own pending subscription (SB-CM-06).
- Effective access changes only through applied observations.

## Concurrency and transaction considerations

- Two tabs: the root-only partial unique index means the second gets `409` or the reuse row.
- A same-key retry returns the recorded result.
- No provider call inside tx A or tx B.
- The operation lease expires to `OUTCOME_UNKNOWN`, a cheap self-heal inside the next command's tx A and in the tick.
- The orphan window must be long enough (overlap plus the A8 lag) that a slow create is never declared `ABANDONED` too early.

## Observability requirements

- `command.started|settled|rejected|outcome_unknown` and `orphan.window|bound|unmatched` events.
- `billing.alert OPERATION_OUTCOME_UNKNOWN` past its threshold.
- Checkout funnel counts derived from logs.

## Testing requirements

**Integration** (fake provider):
- the happy create;
- a same-key retry;
- two concurrent checkouts (`Promise.all`) → one provider create;
- budget exhausted → `ABANDONED`;
- timeout → `OUTCOME_UNKNOWN`, never re-sent;
- a crash between the call and tx B → lease expiry → unknown;
- abandon then recreate;
- orphan windowing (the watermark advances only after a full window) and a closed window → `ABANDONED`;
- confirm with a bad signature still marks the row due and never binds a foreign ID.

**Manual TEST:** an end-to-end card checkout reaching `ACTIVE`, with access granted.

## Acceptance criteria

- [ ] A Free user completes a TEST card checkout and gains exactly the purchased plan's capabilities once Razorpay reports `active`, never before.
- [ ] No sequence of retries, tabs, timeouts or crashes produces two provider subscriptions from Kizunia's own actions.
- [ ] A lost create response resolves to bound or `ABANDONED` without user action.
- [ ] Disabled mode shows "paid subscriptions are temporarily unavailable" and changes nothing.
- [ ] UPI checkout is verified in TEST and recorded, **or** explicitly recorded as still blocked by IB-18.

## Explicit non-goals

- Trials and marketing codes (Phase VII).
- Cancellation, supersession and plan changes (Phase VI).
- Admin tools beyond what Phase IV provides.
- Kizunia-issued refunds (never in V1).

## Decisions that must already be settled

IB-6, IB-21 (the precondition seam), SB-UQ-01…05, SB-CM-01…06, SB-LC-07. **All are DECIDED.** C5 is IMPLEMENTATION-TIME.

## Risks and blockers

- **Provider-dependent:** UPI checkout cannot be verified until IB-18 is resolved. The code is method-agnostic and the phase can finish with this item recorded as open, but a UPI launch cannot.
- **Risk:** hCaptcha on headless Checkout makes automated end-to-end tests unreliable, so TEST checkouts stay manual.
- **Risk:** an orphan window that is too short causes duplicates. Test with the A8 lag in mind.

## Expected output

The command runner; the open-subscription precondition policy; start, confirm and abandon checkout; orphan discovery; `/me/billing`; the thin checkout UI; the checkout rate-limit policies; tests; a TEST checkout record (card, plus UPI if enabled).
