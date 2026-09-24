# Settled Decisions

> **Status:** Implementation plan — not implemented
>
> **Last Updated:** 2026-09-24
>
> **Blueprint section:** §21 A (see the [section map](README.md#blueprint-section-map))

Two lists. The first records project circumstances that were stated when these documents were created and that the plan was adjusted for. The second lists the decisions the design documents and research have already settled, which the implementation plan relies on and does not reopen. Unresolved items are in [open decisions](open-decisions.md).

## Decisions applied when this documentation was created

Stated by the project owner on 2026-09-24, when the reviewed blueprint was converted into these documents.

| # | Decision | Effect on this plan |
| --- | --- | --- |
| PS-1 | Kizunia is pre-production. | There are no live customers or subscriptions yet. LIVE readiness (slice S17) remains a separate, later step. |
| PS-2 | The database will be created fresh. | No slice needs a backfill or a data migration. The billing schema is applied to an empty database. |
| PS-3 | There are currently zero users. | There are no existing users whose access could be reduced by an entitlement gate. |
| PS-4 | There is no legacy-user migration requirement. | No grandfathering, no bulk admin grants for existing users, no migration of legacy accounts. |
| PS-5 | IB-8 is removed as a production blocker. | IB-8 is [withdrawn](open-decisions.md#withdrawn-findings). Slice S3 (feature gates) has no rollout dependency; in the blueprint its late position in the [commit sequence](implementation-plan.md) was tied to IB-8, which no longer constrains it (its other prerequisites remain). The configuration document no longer treats entitlement enforcement as an open question. |

These assumptions change nothing else. In particular: how the billing migrations are organized relative to the existing migration history is not addressed by the blueprint and is not decided here; account removal (S16) and the retention question ([B3](../../../project/feature-specification/subscription/open-decisions.md#b-genuinely-open-product-questions)) are unaffected; and admin grants remain the way to exercise every paid capability without Razorpay in development ([testing without Razorpay](../cross-cutting/testing-without-razorpay.md)).

## Decisions settled by the design documents and research

Only decisions actually supported by the current documents and research ([blueprint §21 A](README.md#blueprint-section-map)). Rule IDs refer to the [decision register](../../../project/feature-specification/subscription/decisions/README.md).

- Razorpay is the billing provider only. Kizunia owns membership, effective access, entitlements, quotas and history (ADR; principles).
- `FREE` is never stored; users who never checked out have no billing rows (SB-EA-01 amended).
- Effective access = max over contributing Subscriptions (`TRIALING`/`ACTIVE`/`PAST_DUE`, expected mode) and valid grants (SB-EA-02/06/07). Sources coexist (SB-EA-03). Admin bypass is not an entitlement source (SB-EA-04). Features check capabilities, never plans or Razorpay fields (SB-EA-05, SB-PL-02).
- No self-grants (SB-EA-08); grant expiry derived, never written (SB-EA-09).
- Plans: FREE/PRO/PRO_PLUS; monthly/yearly as a cycle; the matrix in `plans.md`; quotas count `OWNER` only; recommendations Pro+ (SB-PL-01…05).
- One Subscription per Razorpay subscription, bound once; never a second open subscription; reuse and refusal table; supersession only after a confirmed immediate cancel; duplicates detected, never auto-resolved (SB-UQ-01…05).
- Commands recorded before calling; one in-flight per user; outcome-unknown resolved by observation, never retry; idempotency keys + natural-key reuse; responses through the sync apply path; confirm verifies against the server-held ID (SB-CM-01…06).
- Webhooks: verify raw body first; persist with dedupe before 2xx; refetch, never trust payload status; facts append-only; ack before processing; unmatched persisted and matched by notes only; previous secret during rotation; the subscribed event set (SB-WH-01…08).
- One sync mechanism; due-based reconciliation; one global outbound budget with priorities; failures never change state; stale-apply guard on request-send time; bounded orphan scan; background never mutates (SB-RC-03…10).
- Trials Razorpay-native, kind recorded, one per account (SB-LC-01/10/11). Upgrades immediate, downgrades cycle-end, native only; Razorpay decides possibility (SB-LC-02/03/07). At most one scheduled change, cancellation wins (SB-LC-08). Cycle-end cancel default, immediate during trial, no undo; immediate cancel is admin/support (SB-LC-04/05/09). Dashboard/customer changes are normal paths (SB-LC-06).
- No second retry engine; `PAST_DUE` keeps access; `HALTED` ends access but is never auto-cancelled; recovery restores access; halted sync decays (SB-PF-01…05).
- Provider boundary sized, not generic; mode resolved once; disabled is a supported production state; Razorpay IDs stay inside billing; per-mode plan catalog many-to-one; scheduler-agnostic execution on the existing tick (SB-PB-01…06).
- Downgrade never deletes; portfolio `visibility` never overridden; public eligibility is a second gate; billing records survive account removal (SB-DP-01…04).
- Offers for discounts, Promotions for free access; no coupon engine; pre-provisioned Offers; Kizunia-side eligibility with atomic redemption; Offers linkable to active subscriptions at cycle end (SB-CP-01…05).
- TEST-verified facts relied on: immediate cancel works for created/pending/paused/halted (A1); cycle-end cancel is invisible (A2) and returns 200 without effect on pending/paused/halted (D2); list filters on `created_at`, inclusive (A5); `expire_by` expiry with lag (A8); `total_count` ceilings (A13); repeat cycle-end cancel harmless (A14); update refusals classified by code only (A4 part, D8/D10).

## Related documents

- [Open decisions](open-decisions.md) · [Index](README.md)
- [Decision register](../../../project/feature-specification/subscription/decisions/README.md)
- [Architecture decision record](../../decisions/subscription-billing.md)
- [Razorpay facts](../provider-boundary/razorpay-facts.md)
