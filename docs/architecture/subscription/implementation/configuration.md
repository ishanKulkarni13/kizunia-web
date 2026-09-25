# Configuration and Environment

> **Status:** Implementation plan — not implemented
>
> **Last Updated:** 2026-09-24
>
> **Blueprint section:** §16 (see the [section map](README.md#blueprint-section-map))

Required configuration, TEST/LIVE separation, secrets, webhook secrets, tuning values, and the behavior when Razorpay configuration is absent. Free stays fully functional without Razorpay credentials.

**Decisions referenced here:** [IB-13](open-decisions.md#ib-13--boot-time-mode-validation-and-expected-mode). All were ruled on 2026-09-24; see [open decisions](open-decisions.md) for each ruling and who made it (product decision (owner) or architecture decision (autonomous)).

---

| Variable | Required when | Notes |
| --- | --- | --- |
| `RAZORPAY_KEY_ID` | test/live | Prefix `rzp_test_` → `test`, `rzp_live_` → `live`, else **fail at boot** |
| `RAZORPAY_KEY_SECRET` | test/live | API auth and checkout signature key; never logged or returned |
| `RAZORPAY_WEBHOOK_SECRET` | test/live | Distinct from the key secret, per mode |
| `RAZORPAY_WEBHOOK_SECRET_PREVIOUS` (+ optional `RAZORPAY_WEBHOOK_SECRET_PREVIOUS_UNTIL`) | rotation only | SB-WH-07 |
| `RAZORPAY_ACCOUNT_ID` | test/live | Payload `account_id` check |
| `BILLING_EXPECTED_MODE` | optional (set it explicitly in every deployment that has credentials) | `live` \| `test`; if absent: `live` when `VERCEL_ENV=production`, else `test` (IB-13, decided). Resolved mode must equal it or be `disabled`, else fail at boot |
| `BILLING_*` tuning (C1–C7) | optional | `envInt` pattern with defaults: budget window/limit/headroom, backoff base/cap, cooldown bounds, heartbeats/margins, batch sizes, `after()` cap, `expire_by` horizon, operation lease, outcome-unknown window, orphan overlap/settle/pages, payload retention, trial-conversion grace (C7, IB-9), trial length (**owner decision before Phase VII**; the spec's 30 days is only an example), `total_count` per cycle |

- **Mode rule:** no key ID, secret or webhook secret → `disabled`. A **partial** set is a configuration error and fails at boot (don't guess). Validation runs in `src/instrumentation.ts` `register()` and is memoized in `provider-mode.ts`; `isBillingProviderEnabled()` is the only runtime question.
- **Plan and Offer catalogs:** TypeScript config per mode in `modules/billing/config/`, code-reviewed and deployed (plan IDs are not secret; retired IDs kept; SB-PB-05). See [TEST verification plans](#test-verification-plans-phase-iv) for the TEST catalog.
- **No extra feature flag:** `disabled` mode is the paid-billing kill switch. No separate entitlement-enforcement flag is specified: the rollout concern that could have motivated one (existing users, formerly IB-8) does not apply, because Kizunia is pre-production with zero users (see [settled decisions](settled-decisions.md#decisions-applied-when-this-documentation-was-created)).
- **Absent config:** app boots; Free works; grants work; gates evaluate from local tables; checkout/change/cancel return 503 `BILLING_UNAVAILABLE` ("Paid subscriptions are temporarily unavailable"); the webhook fails closed; billing tasks return `{skipped: "disabled"}`.
- **TEST/LIVE separation:** separate keys, webhook secrets, catalogs and Offer maps; every row stamped; only the expected mode contributes; sync only for the resolved mode.
- `.env.example`: documents every billing variable above with comments. Done in [Phase III](../implementation-plan/phase-III/README.md) (IB-17(e)); later phases add theirs there as they introduce them.
- **Mode validation rules (implemented in Phase III):**
  - all of `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET`, or none of them;
  - `RAZORPAY_ACCOUNT_ID` is required once they are set;
  - `RAZORPAY_WEBHOOK_SECRET_PREVIOUS_UNTIL` must be an ISO 8601 timestamp and needs a previous secret (a previous secret with no `_UNTIL` is accepted until it is removed);
  - the key must start `rzp_test_` or `rzp_live_`, and its mode must equal the expected mode.
  - Every failure message names variables, never values. The check is skipped during `next build`.
- **Tick cadence:** the only Vercel cron entry is daily (Hobby). The C6 target needs an external pinger or finer cron before LIVE ([IB-19](open-decisions.md#ib-19--tick-cadence-on-the-vercel-hobby-plan)).
- **TEST webhook URL:** a stable public URL with deployment protection bypassed for the webhook path only ([IB-20](open-decisions.md#ib-20--a-public-test-webhook-endpoint)).

## TEST verification plans (Phase IV)

Created in the Razorpay **TEST** account on 2026-09-25 by `pnpm billing:test-plans` (idempotent: a rerun reuses them) and mapped in the TEST plan catalog. **Their prices are temporary TEST-only verification values set by the owner.** They are not Kizunia's pricing and not a product decision; LIVE pricing stays open ([B6](open-decisions.md#open-product-questions), a LIVE blocker). The spec lives in `modules/billing/config/test-plan-spec.ts`: to change a price, edit it and bump `TEST_PLAN_VERSION`, which creates new plans; the old IDs stay in the catalog as `retired`.

| Plan | Cycle | TEST price | Razorpay TEST plan ID | Catalog key (in the plan's notes) |
| --- | --- | --- | --- | --- |
| Pro | Monthly | ₹10 | `plan_TgDgeZ5thTGEr8` | `TEST:v1:PRO:MONTHLY` |
| Pro | Yearly | ₹12 | `plan_TgDgejlJXhdilW` | `TEST:v1:PRO:YEARLY` |
| Pro+ | Monthly | ₹20 | `plan_TgDgfArS3b5MQu` | `TEST:v1:PRO_PLUS:MONTHLY` |
| Pro+ | Yearly | ₹22 | `plan_TgDgfLV0VuYLQz` | `TEST:v1:PRO_PLUS:YEARLY` |

Plan IDs are not secrets. The earlier `KZ-VERIFY …` and `KZ-CONTRACT monthly INR 1` plans remain in the TEST account (Razorpay cannot delete plans) and are not in the catalog.

## Tuning values chosen in Phase III

The mechanisms are decided; these are the **IMPLEMENTATION-TIME** values C1 and C2 and the client timeout, as set in `next/src/modules/billing/config/billing-config.ts` (which records the reasoning for each). Razorpay publishes no rate-limit numbers ([A12](open-decisions.md#open-razorpay-items)), so every default is deliberately conservative and is to be confirmed with Razorpay Support before LIVE.

| Variable | Default | Meaning |
| --- | --- | --- |
| `BILLING_BUDGET_WINDOW_SECONDS` | 60 | The fixed window of the outbound request budget |
| `BILLING_BUDGET_LIMIT` | 60 | Provider calls allowed per window: one a second on average, far above steady state, so it caps bursts |
| `BILLING_BUDGET_HEADROOM_P1` | 15 | Units kept back for priority 1 against priorities 2–4 |
| `BILLING_BUDGET_HEADROOM_P2` | 15 | Further units kept back for priority 2 against priorities 3–4 |
| `BILLING_BUDGET_ORPHAN_CEILING` | 10 | Priority 4's ceiling, so orphan discovery runs only while the window is quiet |
| `BILLING_BACKOFF_BASE_SECONDS` | 60 | First per-subscription retry delay (`min(cap, base · 2ⁿ)`, jittered ×[0.5, 1.0]) |
| `BILLING_BACKOFF_CAP_SECONDS` | 21600 | The longest retry delay: six hours. A failing subscription is retried at that interval indefinitely |
| `BILLING_COOLDOWN_BASE_SECONDS` | 30 | First global cooldown (`base · 2^level`, jittered) |
| `BILLING_COOLDOWN_CAP_SECONDS` | 900 | The longest cooldown: fifteen minutes |
| `BILLING_COOLDOWN_FAILURE_THRESHOLD` | 5 | Consecutive timeouts or 5xx, with no success between, that enter a cooldown as a 429 does |
| `BILLING_PROVIDER_TIMEOUT_MS` | 10000 | How long one provider request may take before it counts as a timeout |

The resulting ceilings on the shared counter are P1 = 60, P2 = 45, P3 = 30 and P4 = 10 of 60. The remaining tuning values (heartbeats and margins, batch sizes, the `after()` cap, the `expire_by` horizon, the operation lease, the outcome-unknown window, orphan discovery settings, payload retention, trial-conversion grace and length, `total_count` per cycle) belong to the phases that use them, and are added here as each lands.

---

## Related documents

**In this directory**

- [Provider Boundary](provider-boundary.md)
- [Reconciliation](reconciliation.md)
- [Open decisions](open-decisions.md) · [Settled decisions](settled-decisions.md) · [Index](README.md)

**Design and specification**

- [Environments](../provider-availability/environments.md)
- [Disabled provider mode](../provider-availability/disabled-provider-mode.md)
- [Security](../cross-cutting/security.md)
