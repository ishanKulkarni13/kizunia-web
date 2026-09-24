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
- **Plan and Offer catalogs:** TypeScript config per mode in `modules/billing/config/`, code-reviewed and deployed (plan IDs are not secret; retired IDs kept; SB-PB-05).
- **No extra feature flag:** `disabled` mode is the paid-billing kill switch. No separate entitlement-enforcement flag is specified: the rollout concern that could have motivated one (existing users, formerly IB-8) does not apply, because Kizunia is pre-production with zero users (see [settled decisions](settled-decisions.md#decisions-applied-when-this-documentation-was-created)).
- **Absent config:** app boots; Free works; grants work; gates evaluate from local tables; checkout/change/cancel return 503 `BILLING_UNAVAILABLE` ("Paid subscriptions are temporarily unavailable"); the webhook fails closed; billing tasks return `{skipped: "disabled"}`.
- **TEST/LIVE separation:** separate keys, webhook secrets, catalogs and Offer maps; every row stamped; only the expected mode contributes; sync only for the resolved mode.
- `.env.example`: add the variables above with comments. It currently has the key ID and secret only; this is done in [Phase III](../implementation-plan/phase-III/README.md) (IB-17(e)).
- **Tick cadence:** the only Vercel cron entry is daily (Hobby). The C6 target needs an external pinger or finer cron before LIVE ([IB-19](open-decisions.md#ib-19--tick-cadence-on-the-vercel-hobby-plan)).
- **TEST webhook URL:** a stable public URL with deployment protection bypassed for the webhook path only ([IB-20](open-decisions.md#ib-20--a-public-test-webhook-endpoint)).

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
