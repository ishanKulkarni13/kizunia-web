# Phase VI — Razorpay TEST Verification Runbook

> **Status:** C1 and P6 verified against Razorpay TEST on 2026-09-25 (UTC). Every other provider scenario is **UNVERIFIED**; see the [summary matrix](#8-summary-matrix) and [current verification status](#9-current-verification-status).
>
> **Applies to:** the Phase VI lifecycle commands ([phase README](README.md)) · **Tool:** `pnpm billing:lifecycle-verify` (`next/scripts/billing-lifecycle-verify.ts`) · **Mode:** Razorpay **TEST only**

This runbook is how Phase VI's provider behavior is verified against Razorpay TEST. Automated tests run against the fake provider and prove Kizunia's own logic. They never prove what Razorpay does ([testing without Razorpay](../../cross-cutting/testing-without-razorpay.md)). Each scenario below states:

- what to do;
- what Razorpay and Kizunia must then show;
- which evidence to keep.

Write every result into [Razorpay facts](../../provider-boundary/razorpay-facts.md) and into [§9](#9-current-verification-status), **as observed**. Never write a scenario down as verified because the code or a test says it should work.

---

## 1. Purpose, scope and safety

- **TEST only.** `billing:lifecycle-verify` refuses to run unless the provider mode resolves to `TEST`. Never put a `rzp_live_` key in `.env` for this runbook.
- **Secrets are never printed.** The script prints IDs, statuses and classes. It never prints a key secret, a webhook secret or a raw payload. Do not paste secrets into evidence.
- **The dev database, never the integration database.** The script and the app use `DATABASE_URL`. `DATABASE_TEST_URL` belongs to the automated suites and is truncated by them.
- **Operations and history are audit records.** Never delete `billing_operation`, `subscription_history_entry` or `billing_anomaly` rows to "reset" a scenario. Use a fresh verification user instead ([§6](#6-cleanup-and-reset)).
- **Each mutating scenario consumes its subscription.** A cancelled or superseded TEST subscription cannot be reused. Prepare one subscription per scenario ([§4](#4-preparing-subscriptions)).

## 2. Prerequisites and environment

**Software.** Node and pnpm as for the app; `pnpm install` in `next/`; Prisma migrations applied to the dev database (`pnpm prisma migrate deploy`).

**`next/.env` (values never committed):**

| Variable | Value for this runbook |
| --- | --- |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | A TEST pair (`rzp_test_…`) |
| `RAZORPAY_WEBHOOK_SECRET` | The TEST webhook's secret, as registered in the Dashboard |
| `RAZORPAY_ACCOUNT_ID` | The TEST merchant account (webhooks from another account are refused) |
| `BILLING_EXPECTED_MODE` | `test` |
| `DATABASE_URL` | The dev database |
| `BILLING_*` tuning | Leave at defaults ([configuration](../../implementation/configuration.md)), unless a scenario says otherwise |

**Webhooks.** The Phase IV ngrok tunnel is registered in the TEST Dashboard as the webhook URL (`/api/v1/webhooks/razorpay`), with the subscribed events ([IB-20](../../implementation/open-decisions.md#ib-20--a-public-test-webhook-endpoint)). Without it, every scenario still converges, through due syncs and "check now", but the webhook-vs-reconciliation expectations below cannot be observed.

**The app.** Run `pnpm build && pnpm start` (as in the Phase V run) or `pnpm dev`, behind the tunnel.

**Users (dev database):**

- a **customer**, one per scenario, who signs in and completes checkouts;
- a `SUPER_ADMIN`, for the admin cancel;
- an `ADMIN`, for the `403` check.

**Opt-in contract suite** (`pnpm test:contract`, never in CI):

| Variable | Effect |
| --- | --- |
| `RAZORPAY_CONTRACT=1` | Enables the suite |
| `RAZORPAY_CONTRACT_{AUTHENTICATED,ACTIVE,PENDING,HALTED,PAUSED}_SUBSCRIPTION_ID` | Supplied subscriptions in those states (read only, unless the next is set) |
| `RAZORPAY_CONTRACT_MUTATE_SUPPLIED=1` | Lets the suite cancel supplied subscriptions and send the domestic-card update |
| `RAZORPAY_CONTRACT_DOMESTIC_CARD_SUBSCRIPTION_ID` | An `active` domestic-card subscription, for the plan-change refusal (Phase VI) |

**Calling the API by hand.** Every mutating customer endpoint needs an `Idempotency-Key` header (8–128 characters of `[A-Za-z0-9_-]`; use a UUID). Reusing a key replays the recorded answer. Send requests from the signed-in browser session, for example the devtools console, so the session cookie goes with them:

```js
await fetch("/api/v1/me/billing/cancel", {
  method: "POST",
  headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
  body: JSON.stringify({ timing: "CYCLE_END" }),
}).then((r) => r.json());
```

**Endpoints:**

| Endpoint | Body | Notes |
| --- | --- | --- |
| `GET /api/v1/me/billing` | — | The summary: `subscription.id` (a Kizunia ID), `facets`, `allowedActions` |
| `POST /api/v1/me/billing/cancel` | `{ "timing": "CYCLE_END" \| "IMMEDIATE" }` | Key required. `200`, or `202` while being confirmed |
| `POST /api/v1/me/billing/change-plan` | `{ "plan": "PRO" \| "PRO_PLUS", "cycle": "MONTHLY" \| "YEARLY" }` | Key required |
| `POST /api/v1/me/billing/checkout` | `{ plan, cycle, "supersedesSubscriptionId": "<Kizunia id>", "confirmSupersession": true }` | Supersession. Key required |
| `POST /api/v1/me/billing/recovery` | `{}` | Card-change parameters for the caller's own `HALTED`/`PAUSED` subscription |
| `POST /api/v1/me/billing/sync` | `{}` | "Check now": a read-only sync of the caller's subscription |
| `POST /api/v1/admin/billing/subscriptions/{id}/cancel` | `{ "reason": "…" }` | `SUPER_ADMIN`; key required |
| `POST /api/v1/admin/billing/subscriptions/{id}/sync` | — | Admin "sync now" (`VIEW_BILLING`) |

## 3. TEST plan IDs and direction

The four Phase IV verification plans ([configuration](../../implementation/configuration.md#test-verification-plans-phase-iv)). Their prices are TEST-only values, and they also drive plan-change direction ([IB-26](../../implementation/open-decisions.md#ib-26--phase-vi-implementation-rulings) item 6).

| Plan | Cycle | TEST price | Razorpay plan ID |
| --- | --- | --- | --- |
| Pro | Monthly | ₹10 | `plan_TgDgeZ5thTGEr8` |
| Pro | Yearly | ₹12 | `plan_TgDgejlJXhdilW` |
| Pro+ | Monthly | ₹20 | `plan_TgDgfArS3b5MQu` |
| Pro+ | Yearly | ₹22 | `plan_TgDgfLV0VuYLQz` |

They exist already. `pnpm billing:test-plans` is idempotent and only recreates them after a version bump.

**Direction by price.** A higher target price is an upgrade, sent `now`. A lower target price is a downgrade, sent at `cycle_end`.

| From \ To | Pro M ₹10 | Pro Y ₹12 | Pro+ M ₹20 | Pro+ Y ₹22 |
| --- | --- | --- | --- | --- |
| **Pro M ₹10** | — | now | now | now |
| **Pro Y ₹12** | cycle_end | — | now | now |
| **Pro+ M ₹20** | cycle_end | cycle_end | — | now |
| **Pro+ Y ₹22** | cycle_end | cycle_end | cycle_end | — |

## 4. Preparing subscriptions

| State needed | How to reach it in TEST | Notes |
| --- | --- | --- |
| `created` (Kizunia `PENDING_AUTHENTICATION`) | `billing:lifecycle-verify abandon` / `update-refusal` create one themselves; or click a plan in `/user/billing` and close Checkout | API-only |
| `active`, domestic card (`ACTIVE`) | Sign in as the customer, open `/user/billing`, choose a plan, pay with Razorpay's documented domestic test card (Visa 4718 6091 0820 4366, any future expiry and CVV) through the mock 3-D Secure page | hCaptcha blocks headless Checkout, so this is always manual |
| `pending` (`PAST_DUE`) | In the TEST Dashboard, open the active subscription and trigger simulated charge failures ("Charge this now" with a failure) until the status reads `pending` | Method observed 2026-09-24 (A1) |
| `halted` (`HALTED`) | Keep triggering simulated failures until the retries are exhausted (four attempts in the 2026-09-24 run) | Observed twice on 2026-09-24 |
| `paused` (`PAUSED`) | Dashboard **Pause** (or `POST /v1/subscriptions/:id/pause` with `pause_at: now`) on an active subscription | Kizunia never pauses in V1; this is setup only |
| `active`, **international** card | Only with the owner's approval, using an international test card from Razorpay's test-card list | Needed for a *successful* native change (A3, A15) |
| `active`, UPI | Choose UPI in TEST Checkout (offered since 2026-09-25) and complete the mock flow | IB-18 / A16: not yet done |

After each preparation step:

1. Run `pnpm billing:lifecycle-verify status --email <customer>`, or use admin "sync now", so Kizunia observes the state.
2. Check that the Kizunia phase in the output matches.

The `status` output shows both IDs: the Kizunia `id` (what `supersedesSubscriptionId` and the admin route take) and the `providerSubscriptionId` (what the contract suite's `…_SUBSCRIPTION_ID` variables take).

## 5. Scenario catalogue

Every scenario block has the same shape. Unless a block says otherwise, **evidence** is:

- the script or console output;
- `GET /api/v1/me/billing` before and after;
- the `status --email` output (subscription, operations, history, anomalies, and what Razorpay reports);
- the `command.*` / `sync.*` / `billing.alert` log lines;
- a Dashboard screenshot of the subscription's status.

### Cancellation

**C1 — Abandon a pending checkout (API-TEST).**
- *Action:* `pnpm billing:lifecycle-verify abandon`. It creates a verification user and a PRO monthly checkout, then sends the customer cancel with `IMMEDIATE`.
- *Razorpay:* `cancelled`.
- *Kizunia:*
  - subscription `CANCELLED`;
  - operation `CANCEL_IMMEDIATELY` `SUCCEEDED`, request `{atCycleEnd: false, reason: CUSTOMER_CANCEL}`, `requestSentAt` set;
  - history `PHASE PENDING_AUTHENTICATION → CANCELLED`, cause `KIZUNIA_COMMAND`, trigger `COMMAND_RESPONSE` or `COMMAND_CONFIRM`;
  - no anomaly.
- *Result:* `CANCELLED`, returned only after a fresh fetch read `cancelled`.
- *Webhook:* `subscription.cancelled` arrives and is linked, nothing more.

**C2 — ACTIVE: cycle-end cancel, recorded as a request (MANUAL-TEST).**
- *Preconditions:* an `ACTIVE` card subscription.
- *Action:*
  - UI: **Cancel subscription** → the dialog says "ends on `<date>`" and "can't be undone" → **Cancel at period end**.
  - Or: `pnpm billing:lifecycle-verify cancel --email <customer> --timing CYCLE_END`.
- *Razorpay:* still `active`. A2: nothing on the entity shows a pending cycle-end cancel.
- *Kizunia:*
  - `phase ACTIVE`;
  - `cancelAtPeriodEnd = true`, with `cancelRequestedAt` equal to the operation's `requestSentAt`;
  - `cancelRequestedByOperationId` set;
  - operation `CANCEL_AT_CYCLE_END` `SUCCEEDED`, request `{atCycleEnd: true, periodEnd: <current_end>}`;
  - history `CANCEL_AT_PERIOD_END false → true` (`KIZUNIA_COMMAND`);
  - access unchanged (still the paid plan).
- *UI:* "Cancellation requested. Your plan ends on `<date>`." It must never say "cancelled".
- *Retry checks:*
  - The same `Idempotency-Key` returns the same body, with no second provider call (the Dashboard's activity shows one cancel).
  - A **new** key returns `CANCELLATION_REQUESTED`, with no provider call and no new operation.
- *Webhook vs reconciliation:* none expected now. At `current_end` Razorpay should send `subscription.cancelled`. If it is missed, the checkpoint sync at `current_end` + 2 h observes it.
- **Not observable in TEST:** the cancellation actually taking effect at `current_end` (the first cycle ends about 30 days out; A2). Record it as UNVERIFIED unless the subscription is followed to its period end.

**C3 — TRIALING: immediate cancel.** N/A until Phase VII creates trials (a `TRIAL` subscription). Automated only.

**C4 — PAST_DUE: immediate cancel (IB-1) (MANUAL-TEST).**
- *Preconditions:* a `pending` subscription (Kizunia `PAST_DUE`).
- *Action:*
  - UI: the dialog says "ends now and no further charge will be made".
  - Or: `… cancel --email <customer> --timing IMMEDIATE`.
- *Razorpay:* `cancelled` on refetch (A1 observed this against the raw API).
- *Kizunia:*
  - `CANCELLED`, access falls to Free;
  - `CANCEL_IMMEDIATELY` `SUCCEEDED`;
  - no `cancelAtPeriodEnd` ever set.
- *Negative check:* `… cancel --timing CYCLE_END` must be refused with `BILLING_CANCELLATION_TIMING_CHANGED` (`details.timing: IMMEDIATE`) and must send **nothing**: the Dashboard shows no new cancel. The operation is recorded `REJECTED` with `failureClass` and `requestSentAt` both null.

**C5 — HALTED: immediate cancel (MANUAL-TEST).** Same as C4, from `halted`. Expect `cancelled` (A1). A cycle-end request is refused locally, as in C4.

**C6 — PAUSED: immediate cancel (MANUAL-TEST).** Same as C4, from `paused`.

**C7 — Terminal or none (AUTOMATED only).** Refused with `BILLING_NO_SUBSCRIPTION`; nothing sent.

**C8 — ACTIVE with a pending scheduled change (MANUAL-TEST, needs P5 first).**
- *Action:* cycle-end cancel.
- *Razorpay:*
  - `cancel_scheduled_changes` was called, then the cancel;
  - a refetch shows `has_scheduled_changes = false`.
- *Kizunia:*
  - child `CANCEL_SCHEDULED_CHANGE` `SUCCEEDED` under the `CANCEL_AT_CYCLE_END` root;
  - the scheduled fields cleared (history `SCHEDULED_CHANGE … → CANCELLED`);
  - then `cancelAtPeriodEnd = true`, on the **current** plan (SB-LC-08).

**C9 — The phase moved after the page rendered (AUTOMATED; MANUAL-TEST optional).**
- *Action:* load `/user/billing` on an `ACTIVE` subscription, move it to `pending` in the Dashboard, sync it, then confirm the dialog.
- *Expect:* `409 BILLING_CANCELLATION_TIMING_CHANGED`, nothing sent, and the page refreshes to the immediate copy.

### Admin

**A1 — Admin immediate cancel (MANUAL-TEST).**
- *Preconditions:* any open, bound subscription.
- *Action:* `pnpm billing:lifecycle-verify admin-cancel --email <customer> --admin-email <super admin> --reason "verification"`, or `POST /api/v1/admin/billing/subscriptions/<Kizunia id>/cancel` with a key.
- *Razorpay:* `cancelled`.
- *Kizunia:*
  - operation `CANCEL_IMMEDIATELY` with `actorKind ADMIN`, `actorUserId` = the admin, `userId` = the customer, and request `{reason: ADMIN_CANCEL, note: "verification"}`;
  - `CANCELLED`.
- *Negative checks:*
  - as an `ADMIN` or `USER`: `403`, nothing written;
  - without `reason`: `422`;
  - while the customer's own operation is `IN_FLIGHT`: `409 BILLING_OPERATION_IN_PROGRESS`. This is hard to time by hand; the automated test covers it.

### Supersession

**S1 — Supersede a halted card subscription (MANUAL-TEST).**
- *Preconditions:* a `HALTED` card subscription.
- *Action:*
  1. UI: the on-hold card offers **Update payment method** and **Check now** first.
  2. Pick a plan under "Or start a new subscription".
  3. The dialog says the old one "will be cancelled permanently".
  4. **Cancel it and continue**. Or run `… supersede --email <customer> --plan PRO --cycle MONTHLY`.
- *Razorpay (in order):*
  1. a `GET` (the re-check) reads `halted`;
  2. `cancel` (immediate);
  3. a `GET` reads `cancelled`;
  4. a create for the new plan.
- *Kizunia:*
  - root `SUPERSEDE` `SUCCEEDED`, `subscriptionId` = the old one, `requestSentAt` null;
  - children `CANCEL_IMMEDIATELY` (`reason: SUPERSESSION`) and `CREATE_SUBSCRIPTION`, whose `notes.kz_op` is the **child's** ID;
  - old `CANCELLED` with `supersededById` = the new record;
  - history `SUPERSESSION` on the old one (cause `KIZUNIA_COMMAND`);
  - new `PENDING_AUTHENTICATION`;
  - never two open subscriptions at once.
- *Then:* complete the new checkout in the browser. The new one becomes `ACTIVE` from the webhook's fetch.

**S2 — Supersede a paused subscription (MANUAL-TEST).** As S1, from `paused`.

**S3 — CONFIRMING, and the continuation (MANUAL-TEST, timing-dependent).**
- If the fetch after the cancel does not read `cancelled` yet, the answer is `CONFIRMING`, with no create in that request.
- The next request (a new key, the same `supersedesSubscriptionId`) continues once `cancelled` is observed, and creates without a second cancel.
- Nothing continues in the background.
- In practice Razorpay applied immediate cancels at once in A1, so this path may be impossible to provoke. If so, record it as covered by automated tests only.

**S4 — Cancel refused → recovery (UNVERIFIED; not manufacturable).**
- *Expected behavior:* if Razorpay refuses to cancel the on-hold subscription, the answer is `409 BILLING_SUPERSESSION_CANCEL_REFUSED` with `details.recovery: true`, nothing is created, and the old subscription is unchanged.
- TEST accepted immediate cancels on `halted` and `paused` (A1), so a refusal cannot be produced. It is expected for a revoked UPI mandate (the case this path exists for), which TEST cannot model.

### Recovery

**R1 — Payment-method change on a halted card subscription, then "check now" (MANUAL-TEST).**
- *Action:*
  1. UI: **Update payment method**. Or `… recovery --email <customer>` to see whether it is offered.
  2. Complete Razorpay's card-change flow (Checkout opened with `subscription_card_change: 1`).
  3. Back on the page, the handler runs "check now". Or run `… check --email <customer>`.
- *Expected:*
  - Razorpay charges the outstanding invoice and moves the subscription `halted → active` (documented; not yet observed);
  - Kizunia `HALTED → ACTIVE` (cause `PROVIDER_OBSERVED`), with the advisory payment method reset for refresh;
  - access restored.
- *Also check:* the recovery response carries the key ID and the provider subscription ID (the second, and only other, place a provider ID reaches the browser; IB-26 item 8). `/me/billing` still carries none.
- *Webhook:* `subscription.activated` (or `.charged`) triggers the same fetch. "Check now" only makes it sooner.

**R2 — UPI or customer-paused recovery (UNVERIFIED; IB-22).** Cannot be done until a UPI subscription exists in TEST. See U3 and U4.

### Plan change

**P1 — Domestic-card upgrade refused (MANUAL-TEST).**
- *Preconditions:* an `ACTIVE` domestic-card subscription whose advisory method is unknown or `card` with `advisoryInternationalCard` unknown. If the advisory already says domestic, the change is `UNAVAILABLE` locally and nothing is sent: that is P3.
- *Action:* `… change-plan --email <customer> --plan PRO_PLUS --cycle MONTHLY`.
- *Razorpay:* `400 BAD_REQUEST_ERROR` ("Can't update subscription immediately when card mandate is applicable", seen 2026-09-24). The subscription is unchanged.
- *Kizunia:*
  - `UPDATE_PLAN` child `REJECTED` (class `REJECTED`);
  - `CHANGE_PLAN` root `REJECTED`;
  - the answer `409 BILLING_PLAN_CHANGE_UNAVAILABLE` with `reason: PROVIDER_REFUSED`;
  - `advisoryInternationalCard = false` (the correction);
  - plan and access unchanged.
- *Retry check:* a second request is refused locally (`reason: PAYMENT_METHOD`) and sends **nothing**.
- *Also:* the contract suite case with `RAZORPAY_CONTRACT_DOMESTIC_CARD_SUBSCRIPTION_ID` and `MUTATE_SUPPLIED`.

**P2 — Domestic-card downgrade refused (MANUAL-TEST).** As P1, from Pro+ to Pro. Razorpay answers "Only offers can be updated…". The answer is `cycle_end`-shaped, and it is refused the same way.

**P3 — UNAVAILABLE sends nothing (AUTOMATED; MANUAL-TEST optional).**
- With the advisory method `upi`, `emandate`, or `card` + not international, the UI shows the V1 limitation text and offers no plan buttons.
- A direct request is refused with `reason: PAYMENT_METHOD`, and no Update reaches Razorpay.

**P4 — Successful upgrade `now` (MANUAL-TEST; needs the owner's approval for an international card).**
- *Razorpay:* the prorated difference is invoiced and charged, and `plan_id` changes.
- *Kizunia:*
  - `UPGRADED`, history `PLAN` (`KIZUNIA_COMMAND`);
  - access to the new plan **only once the new `plan_id` is observed**.
- *Also answers:* A15 (an Offer across an upgrade), if an Offer is linked.

**P5 — Downgrade at `cycle_end` (MANUAL-TEST; international card).**
- *Razorpay:* `has_scheduled_changes = true`.
- *Kizunia:*
  - `SCHEDULED`, with `scheduledPlan`/`scheduledCycle`/`scheduledByOperationId` set;
  - history `SCHEDULED_CHANGE null → <plan>`;
  - access unchanged.
- *At `current_end`:* the checkpoint sync observes the new plan (A3: whether any webhook fires then is **open**; record what arrives).

**P6 — Update on a non-active subscription is refused (API-TEST).**
- *Action:* `pnpm billing:lifecycle-verify update-refusal`.
- *Expect:* both timings `FAILURE` / `REJECTED` / `BAD_REQUEST_ERROR`; the subscription unchanged (`created`, the same plan, no scheduled change); the cleanup cancel `CANCELLED`.

**P7 — "Another operation in progress" (UNVERIFIED; not reliably manufacturable).** It needs two provider mutations on one subscription at the same instant. Kizunia's own slot prevents that, so only a racing Dashboard action could provoke it. Expected: `CONCURRENT_OPERATION`, `503 BILLING_BUSY` ("try again shortly"), nothing changed, the advisory **not** corrected. Covered by automated tests.

### CANCELLATION_NOT_EFFECTIVE (I-4)

**N1 (i) still billing after the requested period end, N2 (ii) a charge after the request, N3 (iii) halted with the flag set — AUTOMATED only.**

- TEST has no accelerated clock, so none of the three can be forced in a session.
- N3 *can* happen naturally: a C2 subscription that is then failed into `halted` in the Dashboard.
- *If it happens:* `billing.alert CANCELLATION_NOT_EFFECTIVE`, an open `billing_anomaly` (`subjectKey sub:<id>`, `details.reason`), `cancelAtPeriodEnd` cleared (history `CANCEL_AT_PERIOD_END true → false`, `PROVIDER_OBSERVED`), and the "didn't take effect" banner in `/user/billing`.
- *What to watch in LIVE:* the first cycle-end cancel reaching its `current_end`.

### UPI (A16 (c)–(f); IB-18, IB-22)

| ID | Scenario | What to record |
| --- | --- | --- |
| U1 | Cycle-end cancel of an `active` UPI subscription | Accepted? Anything observable? `subscription.cancelled` at `current_end`? |
| U2 | Immediate cancel of `pending`, `halted` and `paused` UPI subscriptions | Accepted, and `cancelled` on refetch? |
| U3 | Recovery of a halted UPI subscription by switching to a card (R1's flow) | Possible at all? The resulting state |
| U4 | A customer-paused UPI subscription (from the UPI app) | Its fetched status and fields. Can Kizunia cancel it? Supersession? |

Until U1–U4 are recorded, the recovery UI order (recovery first, then supersession) is **not** a ruling for UPI, and a UPI launch is blocked (IB-22).

## 6. Cleanup and reset

- **Cancel leftovers:** `pnpm billing:lifecycle-verify cleanup --email <customer>`. It immediately cancels the customer's open, bound TEST subscriptions through an admin-kind operation (reason "verification cleanup"), so the cleanup is recorded like any cancel.
- **Never delete audit rows** (operations, history, anomalies, events, money facts). To start over, sign up a new customer.
- **A verification anomaly**, for example from N3, stays open until someone resolves it with a reason. Phase VIII adds the admin tool; until then, record it here and leave it.
- **Rate limits:** a scripted burst can hit `billing:command` (20 per 10 min). Wait it out; the limiter is per user, so a new customer also works.
- **The Dashboard:** TEST subscriptions cannot be deleted. Cancelled ones remain, which is harmless.

## 7. Supplied IDs and what TEST cannot produce

**Scenarios that need a subscription someone authenticated in the browser** (pass `--email`, or the contract suite's `…_SUBSCRIPTION_ID` variables):

- C2, C4, C5, C6, C8, C9;
- A1;
- S1, S2, S3;
- R1;
- P1, P2, P4, P5;
- U1–U4.

**Scenarios TEST cannot reliably produce:**

| Scenario | Why | Covered by |
| --- | --- | --- |
| A cycle-end cancel taking effect at `current_end` (A2) | No accelerated clock; the first cycle ends about 30 days out | Automated tests, plus the `current_end` checkpoint; watch in LIVE |
| N1, N2 (I-4 (i), (ii)) | Need a renewal after a cancel request | Automated (apply path) |
| S4, a refused supersession cancel | TEST accepts immediate cancels in every open state (A1) | Automated |
| P7, `CONCURRENT_OPERATION` | Needs a simultaneous Dashboard mutation | Automated |
| U1–U4 | Need a UPI subscription (IB-18) | — (UNVERIFIED) |
| P4, P5, a successful native change | Need an international card (the owner's approval) | Automated |
| C3, a trial cancel | Trials arrive in Phase VII | Automated (policy) |

## 8. Summary matrix

- **AUTOMATED:** covered by the fake-provider unit and integration suites.
- **API-TEST:** can be run against Razorpay TEST with no browser.
- **MANUAL-TEST:** needs a customer's authentication in the browser, or Dashboard actions.
- **UNVERIFIED:** no Razorpay TEST observation has been recorded for it yet.

| ID | Scenario | AUTOMATED | API-TEST | MANUAL-TEST | UNVERIFIED |
| --- | --- | --- | --- | --- | --- |
| C1 | Abandon a pending checkout | ✓ `cancel.integration` | ✓ **verified 2026-09-25** | — | — |
| C2 | ACTIVE cycle-end cancel (request, not observation) | ✓ `cancel.integration` | — | ✓ | ✓ |
| C3 | TRIALING immediate | ✓ `cancel.integration`, policy | — | Phase VII | ✓ |
| C4 | PAST_DUE immediate (IB-1) | ✓ `cancel.integration`, policy | — | ✓ | ✓ |
| C5 | HALTED immediate | ✓ | — | ✓ | ✓ |
| C6 | PAUSED immediate | ✓ | — | ✓ | ✓ |
| C7 | Terminal / none refused | ✓ | — | — | — (local only) |
| C8 | Scheduled change cleared first | ✓ `cancel.integration` | — | ✓ (needs P5) | ✓ |
| C9 | Timing changed → 409, nothing sent | ✓ `cancel.integration`, HTTP | — | optional | — (local only) |
| A1 | Admin immediate cancel, authorization, 409 on the slot | ✓ `admin-cancel.integration`, HTTP | — | ✓ | ✓ |
| S1 | Supersede halted | ✓ `supersede.integration` | — | ✓ | ✓ |
| S2 | Supersede paused | ✓ `supersede.integration` | — | ✓ | ✓ |
| S3 | CONFIRMING and continuation | ✓ `supersede.integration` | — | timing-dependent | ✓ |
| S4 | Cancel refused → recovery | ✓ `supersede.integration` | — | not manufacturable | ✓ |
| R1 | Card change on halted + check now | ✓ HTTP (recovery, check now) | — | ✓ | ✓ |
| R2 | UPI / customer-paused recovery | — | — | needs UPI | ✓ |
| P1 | Domestic-card upgrade refused, advisory corrected | ✓ `change-plan.integration` | — | ✓ (+ contract suite) | ✓ |
| P2 | Domestic-card downgrade refused | ✓ | — | ✓ | ✓ |
| P3 | UNAVAILABLE sends nothing | ✓ `change-plan.integration`, policy | — | optional | — (local only) |
| P4 | Successful upgrade now | ✓ | — | ✓ (international card) | ✓ |
| P5 | Downgrade at cycle end mirrored | ✓ | — | ✓ (international card) | ✓ |
| P6 | Update on non-active refused | ✓ | ✓ **verified 2026-09-25** | — | — |
| P7 | CONCURRENT_OPERATION | ✓ | — | not manufacturable | ✓ |
| N1–N3 | CANCELLATION_NOT_EFFECTIVE (i)–(iii) | ✓ `apply.integration`, policy | — | N3 possible | ✓ |
| U1–U4 | UPI lifecycle (A16 (c)–(f)) | — | — | needs UPI | ✓ |

## 9. Current verification status

| Date (UTC) | Scenario | Result | Where recorded |
| --- | --- | --- | --- |
| 2026-09-25 19:17 | C1 | Verified. `CANCEL_IMMEDIATELY` `SUCCEEDED`; the fetch read `cancelled`; local `CANCELLED` | [Razorpay facts](../../provider-boundary/razorpay-facts.md#phase-vi-lifecycle-run-2026-09-25-utc) |
| 2026-09-25 19:17 | P6 | Verified. `now` and `cycle_end` both `REJECTED` / `BAD_REQUEST_ERROR`; subscription unchanged | Same |

**Everything else in [§8](#8-summary-matrix) marked UNVERIFIED is unverified.** In particular:

- the card cancel matrix through the Phase VI commands (C2, C4–C6);
- supersession of a halted subscription (S1);
- the domestic-card refusal classified through ChangePlan (P1, P2);
- recovery (R1);
- all UPI behavior (U1–U4, IB-22).

A UPI launch stays blocked until U1–U4 are recorded (IB-18, IB-22).
