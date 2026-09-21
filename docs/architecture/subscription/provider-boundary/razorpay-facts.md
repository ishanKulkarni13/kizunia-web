# Razorpay Facts

> **Status:** Live — verified 2026-09-21 against current official Razorpay documentation
>
> **Last Updated:** 2026-09-21

This is the FACT ledger every ruling in
[`../../../project/feature-specification/subscription/decisions/`](../../../project/feature-specification/subscription/decisions/README.md)
tagged `[RAZORPAY FACT]` links back to. It supersedes `docs/temp/razorpay-feasibility-audit.md`
wherever the two disagree — that document was an earlier research pass; this one reflects direct
verification against Razorpay's live documentation.

---

## Lifecycle states

**FACT.** A Razorpay Subscription has nine possible states:

| State | Entered when |
| --- | --- |
| `created` | Subscription created, awaiting authentication |
| `authenticated` | Customer completed the authentication/mandate transaction (this is also what a trial looks like before its `start_at`) |
| `active` | Billing cycle has started; charges are attempted on schedule |
| `pending` | An auto-charge failed; Razorpay is retrying |
| `halted` | All retries exhausted; no further auto-charge attempts; invoices still generate |
| `paused` | Explicitly paused (only reachable from `active`; pausing an `authenticated` subscription cancels it instead) |
| `cancelled` | Explicitly cancelled — **terminal, cannot be restarted** |
| `completed` | `end_date`/`total_count` reached — terminal |
| `expired` | `start_at` deadline passed without authentication — terminal |

