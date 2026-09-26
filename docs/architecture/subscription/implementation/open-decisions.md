# Open Decisions

> **Status:** Implementation plan — not implemented. **Decision close-out applied 2026-09-24.**
>
> **Last Updated:** 2026-09-24
>
> **Blueprint section:** implementation blockers and required decisions, and §21 B (see the [section map](README.md#blueprint-section-map))

This file is the register of the **IB findings**: every place where the design documents in [`docs/architecture/subscription/`](../README.md) and [`docs/project/feature-specification/subscription/`](../../../project/feature-specification/subscription/README.md) disagreed with the current code, or left something unresolved that an implementer would otherwise have decided inside the code.

On 2026-09-24 a decision close-out ruled every IB item. Each item now keeps its original **finding** and the blueprint's **recommended resolution** as history, and adds a **Ruling** block. The ruling says what was decided, who decided it, and which documents were amended. Rulings are copied into [settled decisions](settled-decisions.md#rulings-from-the-2026-09-24-decision-close-out), where they are listed by decision authority.

**The file name is kept** so existing links keep working. Most items are no longer open; the [summary](#summary) gives each item's current status.

## Status vocabulary

Every item in this file, and in the [implementation plan](../implementation-plan/README.md), carries exactly one of these statuses:

| Status | Means |
| --- | --- |
| **DECIDED** | Ruled. Implementation follows it. Changing it needs a new, recorded ruling |
| **DEFERRED** | Deliberately not decided for V1. The V1 fallback behavior is stated, as is the trigger that re-opens the item |
| **PROVIDER-DEPENDENT** | The architecture supports it, but the concrete behavior or UX depends on Razorpay behavior that has not been verified. It is not recorded as permanent until verified |
| **LIVE BLOCKER** | Does not block V1 code. Must be resolved before LIVE billing is switched on |
| **IMPLEMENTATION-TIME** | The mechanism is decided; the value or detail is chosen while coding, documented next to the code, and tuned in TEST mode |

## Decision authority

Every ruling records who made it. The two kinds are kept apart on purpose:

| Label | Means |
| --- | --- |
| **Product decision (owner)** | Decided by the project owner during the 2026-09-24 close-out. It is recorded as a `PRODUCT` ruling in the [decision register](../../../project/feature-specification/subscription/decisions/README.md) where it changes one |
| **Architecture/technical decision (autonomous)** | Derived during the close-out from the existing architecture, code and conventions, with a recorded rationale. It is recorded as an `ENGINEERING` ruling where it changes one. **The owner can override it**: overriding means writing a new ruling, not editing this one silently |

**Project status assumptions.** Kizunia is pre-production, the database will be created fresh, there are currently zero users, and there is no legacy-user migration requirement. Under these assumptions the former finding IB-8 is withdrawn; see [Withdrawn findings](#withdrawn-findings) and [settled decisions](settled-decisions.md#decisions-applied-when-this-documentation-was-created).

## Summary

| ID | Title | Kind | Status | Decided by | Affects phase |
| --- | --- | --- | --- | --- | --- |
| [IB-1](#ib-1--past_due-cancellation) | PAST_DUE cancellation | PRODUCT + ARCHITECTURE | DECIDED (immediate cancel) | Product decision (owner) | VI |
| [IB-2](#ib-2--recommendation-gate-point) | Recommendation gate point | ARCHITECTURE | DECIDED | Architecture (autonomous) | II |
| [IB-3](#ib-3--entitlement-resolver-signature) | Entitlement resolver signature | ARCHITECTURE | DECIDED | Architecture (autonomous) | I |
| [IB-4](#ib-4--portfolio-creation-gate) | Portfolio creation gate | ARCHITECTURE | DECIDED | Architecture (autonomous) | II |
| [IB-5](#ib-5--async-portfolio-public-eligibility) | Async portfolio public eligibility | ARCHITECTURE | DECIDED | Architecture (autonomous) | II |
| [IB-6](#ib-6--composed-commands-and-the-in-flight-constraint) | Composed commands and the in-flight constraint | ARCHITECTURE | DECIDED | Architecture (autonomous) | III, V |
| [IB-7](#ib-7--admin-bypass-of-entitlement-gates) | Admin bypass of entitlement gates | PRODUCT | DECIDED (interactive bypass only) | Product decision (owner) | II |
| [IB-9](#ib-9--trial-conversion-gap) | Trial conversion gap | PRODUCT + ARCHITECTURE | DECIDED (bounded; revisit on A7) | Architecture (autonomous) | VII |
| [IB-10](#ib-10--tick-time-budget) | Tick time budget | ARCHITECTURE | DECIDED (values IMPLEMENTATION-TIME) | Architecture (autonomous) | IV |
| [IB-11](#ib-11--alerting-channel) | Alerting channel | OPERATIONS | DEFERRED — LIVE BLOCKER | Architecture (autonomous) | IX |
| [IB-12](#ib-12--soft-deleted-projects-and-the-quota) | Soft-deleted projects and the quota | PRODUCT | DECIDED | Architecture (autonomous) | II |
| [IB-13](#ib-13--boot-time-mode-validation-and-expected-mode) | Boot-time mode validation and expected mode | CONFIG | DECIDED | Architecture (autonomous) | III |
| [IB-14](#ib-14--account-removal-storage) | Account-removal storage | ARCHITECTURE + B3 | Storage DECIDED; workflow DEFERRED | Architecture (autonomous) | I, III (storage) |
| [IB-15](#ib-15--billing-admin-roles) | Billing admin roles | PRODUCT | DECIDED | Product decision (owner) | I, VIII |
| [IB-16](#ib-16--preferences-for-non-entitled-intents) | Preferences for non-entitled intents | PRODUCT / UX | DECIDED | Architecture (autonomous) | II |
| [IB-17](#ib-17--stale-documents-and-leftovers) | Stale documents and leftovers | DOCS | DECIDED (docs fixed; code items in Phase III) | Architecture (autonomous) | III |
| [IB-18](#ib-18--upi-disabled-on-the-razorpay-test-account) | UPI disabled on the Razorpay TEST account (offered in TEST Checkout since 2026-09-25; not yet verified) | PROVIDER / OPERATIONS | PROVIDER-DEPENDENT — LIVE BLOCKER | — (external action) | V–VII verification, IX |
| [IB-19](#ib-19--tick-cadence-on-the-vercel-hobby-plan) | Tick cadence on the Vercel Hobby plan | OPERATIONS | DEFERRED — LIVE BLOCKER | Architecture (autonomous) | IX |
| [IB-20](#ib-20--a-public-test-webhook-endpoint) | A public TEST webhook endpoint | OPERATIONS | IMPLEMENTATION-TIME (blocks Phase IV verification) | Architecture (autonomous) | IV |
| [IB-21](#ib-21--plan-change-extensibility) | Plan-change extensibility | PRODUCT + ARCHITECTURE | DECIDED | Product decision (owner) + Architecture (autonomous) | VI |
| [IB-22](#ib-22--upi-recovery-ux) | UPI recovery UX | PRODUCT / UX | PROVIDER-DEPENDENT | Architecture (autonomous) capability; UX pending verification | VI |
| [IB-23](#ib-23--detecting-a-missing-provider-subscription) | Detecting a missing provider subscription | ARCHITECTURE | DECIDED (operation context) | Architecture (autonomous) | IV |
| [IB-24](#ib-24--phase-iv-implementation-rulings) | Phase IV implementation rulings | ARCHITECTURE | DECIDED | Architecture (autonomous) | IV |
| [IB-25](#ib-25--phase-v-implementation-rulings) | Phase V implementation rulings | ARCHITECTURE | DECIDED | Architecture (autonomous) | V |
| [IB-26](#ib-26--phase-vi-implementation-rulings) | Phase VI implementation rulings | ARCHITECTURE | DECIDED | Architecture (autonomous) | VI |
| [IB-27](#ib-27--phase-vii-decisions-and-implementation-rulings) | Phase VII decisions and implementation rulings (trial length 14 days; static Offer catalog behind a seam) | PRODUCT + ARCHITECTURE | DECIDED | Product decision (owner) + Architecture (autonomous) | VII |
| [IB-28](#ib-28--phase-viii-decisions-and-implementation-rulings) | Phase VIII decisions and implementation rulings (prune nulls; bulk re-sync marks due at P3; raw payloads SUPER_ADMIN-only; health contents) | ARCHITECTURE | DECIDED | Architecture (autonomous) | VIII |
| IB-8 | Launch enforcement for existing users | — | [Withdrawn](#withdrawn-findings) | — | — |

Phase numbers refer to the [phase-wise implementation plan](../implementation-plan/README.md).

## Decision map (2026-09-24 close-out)

The close-out sorted every open question into five classes. This is a record of how each was treated; the statuses in the summary above are authoritative.

| Class | Items |
| --- | --- |
| **A. Must decide before coding** (major rework if postponed) | IB-3, IB-6, IB-13, IB-14 (storage), IB-15, product B1 (plan changes; see [IB-21](#ib-21--plan-change-extensibility)) — all decided |
| **B. Decide before the specific phase** | IB-1 (VI), IB-2/4/5/7/12/16 (II), IB-9 (VII), IB-10 (IV) — all decided; trial length (before VII: **decided, 14 days**) and launch scope of trials/Offers/Promotions (before IX) remain for the owner |
| **C. Safe to decide during implementation** | C1–C7 configuration values; exact tick budgets (IB-10); Idempotency-Key format; migration file layout |
| **D. Safe to defer** | IB-11, IB-14 workflow, B2–B5, B7–B10, successor/switch plan changes (B1 successor flow) |
| **E. External provider unknowns** | IB-18, IB-22, A3, A4, A6, A7, A10, A11, A12, A15 — each classified in [Open Razorpay items](#open-razorpay-items) |

## Findings from comparing the design documents with the code

### IB-1 — PAST_DUE cancellation

| | |
| --- | --- |
| **Status** | **DECIDED** — 2026-09-24 |
| **Decided by** | Product decision (owner) |
| **Kind** | PRODUCT + ARCHITECTURE |
| **Affects** | Customer cancel for `PAST_DUE` (Phase VI) |

**Finding.** **PAST_DUE cycle-end cancellation is not verifiably effective.** The docs keep `cancel_at_cycle_end: true` for `PAST_DUE` (`lifecycle/cancellation.md`). TEST mode returned `200` with no observable effect (A1/D2). The operation model would record that `200` as `SUCCEEDED` and set `cancelAtPeriodEnd`, which contradicts "a `200` here is not evidence". The `CANCELLATION_NOT_EFFECTIVE` rule only covers "still `active` after `current_end`", not `PAST_DUE → HALTED`.

**Recommended resolution (blueprint, historical).** Ship customer cancel for `ACTIVE`/`TRIALING` first. Hold `PAST_DUE` behind this decision.

**Ruling (2026-09-24).** A customer cancellation of a `PAST_DUE` subscription is an **immediate** cancellation (`cancel_at_cycle_end: false`). Access ends when the cancellation is observed. The period whose charge failed was never paid, so nothing paid-for is lost. This is option A in [PAST_DUE cancellation](past-due-cancellation.md). Invariants I-1 to I-5 hold, **including** the I-4 (ii)/(iii) detection extensions (a `CHARGE` fact after the cancel request; `HALTED` with the flag set), which now protect `ACTIVE` cycle-end cancellations. UI copy says access ends now and no further charge will be made.

**Documents amended.** [SB-LC-04](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-04--cancellation-defaults-to-end-of-cycle) (second amendment), [`../lifecycle/cancellation.md`](../lifecycle/cancellation.md), [`../commands/operation-model.md`](../commands/operation-model.md), [PAST_DUE cancellation](past-due-cancellation.md), [command model](command-model.md).

### IB-2 — Recommendation gate point

| | |
| --- | --- |
| **Status** | **DECIDED** — 2026-09-24 |
| **Decided by** | Architecture/technical decision (autonomous) |
| **Kind** | ARCHITECTURE |
| **Affects** | Notification gating (Phase II) |

**Finding.** **The recommendation gate point in the docs does not exist as described.** `authorization-integration.md` gates `RecommendationController.generateForCurrentUser`, but that route is marked *TEMPORARY — MUST BE REMOVED BEFORE PRODUCTION* (`app/api/v1/me/recommendations/competitions/route.ts`). `module-boundaries.md` names `RecommendationService.generateForUser`, but that engine also powers **Pro** deadline notifications (`evaluate-registration-closing.handler.ts:106`). Gating the engine at Pro+ would break a Pro feature.

**Recommended resolution (blueprint, historical).** Gate the *product capability* at the `TOP_RELEVANT_COMPETITION` intent (scheduler predicate + `NotificationPolicyService` re-check), never the engine.

**Ruling (2026-09-24).** The recommendation **engine is never gated**. The product capabilities are gated at the notification **intent**:

| Product capability ([plans](../../../project/feature-specification/subscription/plans.md)) | Intent | Plans |
| --- | --- | --- |
| Competition deadline notifications | `REGISTRATION_CLOSING` | Pro, Pro+ |
| Competition recommendations | `TOP_RELEVANT_COMPETITION` | Pro+ |

The check sits in three places, all asking one set-based or per-user capability question of `lib/entitlements`:

1. the scheduler's eligible-user query (`findEnabledUserIds`);
2. the job handler / `NotificationPolicyService` re-check at evaluation time;
3. the delivery re-check at send time.

A failure produces the new suppression reason `NOT_ENTITLED`. The TEMPORARY development route stays ungated. Removing it before production is a [Phase IX](../implementation-plan/phase-IX/README.md) checklist item.

**Why.** The code already treats intents as the unit of notification eligibility (preferences, audience gating, suppression reasons). The engine is shared infrastructure, so gating it would couple a Pro feature to a Pro+ capability.

**Documents amended.** [`../entitlements/authorization-integration.md`](../entitlements/authorization-integration.md#recommendation-route), [`../module-boundaries.md`](../module-boundaries.md), [`../../notifications/cross-cutting/feature-flags-and-entitlements.md`](../../notifications/cross-cutting/feature-flags-and-entitlements.md), [feature integration](feature-integration.md).

### IB-3 — Entitlement resolver signature

| | |
| --- | --- |
| **Status** | **DECIDED** — 2026-09-24 |
| **Decided by** | Architecture/technical decision (autonomous) |
| **Kind** | ARCHITECTURE |
| **Affects** | Phase I |

**Finding.** **`resolveEntitlements()` cannot change "body only".** It is synchronous and takes no user (`lib/entitlements/index.ts:32`). Its one caller, `RateLimitService.decide` (`lib/rate-limit/service.ts:90`), passes nothing. A per-user, database-backed resolver needs a new async signature. Wiring it into rate limiting adds two queries to every rate-limited request.

**Recommended resolution (blueprint, historical).** Add a new async `resolveEntitlements(userId)`. Keep rate limiting on the registry default until a plan-tier override is actually configured.

**Ruling (2026-09-24).** `lib/entitlements` gains a new **async, per-user** effective-access API: resolve effective access for a user, capability and quota questions, the set-based predicate for background queries, and an explain function. The existing synchronous, argument-less `resolveEntitlements()` is **kept** as the rate-limit registry's tier input and continues to return the default tier. **Rate limiting is unchanged in V1.** Plan-tier rate limits are wired to the per-user API only when a plan-tier override is actually configured. Exact function names are IMPLEMENTATION-TIME.

**Why.** It keeps the per-request cost of rate limiting at zero and still gives every feature one read-side seam.

**Documents amended.** [`../entitlements/quotas-vs-rate-limits.md`](../entitlements/quotas-vs-rate-limits.md#rate-limiting), [`../entitlements/effective-access-resolution.md`](../entitlements/effective-access-resolution.md#what-changes-when-this-ships), [`../README.md`](../README.md#environment-facts-this-design-must-respect).

### IB-4 — Portfolio creation gate

| | |
| --- | --- |
| **Status** | **DECIDED** — 2026-09-24 |
| **Decided by** | Architecture/technical decision (autonomous) |
| **Kind** | ARCHITECTURE |
| **Affects** | Portfolio create gate (Phase II) |

**Finding.** **`CREATE_PORTFOLIO` cannot be gated by "changing only `PlatformPermissionSet` data".** The set is a static `role → actions` map. `PlatformContext` carries only the actor. The authorization conventions forbid dynamic permission sets (`conventions.md:369-379`).

**Recommended resolution (blueprint, historical).** Keep `CREATE_PORTFOLIO` in `BASELINE`, and add an entitlement `.require(…, UPGRADE_REQUIRED)` step to `PortfolioPolicy`'s create chain.

**Ruling (2026-09-24).** `CREATE_PORTFOLIO` stays in `BASELINE` and means "this role may create portfolios". `PortfolioPolicy`'s create chain gains:

1. `.platformOverride()` ([IB-7](#ib-7--admin-bypass-of-entitlement-gates));
2. `.require(actor may create a portfolio, UPGRADE_REQUIRED)`, using the actor's effective access carried in `PortfolioContext`.

The context resolver computes that effective access asynchronously before building the context.

**Documents amended.** [`../entitlements/authorization-integration.md`](../entitlements/authorization-integration.md#create_portfolio-baseline-grant).

### IB-5 — Async portfolio public eligibility

| | |
| --- | --- |
| **Status** | **DECIDED** — 2026-09-24 |
| **Decided by** | Architecture/technical decision (autonomous) |
| **Kind** | ARCHITECTURE |
| **Affects** | Portfolio public gate (Phase II) |

**Finding.** **Portfolio public eligibility is synchronous.** `resolvePortfolioPublicEligibility()` is called from the synchronous `PortfolioContextResolver.fromData`/`forPublicRead` (`context-resolver.ts:94`). An entitlement read is async I/O.

**Recommended resolution (blueprint, historical).** Make the resolver step async: compute eligibility before `fromData` and pass it in.

**Ruling (2026-09-24).** As recommended:

- Public eligibility becomes an async lookup of the **owner's** effective access, computed before `fromData`/`forPublicRead` and passed in.
- `PortfolioPolicy` keeps its shape: non-owner viewers still see the second, independent gate after `visibility`.
- Owners always see their own portfolio.
- The design documents' "no signature change" claim is corrected.

**Documents amended.** [`../entitlements/authorization-integration.md`](../entitlements/authorization-integration.md#portfolio-public-eligibility), [SB-DP-03](../../../project/feature-specification/subscription/decisions/data-preservation.md#sb-dp-03--portfolio-public-eligibility-is-a-second-independent-gate-alongside-visibility).

### IB-6 — Composed commands and the in-flight constraint

| | |
| --- | --- |
| **Status** | **DECIDED** — 2026-09-24 |
| **Decided by** | Architecture/technical decision (autonomous) |
| **Kind** | ARCHITECTURE |
| **Affects** | Schema (Phase III), command runner (Phase V), supersession and plan change (Phase VI) |

**Finding.** **"One `IN_FLIGHT` per user" as literally specified blocks composed commands.** Parent and child `BillingOperation`s would both be `IN_FLIGHT`. The docs also don't say how a composed command *continues* when sync confirmation is not immediate (supersession, abandon-then-recreate).

**Recommended resolution (blueprint, historical).** Apply the partial unique index only to root operations; children run under the root's slot.

**Ruling (2026-09-24).**

1. **Root-only slot.** The per-user uniqueness is a partial unique index on `billing_operation(userId) WHERE status = 'IN_FLIGHT' AND "parentOperationId" IS NULL`. Children run sequentially under their root's slot. A failed child stops the root.
2. **No hidden continuation.** A step that needs "confirmed by sync" does one targeted, priority-1 sync inside the request. If the confirmation is not visible yet, the root ends having completed only the steps it confirmed and returns `CONFIRMING`. The user's next request, with a new idempotency key, re-evaluates preconditions from local state. No background process continues a command ([SB-RC-10](../../../project/feature-specification/subscription/decisions/reconciliation.md#sb-rc-10--synchronization-only-reads-it-never-changes-provider-state) is unchanged).
3. **Admin commands take the same per-user slot** as customer commands. An admin command on a user who has an operation in flight gets `409 BILLING_OPERATION_IN_PROGRESS`.
4. **Idempotency.** Mutating billing endpoints require an `Idempotency-Key` header, unique per user (`(userId, idempotencyKey)`). This is a new convention: the app has no idempotency header today. The key format is IMPLEMENTATION-TIME.

**Documents amended.** [`../commands/operation-model.md`](../commands/operation-model.md), [`../lifecycle/multiple-subscriptions.md`](../lifecycle/multiple-subscriptions.md#supersession), [`../../domain/subscription/relationships.md`](../../domain/subscription/relationships.md), [command model](command-model.md), [database design](database-design.md).

### IB-7 — Admin bypass of entitlement gates

| | |
| --- | --- |
| **Status** | **DECIDED** — 2026-09-24 |
| **Decided by** | Product decision (owner) |
| **Kind** | PRODUCT |
| **Affects** | All gates (Phase II) |

**Finding.** **Admin bypass of entitlement gates is only half specified.** The spec says admins bypass feature gates via `platformOverride()` (`entitlements-and-effective-access.md`). `PlatformPolicy` has no `platformOverride`, and background jobs have no actor at all. Admins also use MCP today.

**Recommended resolution (blueprint, historical).** Interactive gates use `.platformOverride()`; background eligibility has no bypass.

**Ruling (2026-09-24).** **Interactive bypass only.**

- Gates an actor hits directly in a request use the existing `.platformOverride()`: the owned-project quota, portfolio creation and MCP tool access. That override is true for `ADMIN` and `SUPER_ADMIN` (`PlatformAccess.canBypassAuthorization`), not `MODERATOR`.
- **Background eligibility has no bypass**: deadline and recommendation notifications have no actor. An admin who wants those notifications gets an explicit admin grant from another administrator; self-grants remain forbidden ([SB-EA-08](../../../project/feature-specification/subscription/decisions/effective-access-and-grants.md#sb-ea-08--administrators-cannot-grant-access-to-themselves)).
- Public portfolio display follows the **owner's effective access**, never their role.
- An admin's own effective access (as a customer) is shown unchanged. The bypass is never reported as a plan.

**Documents amended.** [SB-EA-04](../../../project/feature-specification/subscription/decisions/effective-access-and-grants.md#sb-ea-04--admin-platform-role-bypass-is-not-an-entitlement-source) (amended), [`entitlements-and-effective-access.md`](../../../project/feature-specification/subscription/entitlements-and-effective-access.md#admin-access-is-not-a-subscription-tier), [`../entitlements/authorization-integration.md`](../entitlements/authorization-integration.md).

### IB-9 — Trial conversion gap

| | |
| --- | --- |
| **Status** | **DECIDED** — 2026-09-24 (revisit when A7 is resolved) |
| **Decided by** | Architecture/technical decision (autonomous) |
| **Kind** | PRODUCT + ARCHITECTURE |
| **Affects** | Trials (Phase VII) |

**Finding.** **Trial conversion gap.** The mapping sends `authenticated` + `kind TRIAL` + `start_at` **passed** to `PENDING_AUTHENTICATION`, which does not contribute. The `start_at` checkpoint sync is timed exactly for that window. TEST showed `authenticated` persisting 47 minutes after `start_at` (A7). A converting trial user would lose access until Razorpay reports `active`.

**Recommended resolution (blueprint, historical).** Keep `TRIALING` for a `TRIAL` subscription that is still `authenticated` after `start_at`, until Razorpay reports `active`/`pending`/`halted`/`cancelled`.

**Ruling (2026-09-24).**

- A `TRIAL` subscription still reported `authenticated` after `start_at` stays `TRIALING` (contributing) until Razorpay reports any other status.
- This is **bounded by a trial-conversion grace** (new configuration value **C7**, IMPLEMENTATION-TIME; default of the order of Razorpay's documented card/UPI retry window).
- Past `start_at` + C7, the subscription maps to `PENDING_AUTHENTICATION` (non-contributing), a `TRIAL_CONVERSION_OVERDUE` anomaly is raised, and an alert is emitted.
- Access still follows only observations plus this explicit bound. It is never extended on the strength of a request.

**Why.** A converting trial user should not lose access while Razorpay is slow to run the first charge, but an unbounded rule would give free access indefinitely if the first charge never runs.

**Documents amended.** [`../lifecycle/state-mapping.md`](../lifecycle/state-mapping.md#the-mapping), [`../lifecycle/trials.md`](../lifecycle/trials.md#conversion-is-not-a-separate-code-path), [SB-LC-10](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-10--subscription-kind-is-recorded-at-creation-never-inferred) (note), [state model](state-model.md), [configuration](configuration.md).

### IB-10 — Tick time budget

| | |
| --- | --- |
| **Status** | **DECIDED** — 2026-09-24 (exact values IMPLEMENTATION-TIME) |
| **Decided by** | Architecture/technical decision (autonomous) |
| **Kind** | ARCHITECTURE |
| **Affects** | Phase IV |

**Finding.** **Tick time budget.** The tick has `maxDuration = 60` and runs tasks sequentially. `notifications:tick` gets a 45 s drain budget (`JOB_CONFIG.wallClockBudgetMs`). A billing task registered after it gets at most about 15 s, less the other tasks.

**Recommended resolution (blueprint, historical).** Register `billing:sync` **before** `notifications:tick`, with its own budget (about 10–12 s). Lower the notification default so the sum stays under 60 s with teardown headroom.

**Ruling (2026-09-24).** As recommended:

- `billing:sync` is registered **before** `notifications:tick` and has its own wall-clock budget, of the order of 10–12 s.
- The notification drain default is lowered so the total, plus the other tasks and teardown headroom, stays under `maxDuration`.
- Orphan discovery and payload pruning are separate, low-frequency tasks.
- Exact values are IMPLEMENTATION-TIME and documented in the tick route and in [`../../workflows/internal-jobs.md`](../../workflows/internal-jobs.md).

**Documents amended.** [`../reconciliation/reconciliation-job.md`](../reconciliation/reconciliation-job.md#the-billing-sync-tick-task), [`../../workflows/internal-jobs.md`](../../workflows/internal-jobs.md#the-tick-one-cron-entry-many-tasks).

### IB-11 — Alerting channel

| | |
| --- | --- |
| **Status** | **DEFERRED — LIVE BLOCKER** |
| **Decided by** | Architecture/technical decision (autonomous) |
| **Kind** | OPERATIONS |
| **Affects** | LIVE readiness (Phase IX), not V1 code |

**Finding.** **No alerting channel exists.** The docs require "page"/High alerts. The repo has only structured `console` logs, no metrics and no pager.

**Ruling (2026-09-24).** From Phase IV onward, every alert condition emits one structured `billing.alert` log event: the `[billing] {json}` sibling of the notifications log. The **delivery channel** (Vercel log-drain alert, e-mail, or an in-app admin notice) is chosen in Phase IX and must exist before LIVE billing is enabled.

**Documents amended.** [`../cross-cutting/observability.md`](../cross-cutting/observability.md#alerting), [`../cross-cutting/operations-runbook.md`](../cross-cutting/operations-runbook.md).

### IB-12 — Soft-deleted projects and the quota

| | |
| --- | --- |
| **Status** | **DECIDED** — 2026-09-24 |
| **Decided by** | Architecture/technical decision (autonomous) |
| **Kind** | PRODUCT |
| **Affects** | Project quota (Phase II) |

**Finding.** **Owned-project quota and soft delete.** Projects soft-delete (`Project.deletedAt`) and keep their `OWNER` row. The docs count `ProjectMember.role = OWNER` only. `ProjectMember` has no `userId` index.

**Recommended resolution (blueprint, historical).** Count only `deletedAt IS NULL` projects, so deleting a project frees a slot. Add `@@index([userId, role])`.

**Ruling (2026-09-24).**

1. **What counts.** The owned-project quota counts `ProjectMember.role = OWNER` rows whose project has `deletedAt IS NULL`, so deleting a project frees a slot. This matches the documented "until the owned count is back at or under the quota".
2. **Future paths re-check the quota.** Any future path that brings a project back into the count must check the quota first. No such path exists today: there is no restore and no ownership transfer in `modules/projects`.
3. **Index.** Add `ProjectMember @@index([userId, role])`.
4. **Race control.** Concurrent creates by the same user are serialized with a transaction-scoped, per-user `pg_advisory_xact_lock` taken inside `ProjectService.create`'s existing transaction, before the count. This is the first advisory lock in the repository and is documented as a pattern. The existing `FOR UPDATE` row-lock pattern does not fit, because there is no per-user row the projects module owns to lock.

**Why this is not a product question.** The alternative, counting deleted projects, would make deletion useless for freeing a slot with no restore path to compensate. It contradicts the documented quota semantics.

**Documents amended.** [`../entitlements/quotas-vs-rate-limits.md`](../entitlements/quotas-vs-rate-limits.md#project-ownership-quota), [SB-PL-03](../../../project/feature-specification/subscription/decisions/plans-and-quotas.md#sb-pl-03--project-quotas-count-ownership-only) (amended).

### IB-13 — Boot-time mode validation and expected mode

| | |
| --- | --- |
| **Status** | **DECIDED** — 2026-09-24 |
| **Decided by** | Architecture/technical decision (autonomous) |
| **Kind** | CONFIG |
| **Affects** | Phase III |

**Finding.** **Mode resolution "once, at boot, fail fast" has no home.** There is no env-validation module and no `instrumentation.ts`. The "expected billing mode" has no configured source.

**Ruling (2026-09-24).**

- Billing configuration is validated in `src/instrumentation.ts` `register()` at server start.
- A new, optional `BILLING_EXPECTED_MODE` (`test` | `live`) sets the expected mode explicitly. When it is absent: `live` if `VERCEL_ENV=production`, otherwise `test`.
- Missing Razorpay credentials resolve to `disabled`, a supported state.
- An unrecognized key format, or a resolved mode that is neither `disabled` nor equal to the expected mode, **fails fast at boot**, as [SB-PB-02](../../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-02--provider-mode-is-resolved-once-at-boot) requires.
- `.env.example` documents every billing variable (Phase III).

**Documents amended.** [`../provider-availability/environments.md`](../provider-availability/environments.md#resolution-once-at-boot), [configuration](configuration.md).

### IB-14 — Account-removal storage

| | |
| --- | --- |
| **Status** | Storage **DECIDED**; removal workflow **DEFERRED** |
| **Decided by** | Architecture/technical decision (autonomous) |
| **Kind** | ARCHITECTURE + B3 |
| **Affects** | Grant schema (Phase I), billing schema (Phase III) |

**Finding.** **Account removal storage.** No removal flow exists, but the Better Auth `admin()` plugin exposes `/api/auth/admin/remove-user`. The docs require "no cascade" plus pseudonymization, but leave storage open. Retention is B3.

**Ruling (2026-09-24).**

1. **Storage (DECIDED).** Every billing and entitlement table that references a user does so through a **nullable** `userId` FK with `onDelete: Restrict`, plus a `subjectPseudonym` column. This covers the grant tables in Phase I and the billing tables in Phase III and VII. Actor columns (who granted, who performed) are plain strings, not FKs. A hard delete of a user who has billing or grant rows is therefore refused by the database, never cascaded.
2. **Workflow (DEFERRED).** The pseudonymization workflow (refuse while any Subscription is open; otherwise null `userId`, stamp the pseudonym and remove the user in one transaction) is **deferred until the platform has an account-deletion feature**. None exists today: there is no deletion route or hook, only Better Auth's admin `remove-user`. Until then, a `remove-user` on such a user fails safely, and the [runbook](../cross-cutting/operations-runbook.md) says so.
3. **Retention (B3)** stays open and blocks only the deferred workflow.

**Documents amended.** [`../../domain/subscription/relationships.md`](../../domain/subscription/relationships.md#storage-is-an-implementation-phase-decision), [SB-DP-04](../../../project/feature-specification/subscription/decisions/data-preservation.md#sb-dp-04--billing-records-survive-account-removal) (amended), [database design](database-design.md).

### IB-15 — Billing admin roles

| | |
| --- | --- |
| **Status** | **DECIDED** — 2026-09-24 |
| **Decided by** | Product decision (owner) |
| **Kind** | PRODUCT |
| **Affects** | Phase I (grants), Phase VIII (billing tools) |

**Finding.** **Billing admin roles are unassigned.** The docs require explicit billing actions (`MANAGE_ENTITLEMENT_GRANTS`, billing-read, billing-manage) but never say which `PlatformRole`s hold them.

**Ruling (2026-09-24).**

| Platform action | `SUPER_ADMIN` | `ADMIN` | `MODERATOR` | `USER` |
| --- | --- | --- | --- | --- |
| `MANAGE_ENTITLEMENT_GRANTS` (create, extend, revoke grants) | yes | — | — | — |
| `MANAGE_BILLING` (admin immediate cancel, anomaly resolution, bulk re-sync) | yes | — | — | — |
| `VIEW_BILLING` (billing views, explain, timeline, anomalies list, and **"sync now"**, which only reads from Razorpay) | yes | yes | — | — |
| View raw webhook payloads | yes | — | — | — |

Self-grants remain refused for every role. Exact action names are IMPLEMENTATION-TIME.

**Documents amended.** [`../entitlements/admin-grants.md`](../entitlements/admin-grants.md#authorization-for-granting), [`../cross-cutting/security.md`](../cross-cutting/security.md#authorization-boundaries), [admin grants](admin-grants.md).

### IB-16 — Preferences for non-entitled intents

| | |
| --- | --- |
| **Status** | **DECIDED** — 2026-09-24 |
| **Decided by** | Architecture/technical decision (autonomous) |
| **Kind** | PRODUCT / UX |
| **Affects** | Preferences API and UI (Phase II) |

**Finding.** **Preferences for intents the user is not entitled to.** Data preservation keeps preferences across downgrades. The notification entitlement doc says an entitlement's "absence means cannot be enabled". The spec doesn't say whether a Free user may *toggle* a Pro intent.

**Ruling (2026-09-24).**

- A preference is not an entitlement, so the toggle is **always stored**, whatever the user's plan.
- The preferences DTO carries a server-computed `entitled` flag per intent, and the UI shows "requires Pro / Pro+" next to an intent the user is not entitled to.
- Delivery is gated only by entitlement ([IB-2](#ib-2--recommendation-gate-point)).
- A user who upgrades gets the notifications they had already switched on, with no second step.

**Why.** It follows from the settled rule that preferences survive downgrades ([SB-DP-01](../../../project/feature-specification/subscription/decisions/data-preservation.md#sb-dp-01--downgrade-never-deletes-projects-portfolios-or-preferences)). Refusing the toggle would make a preference depend on entitlement in one direction but not the other.

**Documents amended.** [`entitlements-and-effective-access.md`](../../../project/feature-specification/subscription/entitlements-and-effective-access.md#preferences-always-survive), [`../../notifications/cross-cutting/feature-flags-and-entitlements.md`](../../notifications/cross-cutting/feature-flags-and-entitlements.md#entitlements-are-not-preferences).

### IB-17 — Stale documents and leftovers

| | |
| --- | --- |
| **Status** | **DECIDED** — docs items fixed 2026-09-24; code items assigned to Phase III |
| **Decided by** | Architecture/technical decision (autonomous) |
| **Kind** | DOCS |
| **Affects** | None (hygiene) |

**Finding.** **Stale or leftover artifacts.**

- (a) The ADR and `verification-checklist.md` list "refactor `PortfolioPolicy` / add admin guard" as prerequisites; both landed in `c956336`.
- (b) The authorization audit in `docs/temp` is stale.
- (c) `next/src/types/auth-types.ts` holds an unused Stripe-shaped `interface Subscription`, a name collision.
- (d) The anomaly list in `entities.md` omits the "non-JSON signed body" / `MALFORMED` anomalies other pages raise.
- (e) `next/.env.example` has key ID and secret only.

**Ruling (2026-09-24).** Items (a), (b) and (d) were fixed in the close-out documentation pass:

- (a) the prerequisites are marked done;
- (b) the temp audit carries a stale banner;
- (d) `MALFORMED` is recorded as alert-only, not an anomaly row, and `entities.md` says so.

Items (c) and (e) are code changes, assigned to [Phase III](../implementation-plan/phase-III/README.md).

### IB-18 — UPI disabled on the Razorpay TEST account

| | |
| --- | --- |
| **Status** | **PROVIDER-DEPENDENT — LIVE BLOCKER** (opened 2026-09-24) |
| **Decided by** | — (external action: Razorpay Support) |
| **Kind** | PROVIDER / OPERATIONS |
| **Affects** | UPI verification in Phases V–VII; UPI launch (Phase IX) |

**Finding.** UPI is a **day-one payment method**, but on 2026-09-24 the Kizunia Razorpay TEST account reported UPI disabled for Subscriptions. Checkout preferences returned `subscription.upi=false`, `methods.upi=false`, and recurring methods of card/e-mandate/NACH only. Razorpay's FAQ labels UPI for Subscriptions "early access", enabled through Support (another FAQ entry points to Dashboard settings). Consequently **no UPI behavior in this design has been observed**; every UPI statement rests on Razorpay's documentation.

**Ruling.** This blocks no architecture and no phase's code: the design is method-agnostic and classifies provider refusals by code. It blocks **verification** of the UPI paths (checkout, cancellation, supersession, recovery, trials) and therefore a UPI launch.

**Action for the owner:** ask Razorpay Support to enable UPI for Subscriptions on the TEST and LIVE accounts, early, because of the lead time.

The UPI behaviors to verify once it is enabled are listed as product open item [A16](../../../project/feature-specification/subscription/open-decisions.md#a-razorpay-behavior-requiring-test-mode-verification-or-support).

**Update (2026-09-25, Phase V).** UPI now appears as a payment option in Razorpay Checkout for a Kizunia TEST subscription (seen by the owner during the Phase V card checkout; [Razorpay facts](../provider-boundary/razorpay-facts.md#phase-v-checkout-run-2026-09-25)). No UPI subscription has been completed yet, so the A16 behaviors are still unverified and the status is unchanged: verification is now *possible*, not done. The next step is a UPI checkout in TEST.

### IB-19 — Tick cadence on the Vercel Hobby plan

| | |
| --- | --- |
| **Status** | **DEFERRED — LIVE BLOCKER** (opened 2026-09-24) |
| **Decided by** | Architecture/technical decision (autonomous) |
| **Kind** | OPERATIONS |
| **Affects** | Phase IX |

**Finding.** The internal tick is triggered by one Vercel cron entry that runs **daily** (`next/vercel.json`, `0 13 * * *`), the Hobby plan's limit. The billing design targets a cadence of about 5 minutes, with 15 minutes as the upper bound (C6), and already stays *correct* on a daily trigger ([SB-PB-06](../../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-06--billing-execution-is-scheduler-agnostic)). A daily cadence, however, delays checkpoint-driven observations (a missed webhook, a scheduled change, `expire_by`) by up to a day.

**Ruling.** Development and TEST work on the daily cron plus manual runs. Before LIVE, the deployment must reach the C6 target through an **external pinger** calling the same authenticated tick URL (the pattern the [internal-jobs convention](../../workflows/internal-jobs.md) already accepts) or through a Vercel plan with finer cron. Which of the two is an owner/operations choice made in Phase IX.

### IB-20 — A public TEST webhook endpoint

| | |
| --- | --- |
| **Status** | **DONE** for TEST (2026-09-25): an ngrok tunnel to the local dev server was registered in the TEST Dashboard and A6 verified through it. A stable hosted URL is still needed before a hosted TEST or LIVE deployment |
| **Decided by** | Architecture/technical decision (autonomous) |
| **Kind** | OPERATIONS |
| **Affects** | Phase IV |

**Finding.** Razorpay webhooks can only be registered in the Dashboard, against a public HTTPS URL, and no webhook behavior has ever been observed (A6, A9). Vercel preview URLs change per deployment and may sit behind deployment protection.

**Ruling.** Phase IV provides a **stable** TEST webhook URL: a stable preview alias or staging domain, with deployment protection bypassed for the webhook path only. It is registered in the TEST Dashboard, and A6 (event-ID header presence and stability) is verified against it. Which hosting route is used is an implementation detail.

### IB-21 — Plan-change extensibility

| | |
| --- | --- |
| **Status** | **DECIDED** — 2026-09-24 |
| **Decided by** | Product decision (owner) for the behavior; Architecture/technical decision (autonomous) for the seam |
| **Kind** | PRODUCT + ARCHITECTURE |
| **Affects** | Phase VI |

**Finding.** With UPI as a day-one payment method, Razorpay's refusal to update UPI, e-mandate and domestic-card subscriptions ([R-06](../../../project/feature-specification/subscription/decisions/reconciliations.md#r-06--the-update-api-does-not-support-plan-changes-for-most-indian-payment-methods)) means native paid→paid plan changes are available in practice only to international-card subscriptions. Product question [B1](../../../project/feature-specification/subscription/open-decisions.md#b-resolved) asked whether V1 should build a successor/switch flow.

**Ruling (2026-09-24).**

*Product decision (owner):*

- [SB-LC-07](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-07--razorpay-decides-whether-a-plan-change-is-possible) is **kept** for V1. Plan changes use Razorpay's native Update where Razorpay supports it.
- For UPI, e-mandate and domestic-card subscriptions, paid→paid changes are an explicit V1 limitation: cancel at cycle end, keep access to period end, then buy the new plan.
- A switch/successor flow is DEFERRED.
- The plan-change domain, command and provider boundary **must allow that flow to be added later without restructuring**.

*Architecture decision (autonomous), how extensibility is guaranteed:*

1. `ChangePlan` is one root command. It selects a **strategy** through one pure policy function: `NATIVE_UPDATE` or `UNAVAILABLE` in V1. A later `SWITCH` strategy is an additional branch with its own child operations; callers and the runner do not change.
2. The rule "Kizunia never creates a second open subscription" is evaluated in **one** precondition policy. A later relaxation ("…unless the other is retiring and linked") is a change to that function alone.
3. The successor link already exists: `Subscription.supersededById`. A later replacement *reason* (supersession vs switch) is an additive column or enum; nothing is added in V1.
4. The provider boundary already exposes everything a switch would need: create (with optional `startAt`), cancel at cycle end or immediately, update, and cancel scheduled change.
5. `BillingOperationKind` keeps `CHANGE_PLAN` as the root kind, so a switch's children (`CANCEL_AT_CYCLE_END`, `CREATE_SUBSCRIPTION`) are existing kinds.

**Documents amended.** [SB-LC-07](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-07--razorpay-decides-whether-a-plan-change-is-possible) (reaffirmed), [`../lifecycle/upgrade-downgrade.md`](../lifecycle/upgrade-downgrade.md#extensibility-a-later-switch-flow), [command model](command-model.md), product [open decisions](../../../project/feature-specification/subscription/open-decisions.md#b-resolved) (B1).

### IB-22 — UPI recovery UX

| | |
| --- | --- |
| **Status** | **PROVIDER-DEPENDENT** (opened 2026-09-24) |
| **Decided by** | Architecture/technical decision (autonomous) for the capability; the UX waits for UPI verification |
| **Kind** | PRODUCT / UX |
| **Affects** | Phase VI; LIVE blocker for a UPI launch |

**Finding.** Razorpay documents that a UPI or e-mandate subscription "can switch only to a card" to recover from `halted`, and that only the customer can resume a subscription they paused from their UPI app. None of this has been observed (IB-18).

**Ruling.**

- *Decided (architecture):* the architecture supports **both** recovery routes for a `HALTED` or customer-paused UPI subscription:
  - supersession, a new subscription after a confirmed immediate cancel, already decided in [SB-UQ-04](../../../project/feature-specification/subscription/decisions/uniqueness-and-resubscription.md#sb-uq-04--a-halted-or-paused-subscription-is-superseded-only-by-a-confirmed-cancellation);
  - Razorpay's own payment-method change, which Kizunia only opens and then observes.
- *Provider-dependent (not decided):*
  - whether a UPI subscription can actually be recovered by switching to a card;
  - what a customer-paused UPI subscription looks like when fetched;
  - consequently, which option(s) the UI offers to a UPI subscriber, and in what order.
- The UX is settled after the UPI verification in Phase VI. Until then no document records it as permanent.

**Update (2026-09-26, Phase VI).** Both routes are built: the recovery entry point (Razorpay's payment-method change, then "check now") and supersession. The UI offers recovery first, then supersession, for every payment method ([IB-26](#ib-26--phase-vi-implementation-rulings) item 10). No UPI subscription has been authenticated in TEST yet, so the A16 (c)–(f) observations are not made, the status is unchanged (**PROVIDER-DEPENDENT**), and a UPI launch stays blocked. The scenarios to run are U1–U4 in the [Phase VI runbook](../implementation-plan/phase-VI/manual-test.md#upi-a16-cf-ib-18-ib-22).

### IB-23 — Detecting a missing provider subscription

| | |
| --- | --- |
| **Status** | **DECIDED** — 2026-09-25 |
| **Decided by** | Architecture/technical decision (autonomous) |
| **Kind** | ARCHITECTURE |
| **Affects** | Phase IV (sync) |

**Finding.** The design keyed `PROVIDER_SUBSCRIPTION_MISSING` and `PROVIDER_MODE_MISMATCH` on the `NOT_FOUND` class (a `404`). The Phase III contract suite observed that Razorpay answers a **well-formed** unknown subscription ID with `400 BAD_REQUEST_ERROR`, which classifies as `REJECTED`, and gives a `404` only for a malformed ID (D12 in [Razorpay facts](../provider-boundary/razorpay-facts.md#documentation-vs-observed-behavior)). The two options were **operation context** and a second documented description-match exception.

**Ruling (2026-09-25): operation context.**

1. In the **sync fetch path only**, a `fetchSubscription` of a provider ID Kizunia **stored** that fails as `REJECTED` **or** `NOT_FOUND` means the provider does not recognize that ID under the current credentials. It raises `PROVIDER_SUBSCRIPTION_MISSING` (subject `psub:<id>`, alert HIGH).
2. Local phase, plan and access are unchanged ([SB-RC-07](../../../project/feature-specification/subscription/decisions/reconciliation.md#sb-rc-07--provider-failures-back-off-and-never-change-local-state)). `lastSyncFailureClass` records the real class. The row keeps its ordinary capped backoff and is never marked permanently failed.
3. A later successful apply resolves the open anomaly automatically, since the observation proves it stale.
4. Classification is **unchanged**: status and code only, with `CONCURRENT_OPERATION` still the single description match. The interpretation lives in one pure function, `policy/sync-failure.ts`, because only the caller knows the operation.
5. `PROVIDER_MODE_MISMATCH` is **never** inferred from a fetch failure. It is detected locally: a targeted sync of a row whose `providerMode` differs from the resolved mode (the batch claim already filters by mode), or a fetched entity whose `notes.kz_env` differs. So a `REJECTED` fetch of a same-mode row can only mean "missing".
6. Mutations never use this interpretation: a `REJECTED` command is a refusal.

**Why.** A GET of a stored ID has no business refusal: the only observed or documented `400` for it is "unknown ID", and Kizunia stores only IDs Razorpay issued (so never a malformed one). Matching the description would break the D8/D10 rule for a string that is itself undocumented and ambiguous ("invalid or could not be found"). The anomaly is a signal for a human and changes nothing, so a false positive costs an alert, never access.

**Documents amended.** [Razorpay facts](../provider-boundary/razorpay-facts.md#documentation-vs-observed-behavior) (D12), [provider rate limits](../reconciliation/provider-rate-limits.md#provider-failure-taxonomy), [provider boundary](provider-boundary.md), [synchronization](synchronization.md), [failure and recovery matrix](failure-recovery-matrix.md).

### IB-24 — Phase IV implementation rulings

| | |
| --- | --- |
| **Status** | **DECIDED** — 2026-09-25 |
| **Decided by** | Architecture/technical decision (autonomous), except item 13's prices (owner) |
| **Kind** | ARCHITECTURE |
| **Affects** | Phase IV |

Places where the Phase IV design left a detail open, ruled before the code relied on them:

1. **A terminal-out transition gets its own anomaly type**, `TERMINAL_STATE_CONTRADICTED`, added by its own `ALTER TYPE … ADD VALUE` migration. The acceptance test needs a row, and no existing type fits.
2. **`parseWebhookEvent` is on the `BillingProvider` interface**, implemented under `provider/razorpay/` (the ESLint boundary forbids `backend/` from reading Razorpay payload shapes). It returns a Kizunia-typed event or `MALFORMED`. Parsing is not network, so it has no budget and no `Outcome`.
3. **Event and money-fact dedupe use `INSERT … ON CONFLICT DO NOTHING`**, not a caught `P2002`: a failed statement aborts the Postgres transaction the event must be recorded in.
4. **`billing:sync` also drains `UNMATCHED_PENDING` events.** They are not subscription rows, so the due-claim can never reach them when `after()` did not run. Bounded per run, one fetch per provider subscription, and only events older than a short grace.
5. **An event for a terminal subscription is linked, never marked due.** The `subscription_terminal_not_due_check` CHECK forbids a due terminal row, and Razorpay documents terminal states as final. Admin "sync now" can still observe one.
6. **Apply resolves only the anomalies an observation proves stale**: `PROVIDER_SUBSCRIPTION_MISSING` and `UNMAPPED_PROVIDER_PLAN`. Every other type stays open for a human (Phase VIII). An alert fires when an anomaly is newly opened; repeats only bump `occurrences`.
7. **Apply settles `OUTCOME_UNKNOWN` operations** per [operation model](../commands/operation-model.md#resolving-outcome_unknown), and the tick first moves lapsed `IN_FLIGHT` operations to `OUTCOME_UNKNOWN`. The `request` shape apply reads (`{ plan, cycle }` for a plan change) is defined in Phase IV, and Phase V writes it.
8. **The trial-conversion rule (IB-9) is in the mapping now**, with C7. The `TRIAL_CONVERSION_OVERDUE` anomaly row waits for Phase VII's enum value, so Phase IV emits the alert only. No trial exists before Phase VII.
9. **`CANCELLATION_NOT_EFFECTIVE` (I-4) stays in Phase VI.** Phase IV only keeps the invariants: `cancelAtPeriodEnd` is never cleared by a missing field, and an observed `CANCELLED` clears it.
10. **Tick budgets (IB-10 values):** `billing:sync` runs first with a 10 s soft deadline and sequential fetches (worst-case overrun: one provider timeout), and the notification drain default drops from 45 s to 30 s. Recorded in [internal jobs](../../workflows/internal-jobs.md).
11. **Admin "sync now"** is `POST`, requires `VIEW_BILLING` (IB-15), runs at priority 1 through the targeted claim, takes no `Idempotency-Key` (it mutates nothing at the provider; IB-6 covers provider mutations), and returns no provider identifier (SB-PB-04).
12. **IB-20's hosting route** for TEST verification is a stable ngrok domain in front of the local dev server. A Vercel deployment-protection bypass is needed only if a hosted TEST deployment is used later.
13. **TEST plans for verification** are created by an idempotent TEST-only tool (`pnpm billing:test-plans`) and wired into the TEST plan catalog. Their prices (Pro ₹10/month and ₹12/year, Pro+ ₹20/month and ₹22/year) are **temporary TEST-only verification values** set by the owner. They are not Kizunia pricing (B6 stays open) and not a product decision.

### IB-25 — Phase V implementation rulings

| | |
| --- | --- |
| **Status** | **DECIDED** — 2026-09-25 |
| **Decided by** | Architecture/technical decision (autonomous) |
| **Kind** | ARCHITECTURE |
| **Affects** | Phase V |

Places where the Phase V design left a detail open, or where the documents and the Phase IV code disagreed, ruled before the code relied on them. None changes a settled decision; each can be overridden by a new ruling.

1. **Tx B composes the apply path.** Command-model step 7 needs "bind, apply, operation `SUCCEEDED`, mark due" in **one** transaction, but `applyObservation` opened its own. The apply path now also exports `applyObservationInTransaction(tx, …)`; `applyObservation` is a thin wrapper with unchanged behavior. Likewise the bind (was private to the unmatched resolver) is `backend/sync/binding.ts`, used with trigger `WEBHOOK`, `COMMAND_RESPONSE` or `ORPHAN_DISCOVERY`, and the lapsed-lease expiry (was private to `billing:sync`) is shared by the tick and the runner's tx A.
2. **The orphan window closes on a send-time bound.** `requestSentAt` is persisted in tx B (command-model step 5), so a crash between the call and tx B leaves it null. The close rule uses `COALESCE(requestSentAt, leaseUntil) + overlap ≤ watermark`: a live process always sends before its lease ends, because the lease (60 s) is far longer than the client timeout (10 s). Conservative: it can only close later, never earlier.
3. **A local precondition refusal is recorded without a new column.** The operation is marked `REJECTED` in tx A with `failureClass` and `requestSentAt` null, which means "refused before anything was sent". A same-key replay returns that recorded refusal and never re-executes; its explanation is derived from current local state through the same precondition policy. Provider and budget refusals keep `failureClass` and `providerErrorCode` as designed. Reuse answers (a `PROVISIONING` or unexpired `PENDING_AUTHENTICATION` checkout for the same plan) roll tx A back and persist no operation, because nothing is mutated.
4. **Abandon-then-create is rooted at the create.** No parent kind fits (`SUPERSEDE` and `CHANGE_PLAN` are Phase VI's). The root is the `CREATE_SUBSCRIPTION` operation, with `subscriptionId` null until its `PROVISIONING` row exists; the abandon is a `CANCEL_IMMEDIATELY` child. When the targeted sync observes the old checkout terminal, a short transaction inserts the `PROVISIONING` row and links it to the root (a one-time fill of a null reference, like a bind), then the create proceeds. When it does not, the root is `REJECTED` (nothing created; `failureClass` null) and the response is `CONFIRMING`. A create root never ends `SUCCEEDED` without a create.
5. **A checkout is reused only with time left.** A pending checkout for the same plan and cycle is reused only if at least `BILLING_CHECKOUT_REUSE_MIN_REMAINING_SECONDS` (5 min) remain before `expire_by`; otherwise it is treated as expired (abandon, then create). Stricter than "not passed", so a user is never handed a checkout that expires mid-payment.
6. **`billing:orphan-discovery` runs last in the tick.** The IB-10 arithmetic leaves no room for another provider-calling task before notifications. The task is read-only, low-frequency (≥ 900 s), bounded by its own soft budget, and persists its cursor after every page, so a run cut short by `maxDuration` loses nothing.
7. **Provider identifiers reach the browser only in the checkout response.** `checkout.js` needs `key` and `subscription_id`; they are returned to the owner of the checkout, in that one response. `GET /me/billing` and every other response carry none (SB-PB-04).
8. **Checkout confirmation takes no `Idempotency-Key`.** It is a read-only trigger with no `BillingOperation` (the command catalog's "none"), like admin sync-now (IB-24 item 11). The signature is verified against the server-held ID only (SB-CM-06); a subscription ID the browser sends is compared for a security log and otherwise ignored.
9. **Sizing uses the observed `expire_by` lag.** D6 recorded 188 s and 322 s; the orphan overlap (15 min) and the reuse margin are sized for at least ~6 minutes, not the "~3 minutes" some documents still stated (corrected with this phase).
10. **`billing:command`** is defined with the checkout policies for the runner's other user commands; Phase V has no route that uses it (Phase VI does).

### IB-26 — Phase VI implementation rulings

| | |
| --- | --- |
| **Status** | **DECIDED** — 2026-09-26 |
| **Decided by** | Architecture/technical decision (autonomous); item 6's use of prices follows the owner's choice while planning Phase VI |
| **Kind** | ARCHITECTURE |
| **Affects** | Phase VI |

Places where the Phase VI design left a detail open, ruled before the code relied on them. None changes a settled decision; each can be overridden by a new ruling.

1. **A customer cancel is rooted at the cancel itself.** No parent kind fits a cancel that first clears a scheduled change (`SUPERSEDE` and `CHANGE_PLAN` are other commands). As with IB-25 item 4, the root is the command's own kind (`CANCEL_AT_CYCLE_END` or `CANCEL_IMMEDIATELY`), and `CANCEL_SCHEDULED_CHANGE` is a child confirmed by sync. Only a cycle-end cancel (`ACTIVE`) clears a pending change first (SB-LC-08): an immediate cancel ends the subscription, and Razorpay offers Cancel-an-Update only for pending updates on subscriptions it can update. If the cleared change is not observed yet, the root is `REJECTED` with a null `failureClass` (nothing of its own was sent) and the response is `CONFIRMING`.
2. **A cancel request carries the timing the customer acknowledged** (`CYCLE_END` or `IMMEDIATE`). The server derives the required timing from local state in tx A. If they differ (the phase moved after the page rendered), the request is refused with `409 BILLING_CANCELLATION_TIMING_CHANGED` and the current timing, and nothing is sent. The customer's consent is never silently widened from "ends on `<date>`" to "ends now". The acknowledged timing also selects the root kind, so the runner can take the slot before tx A.
3. **I-4 inputs.**
   - The period end in force when a cycle-end cancel was sent is stored on its operation's `request` (`{ atCycleEnd: true, periodEnd }`); I-4 (i) reads it through `cancelRequestedByOperationId`. It does not use the row's `currentPeriodEnd`, which a renewal moves.
   - The margin for (i) is the checkpoint margin (C3), so the `current_end` checkpoint sync is the observation that decides.
   - (ii) compares `CHARGE` money facts' `occurredAt` with `cancelRequestedAt` (the cancel's `requestSentAt`).
   - (iii) is a state check, "`HALTED` while the flag is set", so a flag that meets an already-`HALTED` row is still caught.
   - A cycle-end cancel whose own response shows a phase other than `ACTIVE` (the phase moved between tx A and the call) never sets the flag: the request was a no-op by I-2, so `CANCELLATION_NOT_EFFECTIVE` is raised at once and the customer is told to try again.
4. **Composed roots end on their children.** A `SUPERSEDE` or `CHANGE_PLAN` root sends nothing itself, so it has no `requestSentAt`. It ends `SUCCEEDED` when every child it ran succeeded, even when the confirmation is still pending (`CONFIRMING`). Otherwise it ends `REJECTED`, with the failing child's `failureClass` (null when the child's outcome is unknown or it was not confirmed). A replay reads the children, never re-executes.
5. **Supersession shape.**
   - A checkout request with `supersedesSubscriptionId` (a Kizunia ID, which `/me/billing` now returns) and `confirmSupersession: true` opens a `SUPERSEDE` root whose `subscriptionId` is the old subscription.
   - Before the cancel, one targeted priority-1 sync re-checks that the old subscription is still `HALTED` or `PAUSED`: a subscription that recovered on its own is never cancelled.
   - The create is a `CREATE_SUBSCRIPTION` child whose `notes.kz_op` is the child, so webhook and orphan binding settle it as any create.
   - Continuation: when the named subscription is observed `CANCELLED`, is not superseded yet, and the user has no open subscription, the next request creates and links in one step.
   - Any other combination is refused with `409 BILLING_SUPERSESSION_NOT_APPLICABLE`, and the UI refreshes the summary.
6. **Plan-change direction by price.** SB-LC-02/03 define an upgrade and a downgrade by price ("a cycle change that raises the price"). Each plan-catalog entry therefore carries an optional `amountMinor` (TEST: the IB-24 item 13 values; LIVE: empty until B6). Direction compares the target's current price with the subscribed plan's price. A missing price makes the change `UNAVAILABLE` (`PRICE_UNKNOWN`) rather than guessed; an equal price is refused. The price is configuration for this comparison only, never a billing amount.
7. **Correcting the advisory from a refusal.** An `UPDATE_PLAN` refused with class `REJECTED` sets `advisoryInternationalCard = false`, and the advisory treats `false` as the V1 limitation whatever the method. A method refusal and a proration-floor or state refusal cannot be told apart by code (D10), and descriptions are never matched (IB-23 item 4). So the correction is conservative: the UI stops offering the change until the advisory is next refreshed (recovery from `HALTED`, or a new authorization).
8. **Recovery entry points.**
   - `POST /api/v1/me/billing/recovery` returns `keyId` and the provider subscription ID for the caller's own `HALTED` or `PAUSED` subscription, so `checkout.js` can open Razorpay's card change (`subscription_card_change`). It is the second, and only other, response that carries a provider identifier, to the subscription's owner (IB-25 item 7).
   - "Check now" is `POST /api/v1/me/billing/sync`: a read-only, priority-2 targeted sync of the caller's own bound open subscription. It has no operation, no `Idempotency-Key`, and the `billing:checkout-confirm` limit, like confirm (IB-25 item 8).
9. **The admin cancel takes an `Idempotency-Key`** (IB-6 item 4), unique per the *target* user, as every operation is. It is not a customer command, so an open multiple-subscriptions anomaly does not block it (SB-UQ-05). It refuses `PROVISIONING` (nothing to cancel yet) and terminal subscriptions.
10. **The UPI recovery UX (IB-22) is still PROVIDER-DEPENDENT.** The UI offers recovery first, then supersession (multiple-subscriptions step 1), for every payment method. This is not recorded as the settled UPI answer, and it blocks a UPI launch until the A16 observations are made.

### IB-27 — Phase VII decisions and implementation rulings

| | |
| --- | --- |
| **Status** | **DECIDED** — 2026-09-26 |
| **Decided by** | Items 1–6: **Product decision (owner)**. Items 7–19: Architecture/technical decision (autonomous) |
| **Kind** | PRODUCT + ARCHITECTURE |
| **Affects** | Phase VII |

*Product decisions (owner).* These close the "trial length" owner decision the Phase VII plan required, and the questions the documents left open:

1. **Trial length is 14 days** (`BILLING_TRIAL_LENGTH_DAYS`, default 14). The product specification's 30 days was only an example.
2. **A trial may be started on any paid plan and any cycle**, and converts to the plan and cycle it was started on.
3. **A marketing code is refused on a trial checkout**, before any provider call. Whether an Offer and a trial can combine is not documented, and the interaction with the ₹5 authentication charge is unverified. A later ruling can relax it.
4. **UPI trial fallback.** Trials are offered for every payment method. If UPI AutoPay cannot authorize a future-`start_at` subscription, the provider's refusal surfaces and the customer can use a card. Nothing method-specific is coded. [A16](../../../project/feature-specification/subscription/open-decisions.md#a-razorpay-behavior-requiring-test-mode-verification-or-support) (b) stays **PROVIDER-DEPENDENT** and the decision is revisited after a UPI TEST run ([IB-18](#ib-18--upi-disabled-on-the-razorpay-test-account)).
5. **An Offer code is consumed only by a subscription that carried it and reached a contributing phase** (`firstContributedAt` set). An abandoned or expired checkout that carried the code consumes nothing, mirroring the trial rule (SB-LC-11).
6. **The Offer catalog is static configuration in V1** (Razorpay Dashboard → `offer_id` → `config/offer-catalog.ts` → deploy). This is an **intentional V1 limitation**: adding an Offer needs a code change and a deployment. The catalog is read through one narrow asynchronous seam (`OfferCodeSource`), so a later admin-managed, database-backed catalog replaces only the backing source, not the eligibility, checkout, redemption or entitlement code. No admin Offer UI and no database catalog are built in Phase VII (Phase VIII or later).

*Architecture/technical decisions (autonomous).*

7. **Eligibility is read from the user's Subscription rows in the current provider mode only**, so TEST history never affects a LIVE deployment.
8. **A trial is consumed** when a `kind = TRIAL` subscription has `firstContributedAt` set (it reached `TRIALING`, `ACTIVE` or `PAST_DUE`).
9. **`FIRST_PAID_SUBSCRIPTION_ONLY`** means the user has no prior qualifying **Subscription** (one that ever reached `TRIALING`, `ACTIVE` or `PAST_DUE`, the literal SB-CP-04 wording; a trial therefore counts). It is computed from Subscription rows only. Admin grants, promotion grants and effective access are never consulted, so a user whose paid access came only from a grant or promotion is still first-paid eligible.
10. **A checkout's "same intent" is `(plan, cycle, kind, normalized code)`.** A pending checkout is reused only for the same intent; otherwise it is abandoned and recreated. A `PROVISIONING` row of a different intent is `CHECKOUT_IN_PROGRESS`.
11. **A recorded local refusal is explained from the operation's stored `request`** (which gains `kind` and `code`), never from the replaying body.
12. **Refusals for codes** are `CODE_INVALID` (unknown, outside its window or absent in this mode; not told apart to the client), `CODE_NOT_APPLICABLE` (plan or cycle), `CODE_NOT_ELIGIBLE` (the user's history), `CODE_NOT_ALLOWED_ON_TRIAL`, `TRIAL_NOT_ELIGIBLE`. Enumeration is bounded by the closed per-user rate limit.
13. **A create refused by the provider while an Offer was sent** is `CODE_REFUSED_BY_PROVIDER` and raises a `billing.alert` (a catalog misconfiguration). No description is parsed.
14. **Promotion redemption takes no `Idempotency-Key`.** It makes no provider call and creates no operation; its natural key is `(promotionId, userId)`. A repeat is `409 PROMOTION_ALREADY_REDEEMED`.
15. **Promotion redemption is one transaction:** the grant, the redemption, the conditional decrement and the audit entry commit together or not at all. A duplicate (`P2002` on `(promotionId, userId)`), a sold-out promotion (the decrement matched no row), an ineligible user or any error rolls back all of it. Logs are emitted after the commit.
16. **One authorization chain for promotions.** `MANAGE_ENTITLEMENT_GRANTS` (`SUPER_ADMIN`, IB-15) is the single authoritative permission for creating and listing promotions, enforced in the service through `BillingAuthorizer.manageGrants`. The admin rate-limit policies throttle and authorize nothing. Redeeming needs an authenticated session only, and the subject is always the session user.
17. **Promotion and Offer codes are disjoint** (SB-CP-01). Creating a promotion whose normalized code exists in the Offer catalog (any mode) is refused, and a test keeps catalog codes unique.
18. **`TRIAL_CONVERSION_OVERDUE`** is raised by the apply path beside the existing alert. It is never auto-resolved (IB-24 item 6): it is for an operator.
19. **A promotion's `eligibility`** reuses the same three rules (SB-CP-04). For a promotion `ONCE_PER_USER` and `ANY_USER` coincide, because the unique redemption record already enforces once per user.

**Documents amended.** [`../lifecycle/trials.md`](../lifecycle/trials.md), [`../entitlements/coupons-and-offers.md`](../entitlements/coupons-and-offers.md), [configuration](configuration.md), [settled decisions](settled-decisions.md).

### IB-28 — Phase VIII decisions and implementation rulings

| | |
| --- | --- |
| **Status** | **DECIDED** — 2026-09-26 |
| **Decided by** | Architecture/technical decision (autonomous). The role split itself (who may view, resolve, re-sync, cancel and read raw payloads) is the owner's ruling in [IB-15](#ib-15--billing-admin-roles); nothing below changes it |
| **Kind** | ARCHITECTURE |
| **Affects** | Phase VIII |

Places where the Phase VIII design left a detail open, or where the documents disagreed, ruled before the code relied on them. None changes a settled decision or a provider fact; each can be overridden by a new ruling.

1. **Pruning nulls the payload; it never deletes the row.** The security and history documents said raw payloads are "deleted" after the retention horizon; the Phase VIII scope, the database design and the `payloadPrunedAt` column say "nulled, row kept". The latter wins, and both documents are corrected. The event's metadata, its money facts and the history that references it stay.
2. **Retention configuration.** `BILLING_PAYLOAD_RETENTION_DAYS` defaults to **180** (the B3 default; B3 itself stays DEFERRED, so this is a default and not a retention decision). The task's shape is configured by `BILLING_PAYLOAD_PRUNE_BATCH_SIZE` (500), `BILLING_PAYLOAD_PRUNE_MAX_BATCHES` (20 per run), `BILLING_PAYLOAD_PRUNE_WALL_CLOCK_MS` (3 000) and `BILLING_PAYLOAD_PRUNE_MIN_INTERVAL_SECONDS` (daily).
3. **Prune mechanics.** Each batch is one autocommit `UPDATE … WHERE id IN (SELECT … ORDER BY receivedAt LIMIT n FOR UPDATE SKIP LOCKED)`: no long transaction, and overlapping runs take different rows. It is registered in the tick **before** `billing:orphan-discovery`, which keeps the last slot (IB-25 item 6); its small budget keeps the IB-10 worst case intact. A manual `GET /api/v1/internal/billing/payload-prune` (`CRON_SECRET`) exists like every other billing task's.
4. **Bulk re-sync only marks rows due, at priority 3.** It selects the resolved provider mode's bound, non-terminal subscriptions, optionally with `lastSyncedAt < t` (a never-synced row counts as older). It sets `syncDueAt := LEAST(existing, now)` and `syncReason := ADMIN` **unless the row is already due**, so a pending `WEBHOOK` or `CHECKOUT_CONFIRM` sync (priority 2) is never demoted; it does not set `syncRequestedAt`. It works in keyset batches (`BILLING_BULK_RESYNC_BATCH_SIZE`, 500) of short statements, has a `dryRun` that counts and writes nothing, requires a reason (3–500 characters), and with billing disabled answers `503` like the other billing commands, since nothing would drain. It has no provider dependency (a unit test pins that); the rows drain through `billing:sync` inside its budget. This settles the "P1 / P3" wording in the command model: sync now is priority 1, bulk re-sync priority 3.
5. **Raw payloads.** A new platform action `VIEW_BILLING_RAW_PAYLOADS` is held by `SUPER_ADMIN` only (IB-15 left action names to implementation time); `VIEW_BILLING` does not imply it. The **timeline never carries a payload, for any role**: an event entry says only `hasPayload` (computed in SQL, so the payload is never loaded) and when it was pruned. A `SUPER_ADMIN` reads one payload through `GET /api/v1/admin/billing/events/{id}/payload`, which is `Cache-Control: no-store` and logs `admin.payload_viewed` with the actor and event id, never the content. The logger also redacts a `rawPayload` key as a safety net behind the no-logging rule.
6. **Provider reference ids in the admin views.** The provider subscription id, a webhook's provider event id and a money fact's provider object id appear as opaque strings to `VIEW_BILLING` administrators: the runbook's Dashboard cross-checks need them, and this is billing-module tooling (SB-PB-04 as amended keeps them inside the billing module). The stored `providerSnapshot` is not exposed, and an operation's recorded `request` is shown through a whitelist of scalar fields.
7. **Explain reuses the resolver's explain function unchanged.** The service only **decorates** each source, looked up by id (when the subscription entered its phase, its sync state, who granted a grant and why) and lists the user's open anomalies; it never re-derives access. It answers for the current instant. A historical "as of" explanation replayed from history and grant audit is **not built**; it is optional in the design and no Phase VIII acceptance criterion needs it.
8. **Timeline.** One merged, newest-first list of history entries, operations, webhook-event metadata and money facts, for a user (all their subscriptions) or one subscription. Each source is capped at 200 rows per request and the response says when a cap was reached. A user's events are those linked to one of their subscriptions or carrying one of their provider subscription ids (an event recorded before it was matched). Money facts have no user or subscription index and operations no `(providerMode, status, createdAt)` index; the bounded, admin-only queries are acceptable at V1 volume and no schema work is done in this phase (follow-up if it ever matters).
9. **Health summary contents.** The Phase VIII list, plus what the runbook needs and the tables already hold: the ten oldest due subscriptions and the ten oldest `OUTCOME_UNKNOWN` operations (both link to the user), the orphan-discovery watermark and window per mode, the last event verified by the **previous** webhook secret per mode (the rotation check), and the last run of `billing:sync`, `billing:orphan-discovery` and `billing:payload-prune` from `internal_job_run`. "The last `billing:sync` result" is therefore its last run time and status; the run's counts are logged as `sync.run` and are not persisted. It works while billing is disabled (the mode reads `DISABLED`), never exposes the key fingerprint, and carries the viewer's permission flags.
10. **Anomaly resolution is one conditional update.** `UPDATE … WHERE id = ? AND resolvedAt IS NULL` sets `resolvedAt`, `resolvedByUserId` and `resolutionReason` and touches no other table. No row matched means `404` (unknown id) or `409 BILLING_ANOMALY_ALREADY_RESOLVED`: two concurrent resolutions record exactly one, and an anomaly an observation already resolved is refused the same way. The service validates the reason itself, so a caller that skips the controller cannot resolve without one. A later detection of the same situation opens a **new** anomaly (the partial unique index only covers open rows). `anomaly.resolved` is logged with `by: "admin"`, the actor and the reason.
11. **Admin actions are audited by structured logs with the actor**, as the phase specifies (`anomaly.resolved`, `resync.bulk_marked` / `resync.bulk_previewed`, `admin.payload_viewed`, `sync.admin`). No table is added. The anomaly row is the durable record of a resolution; a bulk re-sync and a payload view are recorded in logs only. A durable admin-action audit table is a possible later addition.
12. **Alert links.** Every `billing.alert` carries an `adminPath`: the anomaly's page when the alert names one, else the user's billing page, else the billing overview.
13. **Sync now stays per Subscription.** The runbook said "one user or Subscription"; the endpoint is per Subscription, and the user's billing page lists that user's subscriptions, each with "Sync now". The runbook is corrected.
14. **Database restore needs no watermark tool.** A restored `billing_provider_state` carries a watermark at or before the restore point, so orphan discovery re-scans from there by itself. The runbook's implied manual reset is removed.
15. **Rate limits reuse the existing buckets.** Reads (including the payload view) use `billing-admin:read` (120 per minute); anomaly resolution and bulk re-sync use `billing-admin:write` (60 per hour), like sync now and immediate cancel. A dry run counts as a write.
16. **The UI is thin and server-authoritative.** Pages gate on `VIEW_BILLING`; the client shows or hides controls from the permission flags the API returns and every action is re-authorized by its API. The Promotions sidebar link is limited to `SUPER_ADMIN`, matching its page, which `ADMIN` could see in the menu but not open.

**Documents amended.** [operations runbook](../cross-cutting/operations-runbook.md), [security](../cross-cutting/security.md), [subscription history](../history-and-audit/subscription-history.md), [observability](../cross-cutting/observability.md), [observability and operations](observability-and-operations.md), [command model](command-model.md), [admin grants](admin-grants.md), [configuration](configuration.md), [settled decisions](settled-decisions.md), [`internal-jobs`](../../workflows/internal-jobs.md), and the [Phase VIII plan](../implementation-plan/phase-VIII/README.md).

## Withdrawn findings

### IB-8 — Launch enforcement for existing users

**Withdrawn 2026-09-24.** The blueprint's IB-8 asked what should happen to existing users when entitlement gates are switched on (their public portfolio, MCP access, deadline and recommendation notifications, and project creation above the Free quota), and offered three options: enable gates only together with LIVE checkout, bulk-grant or promote existing users, or add an explicit enforcement switch. It was listed as a production blocker for enabling any gate.

It no longer applies. Kizunia is pre-production, the database will be created fresh, there are currently zero users, and there is no legacy-user migration requirement, so there are no existing users to protect. None of the three options is needed, and no slice is gated on it. See [settled decisions](settled-decisions.md#decisions-applied-when-this-documentation-was-created).

## Open Razorpay items

None of these blocks V1 code: each has a defined fallback in the design. The evidence and fallbacks are in the product register ([§A](../../../project/feature-specification/subscription/open-decisions.md#a-razorpay-behavior-requiring-test-mode-verification-or-support)) and in [Razorpay facts](../provider-boundary/razorpay-facts.md). Classified in the close-out by what each blocks:

| Item | What it is | Blocks architecture? | Blocks a phase? | LIVE blocker? |
| --- | --- | --- | --- | --- |
| A3 | Scheduled-change webhooks | No | No (due-based sync observes it) | No |
| A4 | UPI / e-mandate refusal shape | No | No (classification by code) | No |
| A6 | Event-ID header presence and stability | No | Verified in Phase IV (fallback: body hash) | No |
| A7 | First post-trial charge failure | No | Risk for Phase VII (bounded by IB-9's grace) | Observe in LIVE |
| A10 | Result of a mandate revocation | No | No | No (support playbooks) |
| A11 | E-mandate retry timing | No | No | No |
| A12 | Account API rate limits | No | No (conservative budget) | **Yes** (Razorpay Support) |
| A15 / D11 | Offers across upgrades and downgrades | No | No (observe and apply) | No |
| A16 (new) | UPI lifecycle behaviors ([IB-18](#ib-18--upi-disabled-on-the-razorpay-test-account)) | No | Verification in V–VII | **Yes, for a UPI launch** |

Also unverified: that a Kizunia cycle-end cancel actually takes effect at `current_end` (the limitation recorded under A2), and all webhook delivery behavior.

## Open product questions

From the product register ([§B](../../../project/feature-specification/subscription/open-decisions.md#b-genuinely-open-product-questions)). B1 is now decided for V1 ([IB-21](#ib-21--plan-change-extensibility)). The rest are **DEFERRED** with their stated V1 behavior, except B6, which is a **LIVE BLOCKER** because the LIVE plan catalog needs prices.

- **B2** retention horizon for a long-halted subscription (V1: never auto-cancelled)
- **B3** billing-record and raw-payload retention (blocks only the deferred account-removal workflow)
- **B4** whether a banned user's subscription is cancelled (V1: support action)
- **B5** self-serve undo of a cancellation (V1: not offered)
- **B6** pricing — **LIVE BLOCKER**
- **B7** trial cooldown or re-trial policy (V1: one trial per account)
- **B8** MCP entitlement granularity (V1: one Pro+ capability)
- **B9** ownership model for one-time purchases
- **B10** coupon stacking (V1: none)

Also open for the owner, and not blocking before the named phase:

- ~~**Trial length** (decide before Phase VII).~~ **Decided 2026-09-26: 14 days** ([IB-27](#ib-27--phase-vii-decisions-and-implementation-rulings) item 1).
- **Launch scope**: whether LIVE launch waits for trials, Offers and Promotions (decide before Phase IX). The phases are independent, so either answer works.

## Open configuration values

The mechanisms are decided; only the values are open (**IMPLEMENTATION-TIME**; [§C](../../../project/feature-specification/subscription/open-decisions.md#c-implementation-time-configuration)). See [configuration](configuration.md).

- **C1** outbound request budget and headroom per priority
- **C2** backoff and cooldown
- **C3** heartbeat intervals and checkpoint margins
- **C4** batch sizes
- **C5** checkout `expire_by` horizon and operation lease
- **C6** tick cadence per deployment (the LIVE target is [IB-19](#ib-19--tick-cadence-on-the-vercel-hobby-plan))
- **C7** trial-conversion grace ([IB-9](#ib-9--trial-conversion-gap))

## Related documents

- [Settled decisions](settled-decisions.md) · [Index](README.md) · [Phase-wise implementation plan](../implementation-plan/README.md)
- [Product open decisions](../../../project/feature-specification/subscription/open-decisions.md)
- [Decision register](../../../project/feature-specification/subscription/decisions/README.md)
