# Provider Boundary

> **Status:** Implementation plan — not implemented
>
> **Last Updated:** 2026-09-24
>
> **Blueprint section:** §5 (see the [section map](README.md#blueprint-section-map))

The narrow Kizunia → Razorpay boundary: the operations Kizunia actually needs, and for each its input, output, errors, retryability, idempotency implications, whether the outcome can become unknown, and how the application recovers. It is deliberately not a generic payment-provider abstraction.

**Decisions referenced here:** [IB-1](open-decisions.md#ib-1--past_due-cancellation). All were ruled on 2026-09-24; see [open decisions](open-decisions.md) for each ruling and who made it (product decision (owner) or architecture decision (autonomous)).

---

One interface, one Razorpay implementation, one fake. No SDK: a ~150-line `fetch` client (Basic auth `key_id:key_secret`, base `https://api.razorpay.com/v1`, `AbortSignal.timeout(ms)`), because every response must be translated and classified anyway and no new dependency is needed. Every network call goes through `BudgetedProvider`, which checks cooldown, acquires budget at the caller's priority, records `observationAt` = send time, calls, classifies, and updates cooldown.

**Classification (all operations):** 2xx + valid shape → `SUCCESS`; timeout/reset → `TIMEOUT`; 5xx or `SERVER_ERROR`/`GATEWAY_ERROR` → `UNAVAILABLE`; 429 → `RATE_LIMITED`; 401/403 → `AUTH_FAILURE`; 404 → `NOT_FOUND`; 400 `BAD_REQUEST_ERROR` → `REJECTED`, except the "another subscription operation is in progress" case → `CONCURRENT_OPERATION`. That one exception is the single place a description string may be matched, since the docs name it as a class; if its text cannot be matched reliably, fall back to `REJECTED` plus marking sync-due. Unknown status or missing fields → `MALFORMED`; unmapped plan → `UNMAPPED_PLAN`; no budget slot → `BUDGET_EXHAUSTED`. Never match on description text for anything else (D8/D10).

| Operation | Input | Output | Errors that matter | Retry | Idempotency | Can be UNKNOWN? | Recovery |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `createSubscription` | plan ID (from catalog), `total_count`, `expire_by`, `start_at` (TRIAL only), `offer_id?`, `notes{kz_sub,kz_op,kz_env}`; `customer_notify` default | `ProviderSubscriptionState` (+ `short_url`) | REJECTED (bad plan/offer, past `expire_by`), RATE_LIMITED, AUTH_FAILURE | **Never** | None at Razorpay (FACT); Kizunia's `PROVISIONING` row + notes | **Yes** (timeout/5xx/crash) | Orphan discovery / webhook `notes.kz_sub`; else `ABANDONED` after window |
| `fetchSubscription` | provider ID | state | NOT_FOUND (mode mismatch / missing), MALFORMED | Backoff (sync) | Read | n/a (a failed read is not an observation) | Stays due; cooldown |
| `updateSubscriptionPlan` | provider ID, target plan ID, `schedule_change_at` now \| cycle_end | state | REJECTED (payment method, state, below ₹0.5 proration, offer-downgrade D11), CONCURRENT_OPERATION | Never automatically | None; state observable | Yes | Next sync: plan or pending change equals target → SUCCEEDED, else NOT_APPLIED |
| `cancelScheduledChange` | provider ID | state | REJECTED ("no pending update") | Never | Observable (`has_scheduled_changes=false`) | Yes | Next sync |
| `cancelSubscription` | provider ID, `atCycleEnd` | state | REJECTED (terminal, no cycle running for cycle-end on created/authenticated) | Never | Immediate: observable. Cycle-end: **not observable** (A2); repeat harmless (A14) | Yes | Immediate: next sync shows `cancelled`. Cycle-end: resolved at period end or re-issue by user. Cycle-end is sent only for `ACTIVE`; `PAST_DUE`, `HALTED` and `PAUSED` are always immediate (IB-1, decided) |
| `listSubscriptions` | `from`, `to` (`created_at`, inclusive), `count ≤ 100`, `skip` | page of states incl. notes | RATE_LIMITED, UNAVAILABLE | Next run (watermark not advanced) | Read | n/a | Resume from watermark/skip |
| `fetchAuthorizationPaymentMethod` | payment ID (from checkout confirm or `subscription.authenticated` payload's payment entity) | `{method, international?}` | NOT_FOUND | Best effort, never blocks | Read | n/a | Leave advisory null (UI says "may not be available") |
| `verifyWebhookSignature` | raw bytes, header, `[current, previous?]` | `{valid, matched}` | — (no network) | — | — | — | — |
| `parseWebhookEvent` | raw bytes | `ProviderWebhookEvent` or `Malformed` | — | — | — | — | — |
| `verifyCheckoutSignature` | payment ID, **server-held** provider subscription ID, signature | boolean | — | — | — | — | Failure only logs; sync still decides |

**Deliberately not in the boundary** (docs): pause/resume, refunds, Offer linking after creation, invoice reads, plan/offer lookup, `retrieve_scheduled_changes`. A Dashboard-scheduled change shows only as `has_scheduled_changes = true` without a target. That is acceptable: access changes only when the new `plan_id` is observed.

`ProviderSubscriptionState` (Kizunia-defined): `providerSubscriptionId`, `rawStatus`, `providerPlanId`, `currentStart`, `currentEnd`, `chargeAt`, `startAt`, `endAt`, `expireBy`, `hasScheduledChanges`, `changeScheduledAt`, `offerId`, `notes`, `paidCount`, plus optional defensively-read `paymentMethod`/`haltedAt` (D3, undocumented). Timestamps converted from epoch seconds to `Date`.

**Disabled mode:** every network op returns `BillingProviderUnavailable` without I/O; webhook verification has no secret and fails closed.

---

## Related documents

**In this directory**

- [Billing Command Model](command-model.md)
- [Synchronization](synchronization.md)
- [Reconciliation](reconciliation.md)
- [Configuration and Environment](configuration.md)
- [Open decisions](open-decisions.md) · [Settled decisions](settled-decisions.md) · [Index](README.md)

**Design and specification**

- [Provider boundary overview](../provider-boundary/README.md)
- [Interface and abstraction](../provider-boundary/interface-and-abstraction.md)
- [Identifiers](../provider-boundary/identifiers.md)
- [Razorpay facts](../provider-boundary/razorpay-facts.md)
- [Provider rate limits and failure taxonomy](../reconciliation/provider-rate-limits.md)
- [Disabled provider mode](../provider-availability/disabled-provider-mode.md)
