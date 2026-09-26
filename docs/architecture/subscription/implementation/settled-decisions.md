# Settled Decisions

> **Status:** Implementation plan — not implemented
>
> **Last Updated:** 2026-09-24
>
> **Blueprint section:** §21 A (see the [section map](README.md#blueprint-section-map))

Three lists:

1. The project circumstances that were stated when these documents were created and that the plan was adjusted for.
2. The decisions the design documents and research had already settled, which the implementation plan relies on and does not reopen.
3. The [rulings from the 2026-09-24 decision close-out](#rulings-from-the-2026-09-24-decision-close-out), split by decision authority.

The findings behind each ruling, and the few items still deferred, are in [open decisions](open-decisions.md).

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
- Commands recorded before calling; one in-flight (root) operation per user (IB-6); outcome-unknown resolved by observation, never retry; idempotency keys + natural-key reuse; responses through the sync apply path; confirm verifies against the server-held ID (SB-CM-01…06).
- Webhooks: verify raw body first; persist with dedupe before 2xx; refetch, never trust payload status; facts append-only; ack before processing; unmatched persisted and matched by notes only; previous secret during rotation; the subscribed event set (SB-WH-01…08).
- One sync mechanism; due-based reconciliation; one global outbound budget with priorities; failures never change state; stale-apply guard on request-send time; bounded orphan scan; background never mutates (SB-RC-03…10).
- Trials Razorpay-native, kind recorded, one per account (SB-LC-01/10/11). Upgrades immediate, downgrades cycle-end, native only; Razorpay decides possibility (SB-LC-02/03/07). At most one scheduled change, cancellation wins (SB-LC-08). Cycle-end cancel default, immediate during trial, no undo; immediate cancel is admin/support (SB-LC-04/05/09). Dashboard/customer changes are normal paths (SB-LC-06).
- No second retry engine; `PAST_DUE` keeps access; `HALTED` ends access but is never auto-cancelled; recovery restores access; halted sync decays (SB-PF-01…05).
- Provider boundary sized, not generic; mode resolved once; disabled is a supported production state; Razorpay IDs stay inside billing; per-mode plan catalog many-to-one; scheduler-agnostic execution on the existing tick (SB-PB-01…06).
- Downgrade never deletes; portfolio `visibility` never overridden; public eligibility is a second gate; billing records survive account removal (SB-DP-01…04).
- Offers for discounts, Promotions for free access; no coupon engine; pre-provisioned Offers; Kizunia-side eligibility with atomic redemption; Offers linkable to active subscriptions at cycle end (SB-CP-01…05).
- TEST-verified facts relied on: immediate cancel works for created/pending/paused/halted (A1); cycle-end cancel is invisible (A2) and returns 200 without effect on pending/paused/halted (D2); list filters on `created_at`, inclusive (A5); `expire_by` expiry with lag (A8); `total_count` ceilings (A13); repeat cycle-end cancel harmless (A14); update refusals classified by code only (A4 part, D8/D10).

## Rulings from the 2026-09-24 decision close-out

The close-out ruled every open IB finding before implementation. The full finding, historical recommendation and ruling for each item are in [open decisions](open-decisions.md); this section lists the rulings by **decision authority**, which is always recorded and never blurred:

- **Product decisions (owner)** were made by the project owner. They change product behavior and are recorded as `PRODUCT` rulings in the [decision register](../../../project/feature-specification/subscription/decisions/README.md).
- **Architecture/technical decisions (autonomous)** were derived from the existing architecture, code and conventions, each with a rationale. They are recorded as `ENGINEERING` rulings where they amend one. **The owner may override any of them** with a new, recorded ruling.

### Product decisions (owner) — 2026-09-24

| # | Item | Ruling | Amended |
| --- | --- | --- | --- |
| U-1 | [IB-21](open-decisions.md#ib-21--plan-change-extensibility) / B1: paid→paid plan changes | **Keep SB-LC-07.** Native Razorpay Update only, where Razorpay supports it (in practice international cards). UPI, e-mandate and domestic-card paid→paid changes are an explicit V1 limitation: cancel at cycle end, then rebuy after the period. A switch/successor flow is DEFERRED. The design must let it be added later without restructuring | SB-LC-07 (reaffirmed), product B1 |
| U-2 | [IB-1](open-decisions.md#ib-1--past_due-cancellation): customer cancel in `PAST_DUE` | **Immediate cancellation.** Access ends when the cancel is observed. The unpaid period is not owed | SB-LC-04 (second amendment) |
| U-3 | [IB-7](open-decisions.md#ib-7--admin-bypass-of-entitlement-gates): admin bypass | **Interactive bypass only.** `ADMIN`/`SUPER_ADMIN` bypass project quota, portfolio creation and MCP through `.platformOverride()`. There is no bypass for background notification eligibility; admins get explicit grants from another admin. Public portfolio display follows the owner's effective access | SB-EA-04 |
| U-4 | [IB-15](open-decisions.md#ib-15--billing-admin-roles): billing roles | `SUPER_ADMIN`: manage grants, manage billing, view billing. `ADMIN`: view billing and read-only "sync now". `MODERATOR`: none. Raw payloads: `SUPER_ADMIN` only | — |

### Architecture/technical decisions (autonomous) — 2026-09-24

| Item | Ruling (short form) | Rationale |
| --- | --- | --- |
| [IB-2](open-decisions.md#ib-2--recommendation-gate-point) | Gate the notification **intents** (`REGISTRATION_CLOSING` for Pro and above, `TOP_RELEVANT_COMPETITION` for Pro+ only). The check runs in the scheduler, again in the handler/policy, and again at delivery (`NOT_ENTITLED`). The engine is never gated | The engine is shared by a Pro and a Pro+ feature; intents are already the unit of notification eligibility |
| [IB-3](open-decisions.md#ib-3--entitlement-resolver-signature) | New async per-user effective-access API in `lib/entitlements`. The existing synchronous `resolveEntitlements()` keeps serving rate limiting, which is unchanged in V1 | One read seam without adding queries to every rate-limited request |
| [IB-4](open-decisions.md#ib-4--portfolio-creation-gate) | `CREATE_PORTFOLIO` stays baseline. `PortfolioPolicy` create chain: `.platformOverride()` then `.require(entitled, UPGRADE_REQUIRED)` | Permission sets are static by convention |
| [IB-5](open-decisions.md#ib-5--async-portfolio-public-eligibility) | Public eligibility computed async before `fromData`, passed in; policy shape unchanged | Entitlement reads are I/O |
| [IB-6](open-decisions.md#ib-6--composed-commands-and-the-in-flight-constraint) | Root-only in-flight index; children under the root's slot; no hidden continuation (`CONFIRMING`); admin commands share the slot; `Idempotency-Key` required on billing mutations | Composed commands must be expressible without weakening SB-CM-01 or SB-RC-10 |
| [IB-9](open-decisions.md#ib-9--trial-conversion-gap) | `TRIAL` + `authenticated` after `start_at` stays `TRIALING`, bounded by grace C7, then non-contributing plus `TRIAL_CONVERSION_OVERDUE`. Revisit on A7 | No access gap at conversion, and no unbounded free access |
| [IB-10](open-decisions.md#ib-10--tick-time-budget) | `billing:sync` before `notifications:tick` with its own budget; notification budget lowered; values implementation-time | Tick `maxDuration` 60 s, sequential tasks |
| [IB-11](open-decisions.md#ib-11--alerting-channel) | `billing.alert` structured logs now; channel is a LIVE blocker | No alerting infrastructure exists |
| [IB-12](open-decisions.md#ib-12--soft-deleted-projects-and-the-quota) | Quota counts owned, non-deleted projects; future restore/transfer paths re-check the quota; `ProjectMember(userId, role)` index; per-user `pg_advisory_xact_lock` in `ProjectService.create` | Matches the documented quota semantics; no per-user row to lock |
| [IB-13](open-decisions.md#ib-13--boot-time-mode-validation-and-expected-mode) | Validate in `src/instrumentation.ts`. Optional `BILLING_EXPECTED_MODE`, else `live` on `VERCEL_ENV=production`, otherwise `test`. Fail fast on mismatch; no credentials means disabled | No env-validation home exists; SB-PB-02 |
| [IB-14](open-decisions.md#ib-14--account-removal-storage) | Nullable `userId` + `Restrict` + `subjectPseudonym` on every billing/grant table (DECIDED). Pseudonymization workflow DEFERRED until the platform has account deletion | No deletion feature exists; `Restrict` makes a hard delete fail safely |
| [IB-16](open-decisions.md#ib-16--preferences-for-non-entitled-intents) | Always store the toggle; DTO `entitled` flag; UI "requires Pro / Pro+" | Preferences are not entitlements (SB-DP-01) |
| [IB-17](open-decisions.md#ib-17--stale-documents-and-leftovers) | Docs items fixed; dead `Subscription` interface and `.env.example` in Phase III | Hygiene |
| [IB-19](open-decisions.md#ib-19--tick-cadence-on-the-vercel-hobby-plan) | Daily cron is enough for development and TEST; C6 target via external pinger or finer cron before LIVE | Hobby plan limits |
| [IB-20](open-decisions.md#ib-20--a-public-test-webhook-endpoint) | Stable TEST webhook URL (protection bypassed on that path) in Phase IV | Webhooks unobserved so far |
| [IB-21](open-decisions.md#ib-21--plan-change-extensibility) (seam) | `ChangePlan` strategy policy (`NATIVE_UPDATE` / `UNAVAILABLE`); single open-subscription precondition policy; `supersededById` link reused; provider interface already sufficient | U-1's extensibility requirement |
| [IB-22](open-decisions.md#ib-22--upi-recovery-ux) (capability only) | Both UPI recovery routes are supported by the architecture; **the UX is PROVIDER-DEPENDENT** until UPI is verified | UPI never observed ([IB-18](open-decisions.md#ib-18--upi-disabled-on-the-razorpay-test-account)) |

### Architecture/technical decisions (autonomous) — 2026-09-25 (Phase IV)

| Item | Ruling (short form) | Rationale |
| --- | --- | --- |
| [IB-23](open-decisions.md#ib-23--detecting-a-missing-provider-subscription) | A sync `fetchSubscription` of a stored ID failing `REJECTED` or `NOT_FOUND` raises `PROVIDER_SUBSCRIPTION_MISSING` (operation context); classification unchanged; mode mismatch detected locally only | A GET of a stored ID has no business refusal (D12); no description matching |
| [IB-24](open-decisions.md#ib-24--phase-iv-implementation-rulings) | `TERMINAL_STATE_CONTRADICTED` anomaly; `parseWebhookEvent` on the interface; `ON CONFLICT` dedupe; unmatched backstop in `billing:sync`; terminal events linked not marked; two self-resolving anomaly types; tick budgets 10 s / 30 s; admin sync-now shape; ngrok for IB-20; TEST plans with temporary TEST-only prices | Details the Phase IV design left open |

### Architecture/technical decisions (autonomous) — 2026-09-25/26 (Phases V and VI)

| Item | Ruling (short form) | Rationale |
| --- | --- | --- |
| [IB-25](open-decisions.md#ib-25--phase-v-implementation-rulings) | Tx B composes the apply path; orphan window closes on a send-time bound; local refusals recorded with a null `failureClass`; abandon-then-create rooted at the create; reuse needs time left; orphan discovery last in the tick; provider IDs only in the checkout response; no key for confirm; `billing:command` defined | Details the Phase V design left open |
| [IB-26](open-decisions.md#ib-26--phase-vi-implementation-rulings) | Cancel rooted at the cancel (scheduled-change child for cycle-end only); acknowledged cancel timing; requested period end on the request, I-4 (iii) as a state check; composed-root status; supersession shape with a pre-cancel re-check; plan-change direction by catalog price; advisory correction on refusal; recovery and "check now" endpoints; admin cancel takes a key; IB-22 still provider-dependent | Details the Phase VI design left open |

### Product decisions (owner) — 2026-09-26 (Phase VII)

| # | Item | Ruling | Amended |
| --- | --- | --- | --- |
| U-5 | [IB-27](open-decisions.md#ib-27--phase-vii-decisions-and-implementation-rulings) items 1–2: trial length and scope | **14 days**, configurable; any paid plan and any cycle; converts to the plan and cycle it started on | [trials](../lifecycle/trials.md) |
| U-6 | IB-27 item 3: codes on trials | A marketing code is refused on a trial checkout | [coupons and offers](../entitlements/coupons-and-offers.md) |
| U-7 | IB-27 item 4: UPI trials | Offered to every method; a provider refusal surfaces. A16 (b) stays PROVIDER-DEPENDENT | [trials](../lifecycle/trials.md) |
| U-8 | IB-27 item 5: when a code is consumed | Only by a subscription that carried it and reached a contributing phase | [coupons and offers](../entitlements/coupons-and-offers.md) |
| U-9 | IB-27 item 6: Offer provisioning | Static catalog in V1 behind one narrow seam; a DB-backed admin-managed catalog is future work, an intentional limitation | [coupons and offers](../entitlements/coupons-and-offers.md), [configuration](configuration.md) |

### Architecture/technical decisions (autonomous) — 2026-09-26 (Phase VII)

| Item | Ruling (short form) | Rationale |
| --- | --- | --- |
| [IB-27](open-decisions.md#ib-27--phase-vii-decisions-and-implementation-rulings) items 7–19 | Eligibility from Subscription rows in the current mode; `FIRST_PAID_SUBSCRIPTION_ONLY` from Subscription rows only (never grants); same-intent reuse; code refusals; provider-refused Offer alert; promotion redemption is one transaction with no idempotency key; `MANAGE_ENTITLEMENT_GRANTS` is the one promotion permission; disjoint codes; overdue anomaly never auto-resolved | Details the Phase VII design left open |

### Still open for the owner (not blocking before the named phase)

- Whether LIVE launch waits for trials, Offers and Promotions: before [Phase IX](../implementation-plan/phase-IX/README.md).
- Pricing (B6), the alert channel (IB-11) and the tick trigger (IB-19): LIVE blockers, resolved in Phase IX.
- Enabling UPI with Razorpay Support (IB-18): an external action, needed for UPI verification.

## Related documents

- [Open decisions](open-decisions.md) · [Index](README.md) · [Phase-wise implementation plan](../implementation-plan/README.md)
- [Decision register](../../../project/feature-specification/subscription/decisions/README.md)
- [Architecture decision record](../../decisions/subscription-billing.md)
- [Razorpay facts](../provider-boundary/razorpay-facts.md)
