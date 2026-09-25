# Phase V — Commands and Checkout

> **Status:** Implemented 2026-09-25. Every acceptance criterion is met, and a card checkout was verified end to end against Razorpay TEST. UPI is now offered in TEST Checkout but no UPI checkout has been completed, so IB-18 stays open. Implementation details the documents left open are ruled in [IB-25](../../implementation/open-decisions.md#ib-25--phase-v-implementation-rulings).
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

- [x] A Free user completes a TEST card checkout and gains exactly the purchased plan's capabilities once Razorpay reports `active`, never before. *(Pro monthly by card: Free while `PENDING_AUTHENTICATION`; `ACTIVE` and Pro capabilities from the fetch that followed `subscription.activated`/`.charged`, see [the run](../../provider-boundary/razorpay-facts.md#phase-v-checkout-run-2026-09-25).)*
- [x] No sequence of retries, tabs, timeouts or crashes produces two provider subscriptions from Kizunia's own actions. *(Tests: same key, five concurrent tabs, timeout, lost response, crash before tx B; mutation checks confirm each guard is load-bearing.)*
- [x] A lost create response resolves to bound or `ABANDONED` without user action. *(Tests, and in TEST: a create whose answer was dropped was bound by orphan discovery through its notes; one that never reached Razorpay was closed `ABANDONED` / `NOT_APPLIED`, not before its window.)*
- [x] Disabled mode shows "paid subscriptions are temporarily unavailable" and changes nothing. *(503 `BILLING_UNAVAILABLE` with no row written; `/me/billing` answers `billingAvailable: false` and the page shows the message.)*
- [x] UPI checkout is verified in TEST and recorded, **or** explicitly recorded as still blocked by IB-18. *(Recorded: UPI now appears in TEST Checkout, but no UPI checkout was completed, so IB-18 and A16 remain open.)*

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

## Implementation record

Implemented 2026-09-25 on `feat/suscription`, in 18 commits (listed at the end). Every [acceptance criterion](#acceptance-criteria) is met. Paths are relative to `next/src/`.

**What was built**

- **Rulings.** [IB-25](../../implementation/open-decisions.md#ib-25--phase-v-implementation-rulings) was recorded before the code relied on it.
- **The command runner** (`modules/billing/backend/commands/command-runner.ts`) follows command-model.md step by step:
  - authorize; in disabled mode, 503 before anything is written;
  - a required `Idempotency-Key` (8–128 characters of `[A-Za-z0-9_-]`), unique per user; a same-key retry gets the recorded result;
  - **tx A:**
    - self-heal a lapsed root;
    - refuse on a young `OUTCOME_UNKNOWN` or an open multiple-subscriptions anomaly;
    - insert the root (the partial unique index is the per-user slot; a `P2002` becomes `409 BILLING_OPERATION_IN_PROGRESS`);
    - check the preconditions;
  - the call, with no transaction held;
  - classification (`policy/command-outcome.ts`);
  - **tx B**, through the Phase IV apply path;
  - composed children (`runChild`) and one targeted priority-1 confirmation (`confirmTerminal`), answering `CONFIRMING` when the confirmation is not visible yet.

  Operation writes live in `backend/commands/operation.repository.ts`. The local `PROVISIONING` and `ABANDONED` writes live in `provisioning.ts`.
- **The open-subscription precondition** is one pure policy, `policy/command-preconditions.ts`. It holds the reuse and uniqueness table, the plan-change advisory (SB-LC-07), and `allowedBillingActions`, which is the same rule as `/me/billing` sees it.
- **StartCheckout** (`start-checkout.ts`):
  - a `PROVISIONING` record before the call;
  - the notes `kz_sub`, `kz_op` and `kz_env`;
  - `expire_by` = now + C5, and `total_count` per cycle;
  - reuse, and "still being set up";
  - **AbandonCheckout** (`abandon-checkout.ts`) as a `CANCEL_IMMEDIATELY` child under the create's root, confirmed by a fresh fetch.
- **ConfirmCheckout** (`confirm-checkout.ts`):
  - verifies the signature against the server-held ID only;
  - marks the row due whatever the result;
  - runs a priority-2 targeted sync;
  - fetches the advisory payment method, best effort;
  - records no operation and needs no `Idempotency-Key`.
- **Orphan discovery** (`backend/reconciliation/orphan-discovery.service.ts`, `.task.ts`):
  - windowed and paged at priority 4, with a compare-and-set cursor on `BillingProviderState`;
  - binds through notes;
  - raises `NOTES_CONFLICT`, `PROVIDER_MODE_MISMATCH` and `UNMATCHED_PROVIDER_SUBSCRIPTION`;
  - closes exhausted creates to `ABANDONED` / `NOT_APPLIED`;
  - runs as the tick's `billing:orphan-discovery` task and at `GET /api/v1/internal/billing/orphan-discovery`.
- **`GET /api/v1/me/billing`** (`backend/billing-summary.service.ts`) returns:
  - the effective plan, capabilities and quotas, from the one resolver;
  - the open subscription;
  - the `finishingUp`, `confirming` and `onHold` facets;
  - the allowed actions.

  It carries no provider identifier.
- **Routes:** `app/api/v1/me/billing/{route,checkout/route,checkout/confirm/route}.ts`. They answer `202` while an outcome is pending.
- **Rate limits:** `billing:checkout`, `billing:checkout-confirm` and `billing:command` in `lib/rate-limit/policies.ts`.
- **UI** (`app/(dashboard)/user/billing`, `modules/billing/frontend/`, `modules/billing/api/billing-api.ts`):
  - the current plan, and a plan picker that renders only what the server allows;
  - Razorpay `checkout.js`, loaded on demand and opened with the server's `keyId`;
  - a "finishing up" poll of `/me/billing` only;
  - the disabled-mode message;
  - a "Plan & Billing" sidebar link.

  There is no `NEXT_PUBLIC_RAZORPAY_*`, and a test fails if code reads one.
- **Observability:**
  - events `command.started|settled|rejected|outcome_unknown|replayed`, `checkout.created|confirmed|confirm_synced`, `security.checkout_signature_invalid|checkout_subscription_mismatch` and `orphan.window|bound|unmatched|closed|run`;
  - alerts `billing.alert OPERATION_OUTCOME_UNKNOWN` (from `billing:sync`) and `CHECKOUT_REJECTED`.
- **Tools:** `pnpm billing:checkout-verify` (TEST only).
- **Configuration:** C5 and the rest ([configuration](../../implementation/configuration.md#tuning-values-chosen-in-phase-v)).
- **Schema:** none.

**Implementation decisions**

These are Phase V choices, not changes to settled decisions. The ones with lasting effect are in IB-25.

- **Phase IV's apply, bind and lease-expiry are shared, not copied.**
  - `applyObservation` gained a variant that runs inside the caller's transaction.
  - The bind moved to `backend/sync/binding.ts`. It marks a row event-driven only for a webhook.
  - `ApplyContext.commandOperationId` attributes a command response's history to its operation.
- **Operation and `PROVISIONING` timestamps come from the command's clock,** so the lease, the outcome-unknown window and the orphan window all agree with it.
- **An orphan window that would add no coverage is skipped:** one that ends at or before the watermark. A first run sets the watermark at the oldest unbound `PROVISIONING` record, or at now; it never scans the account's history.
- **A confirmation that finds the checkout already paid answers with the summary** (`signatureValid: null`) instead of an error. In the real run, the webhook applied the payment a second before the browser's confirm arrived.
- **`HttpClient` now merges a caller's headers instead of replacing them,** so `Idempotency-Key` no longer drops `Content-Type`.
- **`ApiResponse.accepted` (202)** was added for pending command outcomes.

**Deviations from the documentation**

- **Refusals before the slot persist no operation.** A young `OUTCOME_UNKNOWN` or an open anomaly refuses the command without recording it; only precondition refusals are recorded. Command-model step 3 lists these checks before the insert, and the self-heal still commits.
- **Reuse answers persist no operation** (IB-25 item 3): nothing is mutated.
- **`billing:orphan-discovery` runs last in the tick,** not before notifications (IB-25 item 6).
- **ConfirmCheckout needs no `Idempotency-Key`** (IB-25 item 8).
- **Checkout.js is injected on demand** rather than through `next/script`, so it loads only when a user chooses a plan.

**Verification**

- **Unit tests:** 1,232 before Phase V's first commit, 1,275 after.
  - The whole suite passes except `lib/auth.mcp-scopes.test.ts`, which also failed at the baseline. It is a 5 s timeout under full-suite load and passes on its own.
- **Integration tests:** 660 after Phase IV, 717 now, of which 715 pass. Neither failure is in code Phase V touched:
  - `delivery.integration.test.ts` › "skips a push that is no longer worth sending": the known failure.
  - `asset-admin.integration.test.ts` › "paginates": a clock-dependent flake. It compares a local-clock window with database timestamps (1 ms skew measured). It failed once and passed on re-run at HEAD, and it passes at the pre-Phase V commit.
- **Mutation checks.** Each of these made the intended tests fail, and each was reverted:
  - removing the slot-conflict mapping;
  - skipping the tx A precondition (eight tests failed, including "one create across concurrent tabs");
  - re-sending a create on an unknown outcome.
- **Build and lint:**
  - `tsc` is clean.
  - `next build` succeeds, with the five new routes and `/user/billing`.
  - `eslint` reports nothing in any file this phase touched. The remaining errors are in the files earlier phases recorded and in the generated Prisma client.
- **Against Razorpay TEST (2026-09-25).** Details are in [the run](../../provider-boundary/razorpay-facts.md#phase-v-checkout-run-2026-09-25).
  - **Scripted:**
    - a create carrying Kizunia's notes;
    - a same-key retry and a new-key reuse;
    - abandon-then-create, with the old checkout observed `cancelled`;
    - an `expire_by` lag of about 156 s;
    - a lost create bound by orphan discovery, and a never-sent one closed `ABANDONED`.
  - **Manual card checkout by the owner:**
    - the subscription went `PENDING_AUTHENTICATION` → `ACTIVE` from the fetch that followed real `subscription.authenticated`, `.activated` and `.charged` deliveries;
    - each delivery was recorded once and answered in 20–34 ms;
    - Pro capabilities arrived only then;
    - one charge money fact was recorded.

**Known issues, not caused by this phase**

- `delivery.integration.test.ts` › "skips a push that is no longer worth sending" still fails.
- `asset-admin.integration.test.ts` › "paginates" (a clock flake) and `lib/auth.mcp-scopes.test.ts` (a timeout flake) fail intermittently.

### Open items

- **UPI (IB-18, A16).** UPI is now offered in TEST Checkout, but no UPI checkout has been completed. A UPI launch still needs that run and the A16 observations.
- **The confirm call's signature check has not met a real payment:** the webhook applied the payment first. A run with the webhook paused would exercise it. Unit and integration tests cover it.
- **Not exercised against TEST:** a failed first payment, a create Razorpay refuses, and e-mandate.
- **The TEST run used the production build behind the temporary ngrok URL** (IB-20). The local `next start` on port 3000 was restarted onto the Phase V build for the run.
- **`billing:command` has no route yet** (Phase VI).
- **The tick's time budget is still unmeasured under realistic load.** This is Phase IV's open item, which now covers the orphan scan too.

**Commits**

Run `git log --oneline e32c5a5..HEAD` for the full list. In order:

1. the IB-25 rulings
2. the `HttpClient` header fix
3. the shared apply, bind and lease-expiry refactor
4. configuration, errors and alerts
5. the precondition and outcome policies
6. the fake's lost-response option
7. the command runner
8. StartCheckout with abandon
9. the `/me/billing` summary
10. ConfirmCheckout
11. the routes and rate limits
12. orphan discovery
13. the checkout UI
14. a test correction
15. the configuration documents
16. the TEST verification script
17. the TEST run and the stale-lag corrections
18. this record
