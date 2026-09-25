# Checkout and Subscription Creation

> **Status:** Implemented in Phase V (2026-09-25). Rulings made while implementing: [IB-25](open-decisions.md#ib-25--phase-v-implementation-rulings)
>
> **Last Updated:** 2026-09-24
>
> **Blueprint section:** §7 (see the [section map](README.md#blueprint-section-map))

The complete Free → paid flow: local provisioning, Razorpay subscription creation, checkout, authentication, webhook/sync and effective access; plus duplicate requests, abandoned checkout, unknown outcomes, reuse of an existing checkout, supersession of a halted or paused subscription, and cancellation verification before a replacement is created.

---

```text
Browser                                  Kizunia                                         Razorpay
 GET /api/v1/me/billing  --------------> summary DTO: effective plan, capabilities, allowed actions
 POST /api/v1/me/billing/checkout       StartCheckout (priority 1)
   {plan, cycle, kind?, code?,            tx A: op IN_FLIGHT + reuse table + PROVISIONING row
    supersedesSubscriptionId?,            createSubscription(notes kz_sub/kz_op/kz_env,  ------------> created
    confirmSupersede?}                      expire_by = now + C5, total_count per cycle)  <---------- sub_xxx, short_url
   Idempotency-Key header                 tx B: bind ID, apply -> PENDING_AUTHENTICATION, op SUCCEEDED
 <-- {checkout: {keyId, subscriptionId, prefill?}, status}
 Razorpay Checkout (checkout.js)  ---------------------------------------------------------------> authenticate
 <-- razorpay_payment_id, razorpay_subscription_id, razorpay_signature
 POST /api/v1/me/billing/checkout/confirm  verify HMAC(payment_id|SERVER-HELD sub id, key_secret)
                                          mark due (CHECKOUT_CONFIRM), targeted sync p2 ----> fetch -> authenticated/active
                                          apply -> TRIALING/ACTIVE; advisory payment method (best effort)
 <-- summary DTO (new capabilities)       (webhooks arrive in parallel; dedupe + guard make order irrelevant)
 poll GET /me/billing while "finishing up" (never polls Razorpay)
```

- `keyId` goes to the client in the checkout response. There is no `NEXT_PUBLIC_RAZORPAY_*`, so the mode seam stays server-side.
- `total_count`: configured per cycle within the TEST-observed ceiling (monthly ≤ 1200, yearly ≤ 100, A13). `start_at` only for `TRIAL`.

**Reuse and uniqueness at tx A** (SB-UQ-03, `checkout-and-creation.md`):

| User's open subscription | Result |
| --- | --- |
| none | Create |
| `PROVISIONING`, same plan/cycle | Return the existing operation ("still being set up") |
| `PROVISIONING`, different plan | 409 "a checkout is being set up" (never a second create) |
| `PENDING_AUTHENTICATION`, same plan/cycle, `expireBy` not passed | Return stored checkout params. No provider call |
| `PENDING_AUTHENTICATION`, other plan/cycle or expired | Composed: `CANCEL_IMMEDIATELY` the old one, targeted sync must show `cancelled`/`expired`, then create. If not confirmed → `CONFIRMING`; if refused → wait for observed expiry (A8 lag) |
| `TRIALING`, `ACTIVE`, `PAST_DUE` | Refused. Response says whether a native plan change is offered (advisory) or the V1 limitation applies |
| `HALTED`, `PAUSED` | Refused unless `supersedesSubscriptionId` equals it **and** confirmation is set → Supersede |
| more than one open (anomaly) | Refused, "contact support" |

**Failure handling** (full matrix in `checkout-and-creation.md`, rows 1–16):

| Situation | Handling |
| --- | --- |
| Double click / retry | Same idempotency key → same operation and params |
| Two tabs | Partial unique index → second gets 409 or the reuse row |
| Budget exhausted | Nothing sent; op `REJECTED(BUDGET_EXHAUSTED)`; sub `ABANDONED`; "busy, retry" |
| Provider rejects | `REJECTED`; sub `ABANDONED`; typed message; alert if unexpected (catalog misconfig) |
| Timeout / 5xx / crash / tx B fails | Op `OUTCOME_UNKNOWN` (or `IN_FLIGHT` until lease → unknown); sub stays `PROVISIONING`; user sees "confirming". **Never re-sent.** Webhook or orphan scan binds via `notes.kz_sub`; window closes → `ABANDONED` |
| Abandoned checkout | Stays `PENDING_AUTHENTICATION`; resumable until `expireBy`; checkpoint at `expireBy` + margin observes `expired` (lag observed 156–322 s, D6; sized for ~6 min) |
| Confirm never called | Webhook `after()` or due sync |
| Bad confirm signature | Security log; still mark due; the fetch decides |
| Webhook before bind | Matched through `notes.kz_sub` to the `PROVISIONING` row (SB-WH-06) |
| Mode changed between steps | `PROVIDER_MODE_MISMATCH`; never synced |

**Cancellation verification before a replacement:** supersession and abandon-then-recreate both require the **observed** terminal phase from an authoritative fetch, never the cancel response. The immediate form is mandatory; cycle-end on `HALTED`/`PAUSED` returns `200` with no effect (D2).

---

## Related documents

**In this directory**

- [Billing Command Model](command-model.md)
- [Webhook Architecture](webhooks.md)
- [Synchronization](synchronization.md)
- [Open decisions](open-decisions.md) · [Settled decisions](settled-decisions.md) · [Index](README.md)

**Design and specification**

- [Checkout and creation (design)](../commands/checkout-and-creation.md)
- [Multiple subscriptions](../lifecycle/multiple-subscriptions.md)
- [Trials](../lifecycle/trials.md)
- [Coupons and offers](../entitlements/coupons-and-offers.md)
