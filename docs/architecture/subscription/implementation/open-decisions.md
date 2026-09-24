# Open Decisions

> **Status:** Implementation plan — not implemented
>
> **Last Updated:** 2026-09-24
>
> **Blueprint section:** implementation blockers and required decisions, and §21 B (see the [section map](README.md#blueprint-section-map))

Everything in this file is **open**. None of it is resolved by these documents. The findings below come from comparing the design documents in [`docs/architecture/subscription/`](../README.md) and [`docs/project/feature-specification/subscription/`](../../../project/feature-specification/subscription/README.md) with the current code. Each names what it blocks and the blueprint's recommended resolution for whoever owns the decision. **A recommended resolution is a recommendation, not a decision.**

Other implementation documents in this directory sometimes describe behavior that follows a recommendation (for example the async resolver signature, the root-only in-flight index, the nullable `userId` with `Restrict`). Each such document names the item it depends on, and that text is provisional until the item is ruled. Nothing here changes an architecture decision that the design documents have settled; where the code and the design disagree, the disagreement is recorded, not fixed.

The product-level register at [`open-decisions.md`](../../../project/feature-specification/subscription/open-decisions.md) (items A, B and C) remains authoritative for the Razorpay, product and configuration items; they are listed [below](#open-razorpay-items) only so an implementer can see everything that is unresolved in one place. The IB items are new and live only here.

**Project status assumptions.** Kizunia is pre-production, the database will be created fresh, there are currently zero users, and there is no legacy-user migration requirement. Under these assumptions the former finding IB-8 is withdrawn; see [Withdrawn findings](#withdrawn-findings) and [settled decisions](settled-decisions.md#decisions-applied-when-this-documentation-was-created).

## Summary

| ID | Title | Kind | Blocks | Status |
| --- | --- | --- | --- | --- |
| [IB-1](#ib-1--past_due-cancellation) | PAST_DUE cancellation | PRODUCT + ARCHITECTURE | Customer cancel for `PAST_DUE` | Open |
| [IB-2](#ib-2--recommendation-gate-point) | Recommendation gate point | ARCHITECTURE | Recommendations gate (slice S3) | Open |
| [IB-3](#ib-3--entitlement-resolver-signature) | Entitlement resolver signature | ARCHITECTURE | Slice S1 | Open |
| [IB-4](#ib-4--portfolio-creation-gate) | Portfolio creation gate | ARCHITECTURE | Portfolio create gate | Open |
| [IB-5](#ib-5--async-portfolio-public-eligibility) | Async portfolio public eligibility | ARCHITECTURE | Portfolio public gate | Open |
| [IB-6](#ib-6--composed-commands-and-the-in-flight-constraint) | Composed commands and the in-flight constraint | ARCHITECTURE | Supersession, plan change with a pending change, checkout reuse | Open |
| [IB-7](#ib-7--admin-bypass-of-entitlement-gates) | Admin bypass of entitlement gates | PRODUCT | All gates | Open |
| [IB-9](#ib-9--trial-conversion-gap) | Trial conversion gap | PRODUCT + ARCHITECTURE | Trials (S13) | Open |
| [IB-10](#ib-10--tick-time-budget) | Tick time budget | ARCHITECTURE | S6 | Open |
| [IB-11](#ib-11--alerting-channel) | Alerting channel | OPERATIONS | LIVE readiness (not V1 code) | Open |
| [IB-12](#ib-12--soft-deleted-projects-and-the-quota) | Soft-deleted projects and the quota | PRODUCT | Project quota | Open |
| [IB-13](#ib-13--boot-time-mode-validation-and-expected-mode) | Boot-time mode validation and expected mode | CONFIG | S4/S5 | Open |
| [IB-14](#ib-14--account-removal-storage) | Account-removal storage | ARCHITECTURE + B3 | S4 schema, S16 | Open |
| [IB-15](#ib-15--billing-admin-roles) | Billing admin roles | PRODUCT | S2, S15 | Open |
| [IB-16](#ib-16--preferences-for-non-entitled-intents) | Preferences for non-entitled intents | PRODUCT / UX | Preferences UI | Open |
| [IB-17](#ib-17--stale-documents-and-leftovers) | Stale documents and leftovers | DOCS | None (hygiene) | Open |
| IB-8 | Launch enforcement for existing users | — | — | [Withdrawn](#withdrawn-findings) |

Two of these shape the most work and are best ruled first: [IB-1](#ib-1--past_due-cancellation) (a cancellation the provider accepts but does not act on) and [IB-2](#ib-2--recommendation-gate-point) (the recommendation gate has no home as documented).

## Findings from comparing the design documents with the code

### IB-1 — PAST_DUE cancellation

| | |
| --- | --- |
| **Status** | Open — not decided |
| **Kind** | PRODUCT + ARCHITECTURE |
| **Blocks** | Customer cancel for `PAST_DUE` |

**Finding.** **PAST_DUE cycle-end cancellation is not verifiably effective.** The docs keep `cancel_at_cycle_end: true` for `PAST_DUE` (`lifecycle/cancellation.md`). TEST mode returned `200` with no observable effect (A1/D2). The operation model would record that `200` as `SUCCEEDED` and set `cancelAtPeriodEnd`, which contradicts "a `200` here is not evidence". The `CANCELLATION_NOT_EFFECTIVE` rule only covers "still `active` after `current_end`", not `PAST_DUE → HALTED`.

**Recommended resolution (not decided).** See [PAST_DUE cancellation](past-due-cancellation.md). Ship customer cancel for `ACTIVE`/`TRIALING` first. Hold `PAST_DUE` behind this decision.

**Existing documents that a ruling would amend.**

- [`../lifecycle/cancellation.md`](../lifecycle/cancellation.md#customer-cancellation--which-kind) — the customer-cancellation table and its review flag for `PAST_DUE`
- [`../commands/operation-model.md`](../commands/operation-model.md#resolving-outcome_unknown) — how `CANCEL_AT_CYCLE_END` is resolved
- [SB-LC-04](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-04--cancellation-defaults-to-end-of-cycle) — choosing option A or B would change the documented default for one phase, which per the repository's keep-docs-live rule is recorded as an amended ruling

The three options and the invariants that hold regardless of the decision are in [PAST_DUE cancellation](past-due-cancellation.md).

### IB-2 — Recommendation gate point

| | |
| --- | --- |
| **Status** | Open — not decided |
| **Kind** | ARCHITECTURE |
| **Blocks** | Recommendations gate (slice S3) |

**Finding.** **The recommendation gate point in the docs does not exist as described.** `authorization-integration.md` gates `RecommendationController.generateForCurrentUser`, but that route is marked *TEMPORARY — MUST BE REMOVED BEFORE PRODUCTION* (`app/api/v1/me/recommendations/competitions/route.ts`). `module-boundaries.md` names `RecommendationService.generateForUser`, but that engine also powers **Pro** deadline notifications (`evaluate-registration-closing.handler.ts:106`). Gating the engine at Pro+ would break a Pro feature.

**Recommended resolution (not decided).** Gate the *product capability* at the `TOP_RELEVANT_COMPETITION` intent (scheduler predicate + `NotificationPolicyService` re-check), never the engine. Also confirm the mapping: "deadline notifications" = `REGISTRATION_CLOSING`, "competition recommendations" = `TOP_RELEVANT_COMPETITION`.

**Existing documents that a ruling would amend.**

- [`../entitlements/authorization-integration.md`](../entitlements/authorization-integration.md#recommendation-route) — the Recommendation route section
- [`../module-boundaries.md`](../module-boundaries.md) — the consumes table row for `RecommendationService.generateForUser`

### IB-3 — Entitlement resolver signature

| | |
| --- | --- |
| **Status** | Open — not decided |
| **Kind** | ARCHITECTURE |
| **Blocks** | Slice S1 |

**Finding.** **`resolveEntitlements()` cannot change "body only".** It is synchronous and takes no user (`lib/entitlements/index.ts:32`). Its one caller, `RateLimitService.decide` (`lib/rate-limit/service.ts:90`), passes nothing. A per-user, database-backed resolver needs a new async signature. Wiring it into rate limiting adds two queries to every rate-limited request.

**Recommended resolution (not decided).** Add a new async `resolveEntitlements(userId)`. Keep rate limiting on the registry default until a plan-tier override is actually configured. The docs say the default is "no difference", so behavior is identical. Update `quotas-vs-rate-limits.md`.

**Existing documents that a ruling would amend.**

- [`../entitlements/quotas-vs-rate-limits.md`](../entitlements/quotas-vs-rate-limits.md#rate-limiting)
- [`../entitlements/effective-access-resolution.md`](../entitlements/effective-access-resolution.md#what-changes-when-this-ships) — "only the body of `resolveEntitlements()`"
- [`../README.md`](../README.md#environment-facts-this-design-must-respect) — the environment-facts row saying plan-tier rate limits activate by changing that function's body only

### IB-4 — Portfolio creation gate

| | |
| --- | --- |
| **Status** | Open — not decided |
| **Kind** | ARCHITECTURE |
| **Blocks** | Portfolio create gate |

**Finding.** **`CREATE_PORTFOLIO` cannot be gated by "changing only `PlatformPermissionSet` data".** The set is a static `role → actions` map. `PlatformContext` carries only the actor. The authorization conventions forbid dynamic permission sets (`conventions.md:369-379`).

**Recommended resolution (not decided).** Keep `CREATE_PORTFOLIO` in `BASELINE` ("this role may create portfolios"). Add an entitlement `.require(…, UPGRADE_REQUIRED)` step to `PortfolioPolicy`'s create chain, with the actor's entitlements in `PortfolioContext`. Update `authorization-integration.md`.

**Existing documents that a ruling would amend.**

- [`../entitlements/authorization-integration.md`](../entitlements/authorization-integration.md#create_portfolio-baseline-grant) — the `CREATE_PORTFOLIO` baseline grant section

### IB-5 — Async portfolio public eligibility

| | |
| --- | --- |
| **Status** | Open — not decided |
| **Kind** | ARCHITECTURE |
| **Blocks** | Portfolio public gate |

**Finding.** **Portfolio public eligibility is synchronous.** `resolvePortfolioPublicEligibility()` is called from the synchronous `PortfolioContextResolver.fromData`/`forPublicRead` (`context-resolver.ts:94`). An entitlement read is async I/O.

**Recommended resolution (not decided).** Make the resolver step async (compute eligibility before `fromData`, pass it in). `PortfolioPolicy` stays unchanged. The docs' "no signature change" claim needs correcting.

**Existing documents that a ruling would amend.**

- [`../entitlements/authorization-integration.md`](../entitlements/authorization-integration.md#portfolio-public-eligibility) — "no change to `PortfolioPolicy`'s shape" and the body-only framing
- [SB-DP-03](../../../project/feature-specification/subscription/decisions/data-preservation.md#sb-dp-03--portfolio-public-eligibility-is-a-second-independent-gate-alongside-visibility) — its rationale makes the same claim

### IB-6 — Composed commands and the in-flight constraint

| | |
| --- | --- |
| **Status** | Open — not decided |
| **Kind** | ARCHITECTURE |
| **Blocks** | Supersession, plan change with a pending change, checkout reuse |

**Finding.** **"One `IN_FLIGHT` per user" as literally specified blocks composed commands.** Parent and child `BillingOperation`s would both be `IN_FLIGHT`. The docs also don't say how a composed command *continues* when sync confirmation is not immediate (supersession, abandon-then-recreate).

**Recommended resolution (not decided).** Apply the partial unique index only to root operations (`parentOperationId IS NULL`); children run under the root's slot. If confirmation is not observed within the request, the root finishes without creating anything and the user's next checkout request proceeds normally. See [command model](command-model.md).

**Existing documents that a ruling would amend.**

- [`../commands/operation-model.md`](../commands/operation-model.md) — the "at most one `IN_FLIGHT` operation per user" invariant and the composed-command paragraph
- [`../lifecycle/multiple-subscriptions.md`](../lifecycle/multiple-subscriptions.md#supersession) — the supersession steps
- [`../../domain/subscription/relationships.md`](../../domain/subscription/relationships.md) — the `IN_FLIGHT BillingOperations ≤ 1` cardinality row

### IB-7 — Admin bypass of entitlement gates

| | |
| --- | --- |
| **Status** | Open — not decided |
| **Kind** | PRODUCT |
| **Blocks** | All gates |

**Finding.** **Admin bypass of entitlement gates is only half specified.** The spec says admins bypass feature gates via `platformOverride()` (`entitlements-and-effective-access.md`). `PlatformPolicy` has no `platformOverride`, and background jobs have no actor at all. Admins also use MCP today.

**Recommended resolution (not decided).** Interactive gates (project quota, portfolio create, MCP) use `.platformOverride()`. Background eligibility (notification scheduling) has no bypass; an admin who wants notifications gets an admin grant. Confirm both halves.

**Existing documents that a ruling would amend.**

- [`entitlements-and-effective-access.md`](../../../project/feature-specification/subscription/entitlements-and-effective-access.md#admin-access-is-not-a-subscription-tier) (product spec) and [SB-EA-04](../../../project/feature-specification/subscription/decisions/effective-access-and-grants.md#sb-ea-04--admin-platform-role-bypass-is-not-an-entitlement-source)
- [`../entitlements/authorization-integration.md`](../entitlements/authorization-integration.md)

### IB-9 — Trial conversion gap

| | |
| --- | --- |
| **Status** | Open — not decided |
| **Kind** | PRODUCT + ARCHITECTURE |
| **Blocks** | Trials (S13) |

**Finding.** **Trial conversion gap.** The mapping sends `authenticated` + `kind TRIAL` + `start_at` **passed** to `PENDING_AUTHENTICATION`, which does not contribute. The `start_at` checkpoint sync is timed exactly for that window. TEST showed `authenticated` persisting 47 minutes after `start_at` (A7). A converting trial user would lose access until Razorpay reports `active`.

**Recommended resolution (not decided).** Keep `TRIALING` for a `TRIAL` subscription that is still `authenticated` after `start_at`, until Razorpay reports `active`/`pending`/`halted`/`cancelled`. Access still follows only an observation. Requires amending `state-mapping.md`.

**Existing documents that a ruling would amend.**

- [`../lifecycle/state-mapping.md`](../lifecycle/state-mapping.md#the-mapping) — the `authenticated` mapping rows and "Why `TRIALING` needs `kind`"
- [`../lifecycle/trials.md`](../lifecycle/trials.md#conversion-is-not-a-separate-code-path)
- [SB-LC-10](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-10--subscription-kind-is-recorded-at-creation-never-inferred)

### IB-10 — Tick time budget

| | |
| --- | --- |
| **Status** | Open — not decided |
| **Kind** | ARCHITECTURE |
| **Blocks** | S6 |

**Finding.** **Tick time budget.** The tick has `maxDuration = 60` and runs tasks sequentially. `notifications:tick` gets a 45 s drain budget (`JOB_CONFIG.wallClockBudgetMs`). A billing task registered after it gets at most about 15 s, less the other tasks.

**Recommended resolution (not decided).** Register `billing:sync` **before** `notifications:tick`, with its own budget (about 10–12 s). Lower the notification default so the sum stays under 60 s with teardown headroom.

**Existing documents that a ruling would amend.**

- [`../reconciliation/reconciliation-job.md`](../reconciliation/reconciliation-job.md#the-billing-sync-tick-task)
- [`../../workflows/internal-jobs.md`](../../workflows/internal-jobs.md#the-tick-one-cron-entry-many-tasks)

### IB-11 — Alerting channel

| | |
| --- | --- |
| **Status** | Open — not decided |
| **Kind** | OPERATIONS |
| **Blocks** | LIVE readiness (not V1 code) |

**Finding.** **No alerting channel exists.** The docs require "page"/High alerts. The repo has only structured `console` logs, no metrics and no pager.

**Recommended resolution (not decided).** Emit one structured `billing.alert` log event per condition now. Choose the delivery channel (Vercel log-drain alert, e-mail, or in-app admin notice) before LIVE.

**Existing documents that a ruling would amend.**

- [`../cross-cutting/observability.md`](../cross-cutting/observability.md#alerting)
- [`../cross-cutting/operations-runbook.md`](../cross-cutting/operations-runbook.md)

### IB-12 — Soft-deleted projects and the quota

| | |
| --- | --- |
| **Status** | Open — not decided |
| **Kind** | PRODUCT |
| **Blocks** | Project quota |

**Finding.** **Owned-project quota and soft delete.** Projects soft-delete (`Project.deletedAt`) and keep their `OWNER` row. The docs count `ProjectMember.role = OWNER` only. `ProjectMember` has no `userId` index.

**Recommended resolution (not decided).** Count only `deletedAt IS NULL` projects, so deleting a project frees a slot, which matches "until owned count is back at or under". Add `@@index([userId, role])`.

**Existing documents that a ruling would amend.**

- [`../entitlements/quotas-vs-rate-limits.md`](../entitlements/quotas-vs-rate-limits.md#project-ownership-quota)
- [SB-PL-03](../../../project/feature-specification/subscription/decisions/plans-and-quotas.md#sb-pl-03--project-quotas-count-ownership-only)

### IB-13 — Boot-time mode validation and expected mode

| | |
| --- | --- |
| **Status** | Open — not decided |
| **Kind** | CONFIG |
| **Blocks** | S4/S5 |

**Finding.** **Mode resolution "once, at boot, fail fast" has no home.** There is no env-validation module and no `instrumentation.ts`. The "expected billing mode" has no configured source.

**Recommended resolution (not decided).** Add `src/instrumentation.ts` `register()` to validate billing config at server start. Add an explicit `BILLING_EXPECTED_MODE`, with the rule when absent: `live` if `VERCEL_ENV=production`, else `test`. See [configuration](configuration.md).

**Existing documents that a ruling would amend.**

- [`../provider-availability/environments.md`](../provider-availability/environments.md#resolution-once-at-boot)
- [SB-PB-02](../../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-02--provider-mode-is-resolved-once-at-boot) and [SB-EA-07](../../../project/feature-specification/subscription/decisions/effective-access-and-grants.md#sb-ea-07--a-subscription-contributes-only-in-the-provider-mode-it-was-created-in)

### IB-14 — Account-removal storage

| | |
| --- | --- |
| **Status** | Open — not decided |
| **Kind** | ARCHITECTURE + B3 |
| **Blocks** | S4 schema, S16 |

**Finding.** **Account removal storage.** No removal flow exists, but the Better Auth `admin()` plugin exposes `/api/auth/admin/remove-user`. The docs require "no cascade" plus pseudonymization, but leave storage open. Retention is B3.

**Recommended resolution (not decided).** Use a nullable `userId` FK with `onDelete: Restrict` on billing tables, which makes the database refuse user removal while billing rows exist, plus a `subjectPseudonym` column. Pseudonymization nulls `userId` and stamps the pseudonym in one transaction.

**Existing documents that a ruling would amend.**

- [`../../domain/subscription/relationships.md`](../../domain/subscription/relationships.md#storage-is-an-implementation-phase-decision)
- [SB-DP-04](../../../project/feature-specification/subscription/decisions/data-preservation.md#sb-dp-04--billing-records-survive-account-removal) and product open question [B3](../../../project/feature-specification/subscription/open-decisions.md#b-genuinely-open-product-questions) (retention)

### IB-15 — Billing admin roles

| | |
| --- | --- |
| **Status** | Open — not decided |
| **Kind** | PRODUCT |
| **Blocks** | S2, S15 |

**Finding.** **Billing admin roles are unassigned.** The docs require explicit billing actions (`MANAGE_ENTITLEMENT_GRANTS`, billing-read, billing-manage) but never say which `PlatformRole`s hold them.

**Recommended resolution (not decided).** Give `SUPER_ADMIN` all three and `ADMIN` read-only. Confirm.

**Existing documents that a ruling would amend.**

- [`../entitlements/admin-grants.md`](../entitlements/admin-grants.md#authorization-for-granting)
- [`../cross-cutting/security.md`](../cross-cutting/security.md#authorization-boundaries)

### IB-16 — Preferences for non-entitled intents

| | |
| --- | --- |
| **Status** | Open — not decided |
| **Kind** | PRODUCT / UX |
| **Blocks** | Preferences UI |

**Finding.** **Preferences for intents the user is not entitled to.** Data preservation keeps preferences across downgrades. The notification entitlement doc says an entitlement's "absence means cannot be enabled". The spec doesn't say whether a Free user may *toggle* a Pro intent.

**Recommended resolution (not decided).** Store the toggle (preference ≠ entitlement). The DTO carries `entitled: false` so the UI shows "requires Pro".

**Existing documents that a ruling would amend.**

- [`entitlements-and-effective-access.md`](../../../project/feature-specification/subscription/entitlements-and-effective-access.md#preferences-always-survive) (product spec)
- [`../../notifications/cross-cutting/feature-flags-and-entitlements.md`](../../notifications/cross-cutting/feature-flags-and-entitlements.md#entitlements-are-not-preferences)

### IB-17 — Stale documents and leftovers

| | |
| --- | --- |
| **Status** | Open — not decided |
| **Kind** | DOCS |
| **Blocks** | None (hygiene) |

**Finding.** **Stale or leftover artifacts.** (a) The ADR and `verification-checklist.md` list "refactor `PortfolioPolicy` / add admin guard" as prerequisites; both landed in `c956336`. (b) The authorization audit in `docs/temp` is stale. (c) `next/src/types/auth-types.ts` holds an unused Stripe-shaped `interface Subscription`, a name collision. (d) The anomaly list in `entities.md` omits the "non-JSON signed body" / `MALFORMED` anomalies other pages raise. (e) `next/.env.example` has key ID and secret only.

**Recommended resolution (not decided).** Fix in S0: docs-only commit, plus deleting the dead interface in S4.

**Existing documents that a ruling would amend.**

- [`../../decisions/subscription-billing.md`](../../decisions/subscription-billing.md#what-it-depends-on) and [`../verification-checklist.md`](../verification-checklist.md#before-implementation-begins)
- [`docs/temp/kizunia-authorization-compressed-wind.md`](../../../temp/kizunia-authorization-compressed-wind.md)
- [`../../domain/subscription/entities.md`](../../domain/subscription/entities.md#billinganomaly)

## Withdrawn findings

### IB-8 — Launch enforcement for existing users

**Withdrawn 2026-09-24.** The blueprint's IB-8 asked what should happen to existing users when entitlement gates are switched on (their public portfolio, MCP access, deadline and recommendation notifications, and project creation above the Free quota), and offered three options: enable gates only together with LIVE checkout, bulk-grant or promote existing users, or add an explicit enforcement switch. It was listed as a production blocker for enabling any gate.

It no longer applies. Kizunia is pre-production, the database will be created fresh, there are currently zero users, and there is no legacy-user migration requirement, so there are no existing users to protect. None of the three options is needed, and no slice is gated on it. See [settled decisions](settled-decisions.md#decisions-applied-when-this-documentation-was-created).

## Open Razorpay items

These do **not** block V1 code: each has a defined fallback in the design. They gate **LIVE** readiness, and no webhook behavior has been verified at all (A6, A9); webhook verification is scheduled in slice S7 of the [implementation order](implementation-plan.md). The evidence and fallbacks are in the product register ([§A](../../../project/feature-specification/subscription/open-decisions.md#a-razorpay-behavior-requiring-test-mode-verification-or-support)) and in [Razorpay facts](../provider-boundary/razorpay-facts.md).

- **A3** scheduled-change webhooks
- **A4** UPI and e-mandate refusal shape
- **A6** event-ID header presence and stability across retries
- **A7** first post-trial charge failure
- **A10** the result of a mandate revocation
- **A11** e-mandate retry timing
- **A12** account rate limits
- **A15** Offers across upgrades (and the documented contradiction D11 about downgrading with an Offer)

Also unverified: that a Kizunia cycle-end cancel actually takes effect at `current_end` (the limitation recorded under A2), and all webhook delivery behavior.

## Open product questions

From the product register ([§B](../../../project/feature-specification/subscription/open-decisions.md#b-genuinely-open-product-questions)).

- **B1** plan changes for UPI, e-mandate and domestic-card subscriptions (highest impact)
- **B2** retention horizon for a long-halted subscription
- **B3** billing-record and raw-payload retention
- **B4** whether a banned user's subscription is cancelled
- **B5** self-serve undo of a cancellation
- **B6** pricing
- **B7** trial cooldown or re-trial policy
- **B8** MCP entitlement granularity
- **B9** ownership model for one-time purchases
- **B10** coupon stacking

Also open: the trial length. The product specification gives "30-day" only as an example.

## Open configuration values

The mechanisms are decided; only the values are open ([§C](../../../project/feature-specification/subscription/open-decisions.md#c-implementation-time-configuration)). See [configuration](configuration.md).

- **C1** outbound request budget and headroom per priority
- **C2** backoff and cooldown
- **C3** heartbeat intervals and checkpoint margins
- **C4** batch sizes
- **C5** checkout `expire_by` horizon and operation lease
- **C6** tick cadence per deployment

## Related documents

- [Settled decisions](settled-decisions.md) · [Index](README.md) · [Implementation order](implementation-plan.md)
- [Product open decisions](../../../project/feature-specification/subscription/open-decisions.md)
- [Decision register](../../../project/feature-specification/subscription/decisions/README.md)
