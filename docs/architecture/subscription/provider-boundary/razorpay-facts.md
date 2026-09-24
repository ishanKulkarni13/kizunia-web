# Razorpay Facts

> **Status:** Live — re-verified 2026-09-24 against current official Razorpay documentation
> (first verified 2026-09-21); provider behavior additionally **observed in Razorpay TEST mode on
> 2026-09-24** (see [TEST verification](#test-verification-2026-09-24))
>
> **Last Updated:** 2026-09-24

This is the FACT ledger every ruling in
[`../../../project/feature-specification/subscription/decisions/`](../../../project/feature-specification/subscription/decisions/README.md)
tagged `[RAZORPAY FACT]` links back to. It supersedes `docs/temp/razorpay-feasibility-audit.md`
wherever the two disagree — that document was an earlier research pass; this one reflects direct
verification against Razorpay's live documentation.

**Tags.** **FACT** — explicitly documented, with a source. **TEST-OBSERVED** — observed directly in
Razorpay TEST mode by experiment, with the date; it is evidence of provider behavior, not a
documented guarantee, and where it differs from documentation the difference is recorded under
[Documentation vs observed behavior](#documentation-vs-observed-behavior) and flagged for review.
**INTERPRETATION** — Kizunia's engineering conclusion. **OPEN** — not conclusively established by
documentation or TEST observation; listed in
[`open-decisions.md`](../../../project/feature-specification/subscription/open-decisions.md) as
requiring TEST-mode verification (or a question to Razorpay Support). An OPEN item is never
silently treated as a fact anywhere else in this design.

**2026-09-24 re-verification changed three earlier conclusions**, recorded in
[`reconciliations.md`](../../../project/feature-specification/subscription/decisions/reconciliations.md):
plan updates are refused for UPI, e-mandate and domestic-card subscriptions
([R-06](../../../project/feature-specification/subscription/decisions/reconciliations.md#r-06--the-update-api-does-not-support-plan-changes-for-most-indian-payment-methods));
an Offer *can* be linked to an active subscription (effective at cycle end); and the minimum
proration difference is now documented (₹0.5).

---

## Lifecycle states

**FACT.** A Razorpay Subscription has nine possible states:

| State | Entered when |
| --- | --- |
| `created` | Subscription created, awaiting the authentication transaction |
| `authenticated` | Customer completed the authentication/mandate transaction (also what a future-`start_at` subscription looks like before `start_at`) |
| `active` | "when the billing cycle for the Subscription starts" |
| `pending` | "when an auto-charge on a payment is unsuccessful. We continue to retry the payment while it is in this state" |
| `halted` | "when the last auto-charge is unsuccessful and all retries are exhausted" |
| `paused` | Explicitly paused — "Only Subscriptions in the active state can be paused" |
| `cancelled` | Cancelled — "Once cancelled, a Subscription cannot be restarted" |
| `completed` | End of life per `end_at` / `total_count` |
| `expired` | "If the `start_at` time for the Subscription has been set and the authentication transaction has not been done by the `start_at` time, the Subscription moves to the `expired` state and cannot be used again" |

Documented transitions: `created → authenticated | active`; `authenticated → active`
(pausing an `authenticated` subscription cancels it); `active → pending | paused | completed |
cancelled`; `pending → active | halted`; `halted → active`; `paused → active | cancelled`;
`cancelled`, `completed`, `expired` are terminal.

Sources: [Subscription States](https://razorpay.com/docs/payments/subscriptions/states/),
[Subscription Entity](https://razorpay.com/docs/api/payments/subscriptions/entity/),
[Pause a Subscription](https://razorpay.com/docs/api/payments/subscriptions/pause-subscription/).

**FACT.** A cancelled subscription cannot be reactivated. Resubscribing creates a brand-new Razorpay
subscription object with a new ID.

**FACT.** The Subscription entity's documented `status` enum lists eight values and omits `paused`,
although the Pause API returns `paused`. Source: [Subscription Entity](https://razorpay.com/docs/api/payments/subscriptions/entity/).

**INTERPRETATION.** A status value Kizunia does not recognize is a *malformed* provider response, not
a state to guess at — see [`../reconciliation/provider-rate-limits.md`](../reconciliation/provider-rate-limits.md#provider-failure-taxonomy).
Kizunia's own phase mapping is in [`../lifecycle/state-mapping.md`](../lifecycle/state-mapping.md).

**TEST-OBSERVED (2026-09-24; was OPEN).** A `created` subscription with **no** `start_at` becomes
`expired` once its `expire_by` passes — the documentation ties `expired` only to `start_at`. The
transition is **not instantaneous**: with `expire_by` = now + 45 s, the first fetch that no longer
read `created` came 188 s after `expire_by`, so a subscription past its `expire_by` can still read
`created` for a few minutes. `expired` is terminal and cannot be cancelled ("Subscription is not
cancellable in expired status." — matches the documented error). `expire_by` values as short as 30 s
in the future were accepted; a past value is rejected with `BAD_REQUEST_ERROR` ("Link expire by cannot
be lesser than the current time."). Whether a payment made inside the lag window would succeed was
not tested.

---

## Subscription entity

**FACT.** Documented fields: `id`, `plan_id`, `customer_id`, `status`, `quantity`, `total_count`,
`paid_count`, `remaining_count`, `current_start`, `current_end`, `ended_at`, `charge_at`,
`start_at`, `end_at`, `auth_attempts`, `expire_by`, `addons`, `offer_id`, `short_url`,
`has_scheduled_changes`, `change_scheduled_at` (`now` | `cycle_end`), `customer_notify`, `notes`,
`source`. **There is no documented `payment_method` field.** Source:
[Subscription Entity](https://razorpay.com/docs/api/payments/subscriptions/entity/).

**FACT.** `customer_id` is not a create parameter; Razorpay creates the customer automatically when
the authentication payment is made — "There is no need to create a customer when using Razorpay
Subscriptions." Source: [Subscriptions Workflow](https://razorpay.com/docs/payments/subscriptions/workflow/).

**INTERPRETATION.** The payment method a subscription is authorized with can only be learned from
the authorization *payment* (its `method`, and for cards whether the card is international), not
from the subscription entity. Kizunia stores it as advisory UX data only — see
[SB-LC-07](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-07--razorpay-decides-whether-a-plan-change-is-possible).

**TEST-OBSERVED (2026-09-24; was OPEN).** A *requested but not yet effective* cycle-end cancellation
is **not visible** in the fetched entity. Comparing the full entity before and after a successful
`cancel_at_cycle_end: true` on an `active` subscription showed **no differing field**
(`status`, `has_scheduled_changes`, `change_scheduled_at`, `charge_at`, `end_at` and every other
field were unchanged), and both `retrieve_scheduled_changes` and `cancel_scheduled_changes` answer
"No Pending update for this subscription". Only Kizunia's own record can say "cancels at period end".
That the cancellation actually takes effect at `current_end` **could not be observed** — TEST mode has
no accelerated clock and the first cycle ends ~30 days out.

**TEST-OBSERVED (2026-09-24) — fields not in the documented entity.** Fetched subscriptions also
carry `payment_method` (`"card"` and `"emandate"` observed; `null` before authentication),
`halted_at` (epoch when halted, else `null`), `card_mandate_id` (for card subscriptions),
`customer_email` and `customer_contact` (populated from Checkout). `customer_id` was `null` on
fetches immediately after authentication and populated on later fetches. This **contradicts** the
documented "no `payment_method` field" statement above — see
[Documentation vs observed behavior](#documentation-vs-observed-behavior) (D3). Kizunia should treat
these as useful but undocumented: it may read them defensively, never depend on them.

---

## Creating subscriptions

**FACT.** Create Subscription accepts `plan_id` (required), `total_count` (required), `quantity`,
`start_at` ("If not passed, the Subscription starts immediately after the authorisation payment"),
`expire_by` ("till when the customer can make the authorisation payment… The default value is 30
years"), `customer_notify` (default `true`: Razorpay handles customer communication), `addons`
(upfront amount collected with the authorisation transaction), `offer_id`, and `notes` ("a maximum
of 15 key-value pairs"). Source: [Create a Subscription](https://razorpay.com/docs/api/payments/subscriptions/create-subscription/).

**FACT.** No idempotency key, header, or other duplicate-suppression mechanism is documented for
Create Subscription. Razorpay documents idempotency headers only for Payouts
(`X-Payout-Idempotency`) and Refunds (`X-Refund-Idempotency`). Sources:
[Create a Subscription](https://razorpay.com/docs/api/payments/subscriptions/create-subscription/),
[Payout idempotency](https://razorpay.com/docs/api/x/payout-idempotency/make-request/),
[Idempotent refunds](https://razorpay.com/docs/api/refunds/normal-refunds-idempotent/).

**INTERPRETATION.** A create whose response is lost cannot be safely retried: a retry may create a
second real subscription. Creation idempotency is therefore entirely Kizunia's — a local intent
row written *before* the call, and Kizunia identifiers carried in `notes` so the provider object can
be found again. See [`../commands/checkout-and-creation.md`](../commands/checkout-and-creation.md).

**TEST-OBSERVED (2026-09-24; A13, was OPEN).** The maximum `total_count` is enforced per plan
period/interval and is reported in the rejection (`400 BAD_REQUEST_ERROR`, "Exceeds the maximum
total_count (N) allowed for the given period and interval"). Observed maxima: `yearly` ×1 → 100;
`monthly` ×1 → 1200; `monthly` ×3 → 400; `monthly` ×12 → 100; `weekly` ×1 → 5200; `weekly` ×4 →
1300; `daily` ×7 → 5214.29 (a non-integer, so treat the reported value as a bound to floor). The
pattern is a ceiling of roughly **100 years of billing**; the smallest accepted value tested was 1.
For Kizunia's monthly and yearly plans a `total_count` of 1200 / 100 is the ceiling; the choice of
the actual value remains configuration.

**FACT.** At checkout completion Razorpay returns `razorpay_payment_id`, `razorpay_subscription_id`
and `razorpay_signature`; the signature is `hmac_sha256(razorpay_payment_id + "|" +
subscription_id, key_secret)`, where `subscription_id` should be the one held by the merchant's
server, not the value echoed back by Checkout. Source:
[Subscriptions Integration Guide](https://razorpay.com/docs/payments/subscriptions/integration-guide/).

---

## Listing subscriptions

**FACT.** Fetch All Subscriptions supports `plan_id`, `from`, `to` (Unix timestamps), `count`
(default 10, **maximum 100**) and `skip` (offset pagination). Returned items include `notes`,
`has_scheduled_changes`, `change_scheduled_at`, `customer_id`, `offer_id` and `source`. No
`customer_id` filter is documented. Source:
[Fetch All Subscriptions](https://razorpay.com/docs/api/payments/subscriptions/fetch-subscriptions/).

**TEST-OBSERVED (2026-09-24; was OPEN).** `from`/`to` filter on **`created_at`**, and both bounds
are **inclusive**. Tested on a subscription whose `start_at` was 420 s after its `created_at`: a
window around `created_at` returned it; a window around `start_at` did not; `from == created_at`
returned it; `from = created_at + 1` did not; `to == created_at` returned it. Not tested: whether the
filter behaves differently for other timestamps (`ended_at`, `halted_at`).

**INTERPRETATION.** Finding provider subscriptions Kizunia lost track of is feasible, but only as a
bounded, windowed, paginated scan — see [`../reconciliation/orphan-discovery.md`](../reconciliation/orphan-discovery.md).

---

## Payment retries

**FACT.** Cards: "Once every day for 3 days, excluding the date of the charge. If the payment fails
on all retries, the Subscription moves to the halted state." UPI follows the same T+1, T+2, T+3
schedule. E-mandate: "we attempt to retry only when we get the confirmation or rejection of the last
payment, as it may take more than 24 hours", with charge dates shifting around bank holidays. No
merchant configuration of the schedule is documented. Source:
[Payment Retries](https://razorpay.com/docs/payments/subscriptions/payment-retries/).

**FACT.** Once `halted`, "Invoices for such Subscriptions are still created. However, we will not
charge these invoices." No time bound after which a halted subscription auto-cancels is documented.
Source: same.

**FACT.** Recovery: the customer changes their payment method (via the failure email's link,
Checkout with `subscription_card_change`, or a hosted page); "If the customer successfully changes
the card details when a Subscription is in the halted state, it moves to the active state." A
UPI/e-mandate subscription can switch only to a card. Previously missed charges are not re-attempted
automatically — "Only future payments are charged automatically." Sources: same, and
[Subscription States](https://razorpay.com/docs/payments/subscriptions/states/).

**INTERPRETATION.** A halted subscription can return to `active` at any time through a path that
never touches Kizunia's UI (the Razorpay-sent email link, since `customer_notify` defaults to
`true`). Kizunia must detect this rather than assume it cannot happen — see
[`../lifecycle/multiple-subscriptions.md`](../lifecycle/multiple-subscriptions.md).

**TEST-OBSERVED (2026-09-24) — retry progression under Dashboard-simulated failures (card).** With
failures produced by the Dashboard's "Charge this now" (see [Test vs live mode](#test-vs-live-mode)):
`active → pending` on the first failed charge; each further failure incremented `auth_attempts`
(observed 1, 2, 3, 4) and advanced `charge_at` by exactly 86 400 s (one day); after the fourth failed
attempt the subscription became `halted` with `halted_at` set and `auth_attempts` reset to 0. This
matches the documented "3 retries after the original attempt" (4 failures total). The retry schedule
here is a *simulation* driven by manual clicks, not Razorpay's real T+1/T+2/T+3 clock.

**OPEN (not reproducible in TEST).** Real-world e-mandate retry timing under Indian banking holidays
(A11): TEST mode has no banking calendar. The halted-state behavior of a UPI/e-mandate subscription
whose mandate the customer has revoked (A10): TEST mode offers no way to revoke a mandate. An e-mandate
registration was started in TEST mode but stayed `created` (see
[TEST verification](#test-verification-2026-09-24)), so no e-mandate lifecycle beyond registration was
observed. **Halted recovery** (customer changes payment method) was not exercised — it needs the
customer-side card-change flow; one `halted → pending` transition was observed during Dashboard
clicking on a halted subscription but its cause could not be attributed (see D9).

---

## Upgrade / downgrade

**FACT.** "You can only update Subscriptions in the `authenticated` and `active` states.
Subscriptions in the `created`, `pending` or `halted` state cannot be updated." Source:
[Update a Subscription (guide)](https://razorpay.com/docs/payments/subscriptions/update/).

**FACT — payment-method restrictions.** The Update API returns "Subscriptions cannot be updated when
payment mode is UPI" and "subscriptions cannot be updated when payment mode is emandate". The guide
states: "For Subscriptions created using domestic cards, you can update only the offer that is
linked to them." Sources: [Update a Subscription (API)](https://razorpay.com/docs/api/payments/subscriptions/update-subscription/),
[Update a Subscription (guide)](https://razorpay.com/docs/payments/subscriptions/update/).

**INTERPRETATION.** A native plan change is possible only for subscriptions authorized with an
international card. For UPI, e-mandate and domestic-card subscriptions — expected to be the large
majority of Kizunia's customers — Razorpay cannot change the plan of an existing subscription. See
[SB-LC-07](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-07--razorpay-decides-whether-a-plan-change-is-possible).

**FACT.** Updatable fields: `plan_id`, `offer_id`, `quantity`, `remaining_count` ("must be at least
1"), `start_at`, `schedule_change_at` (`now` | `cycle_end`), `customer_notify`. "If the plans have
different billing cycles, the new plan is billed at the new interval, starting on the day of the
change." Source: same.

**FACT — proration.** On an immediate upgrade Razorpay invoices and charges the prorated
difference; "If the charge fails, the Subscription is not updated." On an immediate downgrade "A
refund to a customer is done using a Credit Note." "ensure that the prorated amount difference
between the existing and new plans is at least 50 currency subunits, that is, ₹0.5." Immediate
updates are notified via `subscription.updated`. Source: same.

**FACT.** "Subscriptions with active offers can only be downgraded at the end of the billing cycle."
Source: [Update a Subscription (API)](https://razorpay.com/docs/api/payments/subscriptions/update-subscription/).

**FACT.** A concurrent mutation is rejected: "Request failed because another subscription operation
is in progress." Source: same.

**FACT.** Subscriptions can be updated from the Dashboard as well as the API. Source:
[Update a Subscription (guide)](https://razorpay.com/docs/payments/subscriptions/update/).

**TEST-OBSERVED (2026-09-24; A4, partially resolved) — domestic-card refusals.** Updating an `active`
subscription authorized with a **domestic card** is refused with `HTTP 400`, code
`BAD_REQUEST_ERROR`, and these descriptions:

| Request | Description | `field` |
| --- | --- | --- |
| `plan_id` with `schedule_change_at: "now"` | "Can't update subscription immediately when card mandate is applicable" | none |
| `quantity` with `schedule_change_at: "now"` | same | none |
| `plan_id` with `schedule_change_at: "cycle_end"` | "Only offers can be updated for subscriptions when payment mode is domestic card." | `offer_id` |
| `remaining_count` with `schedule_change_at: "cycle_end"` | same | `offer_id` |

Every case is `BAD_REQUEST_ERROR`, consistent with the current fallback ("any `BAD_REQUEST_ERROR` is
classified `REJECTED`"), but the code is **not specific** — the distinguishing signal is the free-text
description, which Kizunia must not parse. A refused update left the subscription unchanged
(`has_scheduled_changes` stayed `false`). **Not verified:** the UPI and e-mandate refusals (UPI cannot
be authorized through Checkout in TEST; an e-mandate registration did not complete, see below).

**OPEN (not verified).** Whether any webhook fires when a `cycle_end` change is *applied* (A3):
a *successful* native plan change needs an international-card subscription (domestic cards allow
only offer updates) and a registered webhook endpoint; the first was ruled out for this verification
and the second was not available (see [TEST verification](#test-verification-2026-09-24)). How Razorpay
treats an active Offer on upgrade (A15) is open for the same reasons, plus Offers can be created only
from the Dashboard.

---

## Scheduled changes

**FACT.** Two APIs operate on a pending `cycle_end` update: Fetch Details of a Pending Update
(`GET /v1/subscriptions/:id/retrieve_scheduled_changes`) and Cancel an Update
(`POST /v1/subscriptions/:id/cancel_scheduled_changes`) — "You can only cancel a pending update for
a subscription. You cannot cancel an update once it is live." Neither applies to cancellations.
Sources: [Fetch Pending Update](https://razorpay.com/docs/api/payments/subscriptions/fetch-pending-update-details/),
[Cancel an Update](https://razorpay.com/docs/api/payments/subscriptions/cancel-update/).

---

## Cancellation

**FACT.** Cancel Subscription accepts `cancel_at_cycle_end`: "true: Cancel the subscription at the
end of the current billing cycle. false (default): Cancel the subscription immediately." With
`true`, the status "becomes `cancelled` only when the current billing cycle ends." Source:
[Cancel a Subscription](https://razorpay.com/docs/api/payments/subscriptions/cancel-subscription/).

**FACT.** Cycle-end cancellation is refused when "no billing cycle is going on" (e.g. before the
first cycle — which includes a trial) and when "The subscription is in its final cycle"; immediate
cancellation must be used instead. `expired` and already-`cancelled` subscriptions cannot be
cancelled. Source: same.

**FACT.** No API to revoke a requested cycle-end cancellation is documented. Source: same.

**FACT.** Subscriptions can be cancelled from the Dashboard, immediately or at cycle end. Source:
[Pause, Resume and Cancel](https://razorpay.com/docs/payments/subscriptions/pause-resume-cancel/).

**TEST-OBSERVED (2026-09-24; A1, was OPEN) — which states accept cancellation.** The API page names
only `active`/`authenticated`; the states diagram shows `paused → cancelled`. Observed in TEST mode
against the live API, each result confirmed by a separate `GET` of the subscription:

| State when cancelled | `cancel_at_cycle_end: false` (immediate) | `cancel_at_cycle_end: true` |
| --- | --- | --- |
| `created` | **Accepted** — `200`, then `cancelled` | Refused — `400` "Subscription cannot be cancelled since no billing cycle is going on" |
| `authenticated` (trial) | **Accepted** — `200`, then `cancelled` | Refused — `400`, same message |
| `active` | Accepted (documented) | `200`; state stays `active`; effect invisible (see above) |
| `pending` | **Accepted** — `200`, then `cancelled` (stays `cancelled` on refetch) | **`200` but state unchanged** — no cancellation observed |
| `paused` | **Accepted** — `200`, then `cancelled`; a later `resume` is refused ("can't be resumed as subscription is in cancelled state") | **`200` but state unchanged** (`paused`) |
| `halted` | **Accepted** — `200`, then `cancelled` (observed on two subscriptions) | **`200` but state unchanged** (`halted`) |
| `expired` | Refused — `400` "Subscription is not cancellable in expired status." (`field: "status"`) | not tested |
| `cancelled` | Refused — `400` "Subscription is not cancellable in cancelled status." (`field: "status"`) | not tested |

**INTERPRETATION.** Immediate cancellation is the only cancellation whose effect is verified for
`created`, `pending`, `paused` and `halted`; it works for all four and is terminal. A **`200` from a
cycle-end request on `pending`/`paused`/`halted` must never be read as a cancellation** — the
documented refusal for "no billing cycle is going on" is *not* returned in these states, and the
subscription is unchanged. Whether such a request is recorded for later or is a silent no-op could not
be determined (there is no accelerated clock). See the architecture impact recorded in
[`../lifecycle/cancellation.md`](../lifecycle/cancellation.md#customer-cancellation--which-kind).

**TEST-OBSERVED (2026-09-24; A14, was OPEN).** Re-sending `cancel_at_cycle_end: true` to an `active`
subscription that already received one **succeeds again with `200`** and changes nothing observable;
it does not error. Combined with the A2 result, a repeated cycle-end request is harmless but also
unconfirmable.

**TEST-OBSERVED (2026-09-24) — other cancellation facts.** A pending cycle-end cancel did not prevent
an immediate cancel (on the same subscription: request cycle-end, then cancel immediately →
`cancelled`; observed for `active`, `pending` and `halted`). Response bodies of `pause`/`resume`/`cancel` were not always consistent with the state a
later `GET` returned (D9) — the authoritative `GET` is the truth.

---

## Pause / resume

**FACT.** `pause_at` and `resume_at` accept only `now`. Only `active` subscriptions can be paused;
pausing sets `paused_at` and nulls `current_start`, `current_end` and `charge_at`. Pause may need to
be enabled on the account. Only `paused` subscriptions can be resumed; resume can fail if the
mandate is no longer valid. Sources: [Pause](https://razorpay.com/docs/api/payments/subscriptions/pause-subscription/),
[Resume](https://razorpay.com/docs/api/payments/subscriptions/resume-subscription/).

**TEST-OBSERVED (2026-09-24).** `pause` (`pause_at: "now"`) on an `active` card subscription →
`paused`, `charge_at` becomes `null`. Unlike the documentation, **`current_start` and `current_end`
were retained** (D4). Pausing an already-paused subscription and resuming a non-paused one are refused
with `400 BAD_REQUEST_ERROR` ("subscription can't be paused as subscription is in paused state" /
"can't be resumed as subscription is in active state"; the same wording with `halted`/`cancelled`).
`resume` on a `paused` subscription → `active` with `charge_at` restored. A `paused` subscription can
be cancelled immediately (see [Cancellation](#cancellation)). Pause was enabled on the TEST account
without any special request.

**INTERPRETATION.** Kizunia never pauses or resumes a subscription itself in V1. A `paused`
subscription only arises from the Dashboard or the customer's UPI app.

---

## Payment methods and customer-originated changes

Razorpay-side changes that Kizunia did not issue come from Dashboard operators and from customers.

**FACT.** UPI AutoPay customers "can manage, modify or cancel their mandates anytime directly from
their UPI app"; merchants learn of a cancellation through the `subscription.cancelled` webhook. "For
UPI Subscriptions, you cannot resume a Subscription paused by your customer. If your customer pauses
a Subscription, only they can resume it." Source: [Subscriptions FAQs](https://razorpay.com/docs/payments/subscriptions/faqs/).

**FACT.** Subscriptions and Subscription Links can be created from the Dashboard as well as the API,
and Dashboard users can pause, resume, cancel (immediately or at cycle end) and update
subscriptions. Sources: [Create Subscriptions](https://razorpay.com/docs/payments/subscriptions/create/),
[Subscription Links](https://razorpay.com/docs/payments/subscriptions/create-subscription-links/),
[Pause, Resume and Cancel](https://razorpay.com/docs/payments/subscriptions/pause-resume-cancel/).

**FACT.** RBI card-mandate rules: mandate registration limit ₹15,000; banks send a pre-debit
notification at least 24 hours before a debit; customers may opt out of a debit or withdraw the
mandate at any time. Source: [RBI card mandate guidelines](https://razorpay.com/docs/announcements/rbi-card-mandate-guidelines/subscriptions/).

**FACT.** Documented UPI transaction limits are inconsistent across Razorpay pages (₹15,000 on older
FAQ entries; up to ₹1,00,000 on the supported-payment-methods page). Source:
[Supported payment methods](https://razorpay.com/docs/payments/subscriptions/supported-payment-methods/).
Not architecturally relevant at Kizunia's price points; recorded so nobody relies on either number.

**INTERPRETATION.** Subscription state changes have **three** possible originators — Kizunia, a
Razorpay Dashboard operator, and the customer (through their UPI app or bank) — and Kizunia cannot
distinguish the latter two. See
[SB-LC-06](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-06--a-dashboard-originated-change-is-a-normal-lifecycle-path).

---

## Trials

**FACT.** "To create a trial period for your customers, provide a future start date when creating
the Subscription." There is no trial object or flag. With a future start and no upfront amount, the
customer is charged ₹5 at authentication, auto-refunded. Sources:
[Create Subscriptions](https://razorpay.com/docs/payments/subscriptions/create/),
[Subscriptions Workflow](https://razorpay.com/docs/payments/subscriptions/workflow/).

**FACT.** Razorpay has no concept of "this customer already had a trial". Source: absence across the
same pages; recorded because eligibility is therefore entirely Kizunia's
([SB-LC-11](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-11--one-trial-per-account)).

**INTERPRETATION.** A future-`start_at` subscription is indistinguishable at Razorpay from a trial —
so Kizunia cannot infer "trial" from provider state and must record it itself
([SB-LC-10](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-10--subscription-kind-is-recorded-at-creation-never-inferred)).

**TEST-OBSERVED (2026-09-24; A7, partially resolved).** A subscription created with a future
`start_at` and authenticated by card is `authenticated` until `start_at`, with `paid_count: 0`,
`charge_at == start_at` and `current_start`/`current_end` both `null`. It can be cancelled only
immediately (see [Cancellation](#cancellation)). In TEST mode the subscription was still
`authenticated` **47 minutes after `start_at`** with no charge attempted — TEST mode does not run the
scheduled first charge promptly (or at all within the window), and the Dashboard's "Charge this now" is
documented only for `active`/`pending` subscriptions.

**OPEN (not reproducible in TEST).** What happens when the first real charge at `start_at` **fails**
(presumed the ordinary `pending → halted` path, unchanged). The state before `start_at` is settled;
the failure path needs the first charge to run, which TEST mode did not do.

---

## Webhooks

**FACT.** Signatures are HMAC-SHA256 over the **raw** request body with the webhook secret (distinct
from API keys), in `X-Razorpay-Signature`. "Do not parse or cast the webhook request body." Source:
[Validate and Test Webhooks](https://razorpay.com/docs/webhooks/validate-test/).

**FACT.** After the webhook secret is changed, "remember to use the old secret for webhook signature
validation while retrying older requests. Using the new secret will lead to a signature mismatch."
Source: [Webhooks FAQ](https://razorpay.com/docs/webhooks/faqs/).

**FACT.** `x-razorpay-event-id` "is unique per event and can help you determine the duplicity of a
webhook event." Source: [Webhooks Best Practices](https://razorpay.com/docs/webhooks/best-practices/).

**OPEN — NOT VERIFIED (A6).** Whether the header is present on every delivery and identical across
retries of one event (implied, not stated). Observing it needs a public HTTPS endpoint registered in
the Dashboard's TEST webhooks (Razorpay offers no API to register one) and a way to fail deliveries on
purpose; no such endpoint existed and the decision for this verification was to skip webhooks (see
[TEST verification](#test-verification-2026-09-24)). **No webhook behavior of any kind was verified.**

**FACT.** "Razorpay follows at-least-once delivery semantics." A response must be 2xx within 5
seconds; "Razorpay considers any non-2xx response as an event delivery failure"; failed deliveries
are retried with exponential backoff "for 24 hours after event creation timestamp", after which "the
webhook is disabled" until re-enabled from the Dashboard, with an alert email. Exact retry intervals
are not documented. Sources: [Webhooks Best Practices](https://razorpay.com/docs/webhooks/best-practices/),
[Set up Webhooks](https://razorpay.com/docs/webhooks/setup-edit-payments/).

**FACT.** "you may not always receive the webhooks in order." Source: [Webhooks Best Practices](https://razorpay.com/docs/webhooks/best-practices/).

**FACT.** Missed webhooks can be replayed only through Razorpay Support, only for events under 15
days old, and only if the webhook was enabled at the time. Source: [Webhooks FAQ](https://razorpay.com/docs/webhooks/faqs/).

**FACT.** The complete `subscription.*` catalog is ten events:

| Event | Fires when |
| --- | --- |
| `subscription.authenticated` | Authentication transaction completes |
| `subscription.activated` | Transition to `active` (from `authenticated`, `pending` or `halted`) |
| `subscription.charged` | Every successful recurring charge |
| `subscription.completed` | Subscription reaches `completed` |
| `subscription.updated` | Subscription updated (documented for immediate updates) |
| `subscription.pending` | Enters `pending`; re-fires on continued failure |
| `subscription.halted` | `pending → halted` |
| `subscription.cancelled` | Cancelled |
| `subscription.paused` | Paused |
| `subscription.resumed` | Resumed |

No event is documented for a *requested* cycle-end cancellation or a *requested* `cycle_end` plan
change. Related non-subscription events: `payment.authorized`/`captured`/`failed` (a
`payment.failed` can be followed by `payment.captured` for the same payment), `refund.created`/
`processed`/`failed`, and `payment.dispute.*`. Sources:
[Subscription Webhook Events](https://razorpay.com/docs/webhooks/subscriptions/),
[Refund events](https://razorpay.com/docs/webhooks/refunds/),
[Dispute events](https://razorpay.com/docs/webhooks/disputes/).

**FACT.** A payload carries `entity: "event"`, `account_id`, `event`, `contains[]`, `created_at` and
`payload.subscription.entity`, plus `payload.payment.entity` "if a payment attempt was made before
the event was triggered". **No field identifies test vs live mode**; modes are distinguished by
separately configured webhook URLs and secrets. Source:
[Subscription webhook payloads](https://razorpay.com/docs/webhooks/payloads/subscriptions/).

**FACT.** Razorpay publishes its webhook source IP addresses. Source:
[IP whitelisting](https://razorpay.com/docs/security/whitelists/).

**OPEN — NOT VERIFIED (A9).** Whether `invoice.*` *webhook events* fire for subscription invoices
(same endpoint limitation as A6). **TEST-OBSERVED (2026-09-24):** the invoices *themselves* exist and
are fetchable through the API — `GET /v1/invoices?subscription_id=…` returns one invoice per charge
attempt, `paid` when its payment was captured and `issued` while unpaid — so lifecycle sync never
needs `invoice.*` events to see them.

---

## API rate limits and errors

**FACT.** "Razorpay uses a request Rate Limiter to limit the number of requests received by the API
within a time frame." HTTP 429 means "The server is processing too many requests at once… Retry the
request after some time"; recommended handling is "exponential backoff/stepped backoff… Add some
randomisation within the backoff schedule to avoid the thundering herd effect." **No numeric limits,
no per-endpoint limits, no 429 body shape, and no `Retry-After` header are documented.** Limits can
be raised through Support. Sources: [API overview](https://razorpay.com/docs/api/understand/),
[Common errors](https://razorpay.com/docs/errors/common/).

**FACT.** Errors are `{"error": {"code", "description", "source", "step", "reason", "metadata",
"field"}}` with codes `BAD_REQUEST_ERROR`, `GATEWAY_ERROR`, `SERVER_ERROR`. No per-code
retryability list and no client timeout guidance are documented. Source: [Common errors](https://razorpay.com/docs/errors/common/).

**INTERPRETATION.** Kizunia cannot size its outbound request budget from documentation. The budget is
configuration with a conservative default that adapts to observed 429s — see
[`../reconciliation/provider-rate-limits.md`](../reconciliation/provider-rate-limits.md).

**OPEN.** Kizunia's actual account limits (ask Razorpay Support before LIVE).

---

## Offers

**FACT.** "You can create offers only from the Dashboard." Offers are Flat or Percentage, applied
"Single Use", for a "Limited number of cycles", or "Forever", with Starting On / Expires On dates.
Source: [Create Subscription Offers](https://razorpay.com/docs/payments/subscriptions/offers/create/).

**FACT.** An Offer can be linked at creation (`offer_id`) or to an **active** subscription later;
"The Offer is applied to the Subscription at the end of the current billing cycle. It is not
possible to update an Offer linked to a Subscription immediately." Offers work only with Standard
Checkout, in India. Source: [Link an Offer](https://razorpay.com/docs/payments/subscriptions/offers/link/).

**FACT.** Usage limits are "Max Usage" (total) and "Max Usage Per Card"; no per-customer limit is
documented. "Offers can only be applied if the chargeable amount after applying the Offer is greater
than ₹1." Source: [Create Subscription Offers](https://razorpay.com/docs/payments/subscriptions/offers/create/).

**INTERPRETATION.** See [SB-CP-01 through SB-CP-05](../../../project/feature-specification/subscription/decisions/coupons-and-promotions.md).

---

## Refunds

**FACT.** Refunds (full or partial) can be issued against a captured payment; multiple partial
refunds are allowed up to the captured amount; `X-Refund-Idempotency` makes refund creation
idempotent. Source: [Refunds APIs](https://razorpay.com/docs/payments/refunds/apis/),
[Idempotent refunds](https://razorpay.com/docs/api/refunds/normal-refunds-idempotent/).

**FACT.** Whether refunding a subscription payment changes subscription state is not documented;
"There is no state change when a Subscription is updated." Source:
[Update a Subscription (guide)](https://razorpay.com/docs/payments/subscriptions/update/).

**INTERPRETATION.** Kizunia issues no refunds in V1. Dashboard-issued refunds are recorded as facts
and never change access by themselves — see
[`../lifecycle/dashboard-originated-changes.md`](../lifecycle/dashboard-originated-changes.md).

---

## Test vs live mode

**FACT.** Test and live modes use separate API key pairs; test mode never moves real money; webhooks
are configured with separate URLs per mode; "the payload structure remains the same in the Live and
Test modes". Sources: [Test and Live Modes](https://razorpay.com/docs/payments/dashboard/test-live-modes/),
[Validate and Test Webhooks](https://razorpay.com/docs/webhooks/validate-test/).

**FACT.** Subscription testing uses the Dashboard's "Charge this now" action, which lets the tester
choose success or failure; failing a charge moves the subscription to `pending`, and "If you fail a
charge 4 times in a row" it is `halted`. Test card tokens are valid for 3 days. There is no
accelerated billing clock and no documented "send test webhook" tool. Source:
[Test Subscriptions](https://razorpay.com/docs/payments/subscriptions/test/).

**TEST-OBSERVED (2026-09-24) — how the simulated charge actually behaves.** In practice "Charge this
now → Failure" does **not** deterministically produce a failed charge. Each click creates an invoice and
a payment described "Failed Recurring Payment via Subscription" that starts in payment status
`created` and resolves **asynchronously** (seconds later) to `captured` **or** `failed`
(`BAD_REQUEST_ERROR`). The tester reports choosing "Failure" on every click (not independently confirmed); across
six such clicks on one subscription the payments resolved captured, failed, captured, failed,
captured, then a sixth still `created` — and a successful payment moves the
subscription forward one billing cycle (`paid_count` +1, `current_end` and `charge_at` advance)
instead of failing it. Reaching `pending` and `halted` therefore took repeated clicking with polling,
and the resulting state must be read from the API, not assumed from the click. See D5.

**TEST-OBSERVED (2026-09-24) — Checkout automation notes.** Standard Checkout and the hosted
subscription page (`short_url`) can be completed with the documented domestic test card. Headless
automated browsers trigger an hCaptcha bot check on card submission; a normal visible browser
generally passes. E-mandate offers a mock bank page with `Success`, `Payment successful but e-Mandate
failed` and `Failure`. Card checkout needs a valid-looking Indian mobile number (some numbers are
rejected).

**INTERPRETATION.** See [`../provider-availability/environments.md`](../provider-availability/environments.md)
and [SB-PB-02](../../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-02--provider-mode-is-resolved-once-at-boot).

---

## TEST verification (2026-09-24)

**What this section is.** The record of one provider-verification pass against Razorpay TEST mode on
2026-09-24 (TEST-mode key only; the API base was `https://api.razorpay.com` with a `rzp_test_` key, and
Checkout displayed its "Test Mode" banner). It changed no application code and no architecture
decision. Every result above tagged **TEST-OBSERVED** comes from here.

**Method.** Subscriptions were created with the API and authenticated through Razorpay's hosted
subscription page using the documented domestic test card (Visa 4718 6091 0820 4366). States were
reached as follows, and every result was confirmed by a `GET /v1/subscriptions/:id` rather than trusted
from the command response:

| State | How it was reproduced |
| --- | --- |
| `created` | Create Subscription, never paid |
| `authenticated` | Create with a future `start_at`, pay the authentication charge |
| `active` | Create, pay the authentication charge (no `start_at`) |
| `paused` | `POST /pause` on an `active` subscription |
| `pending` | Dashboard "Charge this now" simulated failures, polled until `pending` |
| `halted` | Repeated Dashboard simulated failures until four attempts were exhausted (observed twice) |
| `expired` | A `created` subscription whose `expire_by` passed |

**Not attempted or not reproducible (all remain OPEN in
[`open-decisions.md`](../../../project/feature-specification/subscription/open-decisions.md)):**

| Item | Why |
| --- | --- |
| Any webhook behavior (A3, A6, A9, and "was a webhook generated" for every experiment above) | Needs a public HTTPS endpoint registered in the Dashboard; there is no API to register one, no tunnel tool was installed, and the decision for this pass was to skip webhooks |
| A3, A15 (native plan change applying; offers on upgrade) | A successful native plan change needs an international-card subscription; international cards were excluded from this pass. Offers can be created only in the Dashboard |
| A4 for UPI and e-mandate | UPI is not offered in TEST Checkout; an e-mandate registration completed at the mock bank but the subscription stayed `created` for the ≥ 9 minutes observed |
| A7 first-charge failure | TEST mode never ran the first scheduled charge (47 min past `start_at`) |
| A10, A11 | TEST mode cannot revoke a mandate or model a banking calendar |
| A12 | Support question by nature |
| Halted *recovery* | Needs the customer-side payment-method-change flow |
| Effect of a cycle-end cancel actually firing at `current_end` | No accelerated clock; first cycle ends ~30 days out |

**Cleanup.** All non-terminal test subscriptions created by this pass were cancelled. Razorpay offers
no API to delete Plans; the test plans named `KZ-VERIFY …` remain in the TEST account.

## Documentation vs observed behavior

Recorded rather than silently resolved. **Each item needs a human decision before Kizunia relies on
either side.** "Safe to rely on" states the conservative reading the current design already takes.

| # | Razorpay documented | TEST observed | Safe to rely on |
| --- | --- | --- | --- |
| D1 | Cancel API page names only `active`/`authenticated` as cancellable | Immediate cancel also accepted for `created`, `pending`, `paused`, `halted` | Treat immediate cancel of these four as *observed to work in TEST*; still verify `cancelled` by fetch, and handle a `400` as `REJECTED` |
| D2 | Cycle-end cancel is refused when no billing cycle is running | Refused with that message for `created`/`authenticated`, but **`200` with no state change** for `pending`/`paused`/`halted` | Never treat a cycle-end `200` as cancellation in those states; use immediate cancellation where a guaranteed end is required |
| D3 | The subscription entity has no `payment_method` field | `payment_method`, `halted_at`, `card_mandate_id`, `customer_email`, `customer_contact` are returned | Do not depend on them; read defensively |
| D4 | Pausing nulls `current_start`, `current_end` and `charge_at` | Only `charge_at` became `null`; `current_start`/`current_end` were retained | Do not derive "paused" from null period fields |
| D5 | A failed simulated charge moves the subscription to `pending` | The "Failure" click often ended in a *captured* payment and a forward billing cycle; outcomes resolve asynchronously | Read state from the API after every simulated charge |
| D6 | `expired` is tied to `start_at` only | A `created` subscription without `start_at` expires after `expire_by`, up to ~3 minutes late | Treat `created` past `expire_by` as *probably abandoned*, not yet `expired` |
| D7 | `paused → cancelled` in the state diagram; Cancel page silent on other states | Consistent for immediate cancel; see D2 for cycle-end | as D1/D2 |
| D8 | Update refusal for domestic card documented as "you can update only the offer" | Confirmed; descriptions differ by request (see the A4 table) and are all `BAD_REQUEST_ERROR` | Classify by code only, as the current fallback already does |
| D9 | — | **Unexplained anomaly.** Once, on one subscription, `resume` returned `200`/`active` and an immediate `cancel` returned `400` (body not captured), after which the entity read `paused`. Four attempts to reproduce the sequence — including the same call order — all behaved normally. Separately, one halted subscription was later observed `pending` with a higher `paid_count` while Dashboard actions were being taken | A command's response body is never authoritative; only a subsequent `GET`. This is already the design ([SB-WH-03](../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md#sb-wh-03--state-changing-events-trigger-an-authoritative-refetch)) |
