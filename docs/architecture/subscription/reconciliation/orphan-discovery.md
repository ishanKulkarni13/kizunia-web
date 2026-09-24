# Orphan Discovery

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24

Finding Razorpay subscriptions Kizunia has no record pointing at. Ruling:
[SB-RC-09](../../../project/feature-specification/subscription/decisions/reconciliation.md#sb-rc-09--provider-subscriptions-kizunia-lost-track-of-are-found-by-a-bounded-scan).

---

## Why per-subscription sync cannot find these

Every other mechanism starts from a local Subscription with a provider ID. An orphan has none:

| How an orphan arises | Local state |
| --- | --- |
| Create succeeded at Razorpay; response lost / process died / bind transaction failed | `PROVISIONING` without provider ID, operation `OUTCOME_UNKNOWN` |
| Subscription created in the Dashboard or via a Subscription Link | Nothing |

For the first, the subscription's webhooks (if any arrive) resolve it through `notes`
([SB-WH-06](../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md#sb-wh-06--events-for-unknown-subscriptions-are-persisted-and-matched-never-dropped)).
But an abandoned checkout produces no webhook at all, and webhooks can be disabled. Orphan discovery is
the path that does not depend on webhooks.

## The scan

A tick task, budget priority 4, with a persisted watermark per provider mode.

```text
window.from := watermark - overlap
window.to   := now - settleDelay
page through GET /v1/subscriptions?from=..&to=..&count=100&skip=..
  at most maxPagesPerRun pages; stop early if budget is unavailable
  for each item:
    if a local Subscription has this provider ID            -> skip (known)
    elif notes.kz_env == current mode and notes.kz_sub names a local record:
        PROVISIONING without provider ID                    -> bind it; mark sync-due;
                                                               resolve its operation SUCCEEDED
        anything else (already bound to another ID, terminal) -> anomaly NOTES_CONFLICT
    else                                                    -> anomaly UNMATCHED_PROVIDER_SUBSCRIPTION
                                                               (recorded once per provider ID)
when the window has been fully paged: watermark := window.to
```

- **Bounded:** `maxPagesPerRun` × 100 items per run, and budget-gated. A backlog after an incident
  drains over several runs; the watermark advances only when a window is complete, so nothing is
  skipped.
- **Overlap:** windows overlap by a configured margin. Which timestamp `from`/`to` filter on is not
  documented, but TEST mode showed it is `created_at` with both bounds inclusive
  ([A5, verified 2026-09-24](../../../project/feature-specification/subscription/open-decisions.md#a-resolved-answered-by-test-verification-2026-09-24)),
  so the margin now only has to cover clock skew and settle delay, not an unknown timestamp. The
  margin is kept as designed (the observation is not a documented guarantee). Re-seeing an item is
  harmless — known IDs are skipped.
- **Settle delay:** the newest minutes are not scanned, so an in-progress create is not misreported.

## Resolving `OUTCOME_UNKNOWN` creates

A `PROVISIONING` record without a provider ID stays so until either it is bound (above, or by a
webhook) or the scan's watermark has passed its `requestSentAt + overlap` with no match. Then it
becomes `ABANDONED`, its operation `NOT_APPLIED`, and the user may start a new checkout. The window
is deliberately generous: declaring a create abandoned too early is how a later duplicate could be
created ([`../lifecycle/multiple-subscriptions.md`](../lifecycle/multiple-subscriptions.md#detection)).

## What it never does

It never cancels an unmatched subscription and never attaches one to a user by email, phone or
amount ([SB-RC-10](../../../project/feature-specification/subscription/decisions/reconciliation.md#sb-rc-10--synchronization-only-reads-it-never-changes-provider-state)).
An operator decides; the runbook describes how ([`../cross-cutting/operations-runbook.md`](../cross-cutting/operations-runbook.md#unmatched-provider-subscription)).
