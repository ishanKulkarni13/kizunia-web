# Verification Checklist

> **Status:** Live
>
> **Last Updated:** 2026-09-24 (re-done after the adversarial architecture review)

Self-review against the failure scenarios and requirements this design must survive. Each item is
answered with a reference, not a bare yes/no. Where the answer depends on something not yet verified,
it says so.

---

## Core requirements

| Question | Answer | Where |
| --- | --- | --- |
| Does Free work without Razorpay? | Yes. Free is never stored; resolution reads two Kizunia tables and makes zero provider calls, in every mode, including during an outage | [SB-EA-01](../../project/feature-specification/subscription/decisions/effective-access-and-grants.md#sb-ea-01--free-has-no-subscription-record), [`entitlements/effective-access-resolution.md`](entitlements/effective-access-resolution.md) |
| Can production run with paid billing disabled? | Yes, and existing `live` subscriptions keep contributing (expected billing mode) | [`provider-availability/disabled-provider-mode.md`](provider-availability/disabled-provider-mode.md) |
| Is Vercel Pro required? | No. Correct on a daily tick; target cadence via Vercel Cron or an external scheduler, a configuration choice | [SB-PB-06](../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-06--billing-execution-is-scheduler-agnostic) |
| Can development happen without Razorpay credentials? | Yes — admin grants exercise every entitlement; a fake provider exercises every failure class | [`cross-cutting/testing-without-razorpay.md`](cross-cutting/testing-without-razorpay.md) |
| Can test data grant production access? | No — rows are mode-stamped; only the deployment's expected billing mode contributes | [SB-EA-07](../../project/feature-specification/subscription/decisions/effective-access-and-grants.md#sb-ea-07--a-subscription-contributes-only-in-the-provider-mode-it-was-created-in) |
| Are Razorpay capabilities verified from official documentation? | Yes, re-verified 2026-09-24; ambiguous behaviors are marked OPEN with fallbacks | [`provider-boundary/razorpay-facts.md`](provider-boundary/razorpay-facts.md), [`open-decisions.md`](../../project/feature-specification/subscription/open-decisions.md) |
| Are unnecessary abstractions avoided? | Yes — no multi-provider framework, coupon engine, retry engine, successor-subscription workaround, second queue or new worker platform | [`principles.md`](principles.md#what-not-to-build-now) |

## The ten checks requested for the 2026-09-24 review

| # | Check | Result | Where |
| --- | --- | --- | --- |
| 1 | All changed documentation reviewed | Yes — every document in the product, architecture and domain trees plus the ADR and internal-jobs convention | This commit set |
| 2 | Cross-document consistency | Verified by a link/anchor check over the whole tree and targeted searches for superseded claims ("next queue drain", "six operations", "one active Subscription", swappable provider reference, `pending → ACTIVE`, Free→Pro as an "upgrade") | — |
| 3 | Decision IDs and references | Every ID in the register exists in its topic file with a matching status; amended rulings carry an `Amended` paragraph; SB-RC-02 is marked `Superseded` with a pointer | [`decisions/README.md`](../../project/feature-specification/subscription/decisions/README.md) |
| 4 | No contradictory lifecycle rules | One state mapping, one apply path, one open-subscription rule; plan changes native-only; Free→paid is creation and paid→Free is cancellation everywhere | [`lifecycle/`](lifecycle/README.md) |
| 5 | Every open question classified | TEST, SUPPORT, PRODUCT or CONFIG, each with a fallback | [`open-decisions.md`](../../project/feature-specification/subscription/open-decisions.md) |
| 6 | Free never requires Razorpay | See above | — |
| 7 | Provider rate limiting explicitly handled | One global budget with priorities, global cooldown on 429/5xx, per-subscription jittered backoff, due-based (not sweep) reconciliation, bounded orphan scan, coalesced webhook refetches | [`reconciliation/provider-rate-limits.md`](reconciliation/provider-rate-limits.md) |
| 8 | Duplicate subscription creation explicitly handled | Per-user single in-flight operation (DB constraint), idempotency keys, natural-key checkout reuse, record-before-call, no blind retry of creates, orphan discovery, detection of duplicates | [`commands/`](commands/README.md), [`lifecycle/multiple-subscriptions.md`](lifecycle/multiple-subscriptions.md) |
| 9 | Webhook/reconciliation concurrency explicitly handled | Single sync mechanism; `SKIP LOCKED` + lease; stale-apply guard on request-send time; trigger-after-fetch rule; commands applied through the same guard | [`reconciliation/sync-mechanism.md`](reconciliation/sync-mechanism.md#concurrency-exhaustively) |
| 10 | Implementable with the existing architecture | Yes: internal tick + task registry, the notification queue's claim/lease conventions, the Postgres rate-limit store, `P2002` idempotency, `after()` in Next 16, existing authorization seams. New: billing tables, one partial unique index, raw-SQL claim in the notification-queue style | [`module-boundaries.md`](module-boundaries.md) |

## Failure scenarios

| Scenario | Handled | Where |
| --- | --- | --- |
| Duplicate / replayed webhook | Unique dedupe key; replay only triggers a fetch | [`webhooks/reliability-and-idempotency.md`](webhooks/reliability-and-idempotency.md) |
| Out-of-order webhooks; fetches completing out of order | Refetch + stale-apply guard | [`webhooks/ordering-and-staleness.md`](webhooks/ordering-and-staleness.md) |
| Missed webhooks; webhook endpoint disabled | Due-based checkpoints and heartbeats; runbook | [`reconciliation/reconciliation-job.md`](reconciliation/reconciliation-job.md), [`cross-cutting/operations-runbook.md`](cross-cutting/operations-runbook.md) |
| Webhook storm / Dashboard bulk action | Coalescing + budget; no provider call before the 2xx | [`reconciliation/provider-rate-limits.md`](reconciliation/provider-rate-limits.md#webhook-storms-and-bulk-dashboard-actions) |
| Razorpay outage, partial failure, 429, malformed response, auth failure | Classified; local state never changes; cooldown; paging | [`reconciliation/provider-rate-limits.md`](reconciliation/provider-rate-limits.md#provider-failure-taxonomy) |
| Paying users downgraded because Razorpay is unreachable | Impossible by construction | [`provider-availability/outage-and-stale-state.md`](provider-availability/outage-and-stale-state.md) |
| Create succeeded at Razorpay, Kizunia failed to persist / response lost | Record-before-call + `notes` + orphan discovery; never re-sent | [`commands/checkout-and-creation.md`](commands/checkout-and-creation.md#failure-matrix) |
| Multiple tabs, client retries, double clicks | Idempotency key + one in-flight operation per user + checkout reuse | Same |
| Halted subscription recovers after the user bought a new one | Prevented by supersession; if it happens anyway, detected, max access, human resolves | [`lifecycle/multiple-subscriptions.md`](lifecycle/multiple-subscriptions.md) |
| Concurrent plan changes; cancel during a pending change | One in-flight per user; one scheduled change; cancellation wins | [`lifecycle/upgrade-downgrade.md`](lifecycle/upgrade-downgrade.md) |
| Trial abuse by restarting | One trial per account, serialized | [SB-LC-11](../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-11--one-trial-per-account) |
| Offer reuse by resubscribing; promotion double redemption | Kizunia-side eligibility; unique redemption + conditional decrement | [`entitlements/coupons-and-offers.md`](entitlements/coupons-and-offers.md) |
| Quota bypass by parallel creates | Per-user lock around count-and-insert | [`entitlements/quotas-vs-rate-limits.md`](entitlements/quotas-vs-rate-limits.md#project-ownership-quota) |
| Worker / deploy crash mid-operation | Leases; `IN_FLIGHT` → `OUTCOME_UNKNOWN` → resolved by observation | [`commands/operation-model.md`](commands/operation-model.md) |
| Webhook secret rotation | Previous secret accepted in a bounded window | [SB-WH-07](../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md#sb-wh-07--the-previous-webhook-secret-is-accepted-during-a-rotation-window) |
| User deleted while paying | Refused until cancelled; billing records pseudonymized, never cascaded | [SB-DP-04](../../project/feature-specification/subscription/decisions/data-preservation.md#sb-dp-04--billing-records-survive-account-removal) |
| Unknown plan ID or status from Razorpay | Not applied; last known state kept; anomaly | [SB-PB-05](../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-05--provider-plan-ids-map-to-kizunia-plans-through-a-per-mode-catalog-many-to-one) |
| "Why does this user have PRO?" and the other support questions | Each mapped to a durable record | [`cross-cutting/observability.md`](cross-cutting/observability.md#the-questions-and-where-each-answer-lives) |

## Known gaps and accepted limitations

These are deliberate or pending, not oversights:

1. **Paid→paid plan changes are unavailable for UPI, e-mandate and domestic-card subscriptions** —
   most Indian customers. Product decision; highest-impact open question
   ([B1](../../project/feature-specification/subscription/open-decisions.md#b-genuinely-open-product-questions)).
2. **Supersession depends on Razorpay accepting cancellation of `halted`/`paused` subscriptions.**
   The documentation names only `active`/`authenticated`, but TEST mode accepted an immediate cancel
   of both on 2026-09-24 ([A1](../../project/feature-specification/subscription/open-decisions.md#a-resolved-answered-by-test-verification-2026-09-24)).
   Still unproven for UPI/e-mandate subscriptions (not reproducible in TEST), and a documented-vs-observed
   discrepancy is flagged for review. The refusal fallback stays defined: if Razorpay refuses, users
   with a revoked UPI mandate may be unable to resubscribe without support cancelling in the Dashboard.
   A cycle-end cancel of `pending`/`paused`/`halted` returns `200` without effect and must not be used
   for supersession.
3. **Dashboard- and UPI-app-originated cycle-end cancellations are invisible until they take effect**
   (confirmed in TEST mode: [A2](../../project/feature-specification/subscription/open-decisions.md#a-resolved-answered-by-test-verification-2026-09-24)).
   That a Kizunia-requested cycle-end cancel actually takes effect at `current_end` could not be
   observed in TEST mode.
4. **Rate-limit numbers are unknown** until Razorpay Support confirms them ([A12](../../project/feature-specification/subscription/open-decisions.md#a-razorpay-behavior-requiring-test-mode-verification-or-support)).
5. **On a daily-only tick**, recovery paths (retries after failures, outcome-unknown creates, missed
   webhooks) take up to 24 hours ([SB-PB-06](../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-06--billing-execution-is-scheduler-agnostic)).
6. **The stale-apply guard assumes read-your-writes ordering at Razorpay** (a request sent later
   observes state at least as new). Reasonable for a single-provider API but not documented; a
   violation would at worst delay convergence until the next sync.

## Before implementation begins

1. Run the TEST-mode verification plan for every §A item marked TEST in
   [`open-decisions.md`](../../project/feature-specification/subscription/open-decisions.md), and
   record each result as a FACT (A1 first — it gates supersession). *A first TEST pass on 2026-09-24
   answered A1, A2, A5, A8, A13, A14 and parts of A4/A7; the items that still need a webhook endpoint
   (A3, A6, A9) or an international-card subscription (A3, A15) remain.*
2. Ask Razorpay Support for the account's API rate limits (A12).
3. From the authorization audit (`docs/temp/kizunia-authorization-compressed-wind.md` §22, P1):
   refactor `PortfolioPolicy` onto `AuthorizationEvaluator`, and add the shared admin-route guard
   before any billing-admin UI.
4. Decide B1 (plan changes for UPI/e-mandate/domestic cards) knowingly before launch messaging is
   written — it shapes what the pricing page may promise.