Source: [Subscriptions States](https://razorpay.com/docs/payments/subscriptions/states/), [Subscription Entity](https://razorpay.com/docs/api/payments/subscriptions/entity/), [Pause a Subscription](https://razorpay.com/docs/api/payments/subscriptions/pause-subscription/).

**FACT.** A cancelled subscription cannot be reactivated. Resubscribing creates a brand-new Razorpay
subscription object with a new ID. Source: same as above.

**INTERPRETATION.** Kizunia's own identifiers, not Razorpay's, must be the backbone of a user's
subscription continuity — see
[SB-PB-04](../../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-04--razorpay-identifiers-never-leak-past-the-provider-boundary).
See Kizunia's own phase mapping in [`../lifecycle/state-mapping.md`](../lifecycle/state-mapping.md).

---

## Payment retries

**FACT.** For card and UPI payment methods, a failed auto-charge is retried automatically at T+1,
T+2, and T+3 days (three retries over three days) before the subscription moves to `halted`.
E-mandate/e-NACH retries are bank-response-dependent, can take more than 24 hours per attempt, and
shift around banking holidays. Source: [Payment Retries](https://razorpay.com/docs/payments/subscriptions/payment-retries/).

**FACT.** Once `halted`, invoices continue to be generated on schedule but are **not** auto-charged.
Recovery requires the customer to update their payment method (or the merchant to manually charge an
outstanding invoice). There is no documented time bound after which a halted subscription
auto-cancels. Source: same as above.

**FACT.** If a halted subscription resumes successfully, only subsequent invoices are charged —
previously-missed charges from the halted period are not retroactively collected. Source:
[Subscriptions States](https://razorpay.com/docs/payments/subscriptions/states/).

**INTERPRETATION.** See [`payment-failure-and-recovery.md`](../lifecycle/payment-failure-and-recovery.md) and
[SB-PF-01 through SB-PF-04](../../../project/feature-specification/subscription/decisions/payment-failure-and-recovery.md).

**OPEN.** Exact e-mandate retry timing under Indian banking holidays was not independently observed
— see [`../../../project/feature-specification/subscription/open-decisions.md`](../../../project/feature-specification/subscription/open-decisions.md).

---

## Upgrade / downgrade

**FACT.** The Update Subscription API accepts `plan_id`, `quantity`, `offer_id`, and
`schedule_change_at` (`"now"` or `"cycle_end"`, default `"now"`). Only subscriptions in
`authenticated` or `active` state can be updated; subscriptions authenticated via UPI or e-mandate
cannot be updated at all. Source: [Update a Subscription](https://razorpay.com/docs/api/payments/subscriptions/update-subscription/).

**FACT.** On an immediate upgrade, Razorpay generates a prorated invoice and auto-charges the
difference. On an immediate downgrade, Razorpay may issue a refund for the difference rather than
this being purely additive. A minimum chargeable proration difference applies, below which an
update is rejected (the exact INR figure was not confirmed from currently available documentation).
Source: same as above.

**FACT.** A subscription with an active Offer can only be downgraded with `schedule_change_at:
"cycle_end"` — immediate downgrade is disallowed while an Offer is active. Source: same as above.

**INTERPRETATION.** See [SB-LC-02/SB-LC-03](../../../project/feature-specification/subscription/decisions/lifecycle.md).

**OPEN.** Exact minimum proration threshold in INR — see
[`../../../project/feature-specification/subscription/open-decisions.md`](../../../project/feature-specification/subscription/open-decisions.md).

---

## Cancellation

**FACT.** The Cancel Subscription API accepts `cancel_at_cycle_end` (boolean, default `false`).
`true` defers cancellation to the end of the current billing cycle; `false` cancels immediately.
Source: [Cancel a Subscription](https://razorpay.com/docs/api/payments/subscriptions/cancel-subscription/).

**FACT.** A subscription that has not started its first billing cycle, or is already in its final
cycle, cannot be cycle-end-cancelled and must use immediate cancellation instead. Source: same as
above.

**INTERPRETATION.** See [SB-LC-04/SB-LC-05](../../../project/feature-specification/subscription/decisions/lifecycle.md).

---

## Trials

**FACT.** Razorpay has no dedicated trial object or flag. A trial is created by passing a future
`start_at` when creating the subscription; the customer completes the authentication/mandate
transaction immediately, and the first real charge fires at `start_at`. There is no
no-payment-method trial mechanism. Source: [Create Subscriptions](https://razorpay.com/docs/payments/subscriptions/create/).

**INTERPRETATION.** See [SB-LC-01](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-01--trial-is-razorpay-native-only)
and [`../lifecycle/trials.md`](../lifecycle/trials.md).

---

## Webhooks

**FACT.** Webhook signatures are HMAC-SHA256 over the **raw** (unparsed) request body, using the
webhook secret configured in the Dashboard (distinct from API keys), hex-encoded, delivered in the
`X-Razorpay-Signature` header. Parsing the body before computing the signature breaks verification.
Source: [Validate and Test Webhooks](https://razorpay.com/docs/webhooks/validate-test/).

**FACT.** The `x-razorpay-event-id` header is unique per event and is Razorpay's documented
mechanism for detecting duplicate deliveries. Source: same as above.

**FACT.** Webhook delivery is **at-least-once**. A non-2xx response, or a response slower than 5
seconds, is treated as a delivery failure and retried on an exponential backoff for up to 24 hours,
after which the webhook is disabled (requiring manual re-enablement from the Dashboard, with a
notification to the configured alert email). Source: [Webhooks — Best Practices](https://razorpay.com/docs/webhooks/best-practices/), [Webhooks FAQ](https://razorpay.com/docs/webhooks/faqs/).

**FACT.** Razorpay's own documentation explicitly states events **may not arrive in order**, and
instructs consumers to design accordingly. Source: [Webhooks — Best Practices](https://razorpay.com/docs/webhooks/best-practices/).

**FACT.** A missed/failed webhook can be manually replayed from Razorpay support for events under 15
days old, provided the webhook was enabled at the time. Source: [Webhooks FAQ](https://razorpay.com/docs/webhooks/faqs/).

**FACT.** The full documented `subscription.*` webhook event catalog:

| Event | Fires when |
| --- | --- |
| `subscription.authenticated` | First payment (authorization/upfront/plan amount) processes |
| `subscription.activated` | Subscription transitions to `active` from `authenticated`, `pending`, or `halted` |
| `subscription.charged` | Every successful recurring charge |
| `subscription.completed` | All invoices generated; subscription reaches `completed` |
| `subscription.updated` | Subscription updated with no state change |
| `subscription.pending` | Enters `pending` (auto-charge failed, retrying); re-fires on continued failure |
| `subscription.halted` | Retries exhausted; moves `pending` → `halted` |
| `subscription.cancelled` | Cancelled |
| `subscription.paused` | Paused |
| `subscription.resumed` | Resumed to `active` |

Relevant `payment.*`/`order.*` events: `payment.authorized`, `payment.captured`, `payment.failed`
(a `payment.failed` can occasionally be followed by a `payment.captured` for the same payment, e.g.
late UPI authorization — this is itself an example of non-strict ordering), `order.paid`.

Source: [Subscriptions Webhook Events](https://razorpay.com/docs/webhooks/subscriptions/), [Payments Webhook Events](https://razorpay.com/docs/webhooks/payments/).

**INTERPRETATION.** See [`../webhooks/event-catalog.md`](../webhooks/event-catalog.md),
[`../webhooks/security.md`](../webhooks/security.md), and
[SB-WH-01 through SB-WH-05](../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md).

**OPEN.** What Razorpay's TEST-mode webhook tooling provides for pre-production signature/payload
verification was not independently confirmed — see
[`../../../project/feature-specification/subscription/open-decisions.md`](../../../project/feature-specification/subscription/open-decisions.md).

---

## Offers

**FACT.** Razorpay Offers can only be created from the Dashboard — there is no API to create one.
Subscription Offers support Flat or Percentage discounts, applied for a single use, a limited
number of cycles, or the life of the subscription, and are attached to a subscription via `offer_id`
at creation time. Source: [About Offers](https://razorpay.com/docs/payments/offers/), [Subscriptions — About Offers](https://razorpay.com/docs/payments/subscriptions/offers/).

**FACT.** Offer usage limits (`Max Usage`, `Max Usage Per Card`) are scoped to payment instruments
(cards, UPI handles), not to a merchant's own customer/account identity. Source: same as above.

**INTERPRETATION.** See [SB-CP-01 through SB-CP-03](../../../project/feature-specification/subscription/decisions/coupons-and-promotions.md).

**OPEN.** Whether an Offer can be attached to an already-active subscription (vs. creation-time
only) — see
[`../../../project/feature-specification/subscription/open-decisions.md`](../../../project/feature-specification/subscription/open-decisions.md).

---

## Refunds

**FACT.** Refunds (full or partial) can only be issued against a captured payment; multiple partial
refunds are allowed as long as their sum does not exceed the captured amount. Source: [Refunds APIs](https://razorpay.com/docs/payments/refunds/apis/).

**FACT.** A manually-captured payment not captured within 3 days of authorization is auto-refunded
by Razorpay. Source: same general refunds documentation area.

---

## Test vs live mode

**FACT.** Test and live modes use separate API key pairs (`rzp_test_...` / `rzp_live_...`); a key
generated in one mode does not work in the other. Both modes support the same functionality except
that test mode never moves real money. Webhooks work in both modes, configured independently per
mode in the Dashboard. Source: [Test and Live Modes](https://razorpay.com/docs/payments/dashboard/test-live-modes/).

**INTERPRETATION.** See [`../provider-availability/environments.md`](../provider-availability/environments.md)
and [SB-PB-02](../../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-02--provider-mode-is-resolved-once-at-boot).
