# Razorpay Facts

> **Status:** Live — re-verified 2026-09-24 against current official Razorpay documentation
> (first verified 2026-09-21)
>
> **Last Updated:** 2026-09-24

This is the FACT ledger every ruling in
[`../../../project/feature-specification/subscription/decisions/`](../../../project/feature-specification/subscription/decisions/README.md)
tagged `[RAZORPAY FACT]` links back to. It supersedes `docs/temp/razorpay-feasibility-audit.md`
wherever the two disagree — that document was an earlier research pass; this one reflects direct
verification against Razorpay's live documentation.

**Tags.** **FACT** — explicitly documented, with a source. **INTERPRETATION** — Kizunia's
engineering conclusion. **OPEN** — not conclusively established by documentation; listed in
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

**OPEN.** How `expire_by` interacts with `expired` for a `created` subscription that has no
`start_at`; the documentation ties `expired` only to `start_at`.

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

**OPEN.** Whether and how a *requested but not yet effective* cycle-end cancellation is visible in the
fetched entity (no field is documented for it).

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

**OPEN.** Which timestamp `from`/`to` filter on (presumed `created_at`, not stated).

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

**OPEN.** Real-world e-mandate retry timing under Indian banking holidays. The halted-state behavior
of a UPI/e-mandate subscription whose mandate the customer has revoked.

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

**OPEN.** The exact error codes/shape for the payment-method refusals (needed to classify them
deterministically). Whether any webhook fires when a `cycle_end` change is *applied* (only immediate
updates are documented as firing `subscription.updated`).

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

**OPEN.** Whether `created`, `pending`, `halted` and `paused` subscriptions can be cancelled through
the API. The API page names only `active`/`authenticated`; the states diagram shows
`paused → cancelled`. This blocks [supersession](../lifecycle/multiple-subscriptions.md#supersession).

---

## Pause / resume

**FACT.** `pause_at` and `resume_at` accept only `now`. Only `active` subscriptions can be paused;
pausing sets `paused_at` and nulls `current_start`, `current_end` and `charge_at`. Pause may need to
be enabled on the account. Only `paused` subscriptions can be resumed; resume can fail if the
mandate is no longer valid. Sources: [Pause](https://razorpay.com/docs/api/payments/subscriptions/pause-subscription/),
[Resume](https://razorpay.com/docs/api/payments/subscriptions/resume-subscription/).

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

**OPEN.** The exact state until `start_at` (presumed `authenticated`) and what happens when the first
real charge at `start_at` fails (presumed the ordinary `pending → halted` path).

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

**OPEN.** Whether the header is present on every delivery and identical across retries of one event
(implied, not stated).

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

**OPEN.** Whether `invoice.*` events fire for subscription invoices.

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

**INTERPRETATION.** See [`../provider-availability/environments.md`](../provider-availability/environments.md)
and [SB-PB-02](../../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-02--provider-mode-is-resolved-once-at-boot).
