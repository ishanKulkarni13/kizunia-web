# Test Strategy

> **Status:** Implementation plan — not implemented
>
> **Last Updated:** 2026-09-24
>
> **Blueprint section:** §19 (see the [section map](README.md#blueprint-section-map))

The test strategy, designed before implementation: unit, integration and provider-TEST tests, covering domain and state, commands, concurrency, provider contract, webhook signatures and ordering, reconciliation, entitlements, quotas, grants, downgrade, supersession, cancellation-not-effective, and TEST/LIVE isolation.

**Open decisions referenced here:** [IB-1](open-decisions.md#ib-1--past_due-cancellation), [IB-9](open-decisions.md#ib-9--trial-conversion-gap). Text that follows a recommended resolution is provisional until that item is ruled; see [open decisions](open-decisions.md).

---

**Unit (`*.test.ts`, no DB):**

- **State mapping:** every status × kind × `startAt`; unknown → not applied; the IB-9 decision encoded.
- **`nextDue`:** every phase, checkpoints versus heartbeats, `HALTED` decay, `cancelAtPeriodEnd` checkpoint, terminal = null.
- **Command preconditions:** the reuse table ([checkout flow](checkout-flow.md)), trial eligibility, the plan-change matrix, the cancel matrix (including the IB-1 branch), anomaly block.
- **Failure taxonomy:** HTTP/code → class; description text ignored except `CONCURRENT_OPERATION`.
- **Effective access:** max across sources; mode filter; grant window edges (`validFrom == now`, `validUntil == now`); `FREE` default; set form agrees with the per-user form on shared fixtures.
- **Capability catalog:** Free/Pro/Pro+ matrix exactly as `plans.md`.
- **Signatures:** webhook HMAC valid/invalid/previous-secret/expired-previous; checkout signature uses the server-held ID.
- **Backoff/cooldown math:** jitter bounds [0.5, 1.0].
- **Policies:** `PortfolioPolicy` create with/without the capability and admin override; public view `FEATURE_DISABLED` (extend the existing tests).
- **Mode resolution:** disabled / partial / mismatched prefix / expected-mode mismatch.

**Integration (`*.integration.test.ts`, `DATABASE_TEST_URL`, prefix cleanup, fake provider):**

- **Commands:** happy create; same-key retry; two concurrent checkouts (`Promise.all`) → one provider create; budget exhausted → `ABANDONED`; timeout → `OUTCOME_UNKNOWN`, never re-sent; crash between call and tx B → lease → unknown.
- **Composed:** supersession (cancel refused → purchase refused; cancel ok but fetch still `halted` → `CONFIRMING`, no create; confirmed → create + `supersededById`); abandon-and-recreate.
- **Sync:** two fetches applied in reverse → older discarded; webhook during in-flight fetch → a further fetch due; burst → one fetch; claim `SKIP LOCKED` exclusivity (two concurrent claims); lease expiry reclaim; terminal-out transition → anomaly.
- **Webhook:** signature before any write; duplicate delivery; unmatched → bind via notes; unmatched without notes → anomaly; fact dedupe; unsupported type; non-JSON; DB failure → 500 and no row.
- **Reconciliation:** batch stops at deadline, empty claim and no budget; cooldown skips P2–P4 but allows P1; orphan windowing, watermark only after a full window, closed window → `ABANDONED`.
- **Quota:** 9/10 with two concurrent creates → exactly one succeeds; soft-deleted projects excluded; admin override.
- **Grants:** self-grant refused (service and CHECK); concurrent revoke/extend both audited; expiry by clock only; promotion double-redeem and last-slot race.
- **Downgrade:** revoke grant → projects kept, creation refused; portfolio hidden publicly, still editable, `visibility` unchanged; preferences unchanged; MCP refused, tokens intact; re-grant restores everything with no writes.
- **HALTED/PAUSED supersession** and **PAST_DUE cancellation-not-effective:** I-4 (i)–(iii) each raise the anomaly (ii and iii after IB-1 sign-off).
- **TEST/LIVE isolation:** a `TEST` row in an expected-`LIVE` resolver contributes nothing; sync skips other-mode rows; `notes.kz_env` mismatch → anomaly.
- **Notifications:** scheduler excludes non-entitled users; handler suppresses `NOT_ENTITLED`; deadline notifications still work for Pro while recommendations do not.
- **Account removal (S16):** `remove-user` blocked by `Restrict`; pseudonymization path.

**Provider-TEST (opt-in, manual, `RAZORPAY_*` TEST keys, never in CI by default):** a contract suite for the Razorpay implementation (create/fetch/cancel immediate on created/authenticated/active/pending/halted/paused; cycle-end on active; update refusals classified `REJECTED`; list window inclusivity; `expire_by` expiry lag); a webhook suite once S7 registers a TEST endpoint (A6 header presence and stability across a deliberately failed delivery; A3/A9 observations recorded in `razorpay-facts.md`). "All tests pass on admin grants" is never read as "Razorpay integration verified".

---

## Related documents

**In this directory**

- [Subscription State Model](state-model.md)
- [Billing Command Model](command-model.md)
- [Webhook Architecture](webhooks.md)
- [Synchronization](synchronization.md)
- [Reconciliation](reconciliation.md)
- [Effective Access](effective-access.md)
- [Open decisions](open-decisions.md) · [Settled decisions](settled-decisions.md) · [Index](README.md)

**Design and specification**

- [Testing without Razorpay](../cross-cutting/testing-without-razorpay.md)
- [Repository testing conventions](../../../../next/docs/testing/README.md)
- [Repository database testing](../../../../next/docs/testing/database.md)
