# Subscription & Billing — Phase-wise Implementation Plan

> **Status:** Engineering roadmap — Phases I, II, III, IV and V implemented; Phases VI and VII implemented (2026-09-26), each with its card and UPI TEST verification still open ([Phase VI runbook](phase-VI/manual-test.md), [Phase VII runbook](phase-VII/manual-test.md))
>
> **Created:** 2026-09-24, after the implementation decision close-out
>
> **Audience:** Engineers implementing and reviewing Subscription & Billing

This is the roadmap to follow while coding Subscription & Billing. It divides V1 into **nine phases**. Each phase is a subsystem or capability that can be implemented, tested, reviewed and stabilized as a unit. Each phase document says **what** is built and **what "done" means**. It deliberately does not dictate ordinary coding choices; the existing Kizunia conventions and the architecture documents guide those.

## How this relates to the other documents

| Layer | Location | Answers |
| --- | --- | --- |
| Product behavior and rulings | [`docs/project/feature-specification/subscription/`](../../../project/feature-specification/subscription/README.md) and its [decision register](../../../project/feature-specification/subscription/decisions/README.md) | *What* Kizunia does, and why |
| Architecture | [`docs/architecture/subscription/`](../README.md) | *How* it is built |
| Implementation reference | [`../implementation/`](../implementation/README.md) | *Where* each rule lands in the current code; the IB findings and their rulings |
| **This directory** | `implementation-plan/` | *In what order* to build it, and *when each part is done* |

If a phase document and an architecture document disagree, the architecture document and the rulings win. Fix the phase document in the same change. A phase document never introduces a new product or architecture decision; if implementation uncovers one, it is raised and recorded as a ruling before the code depends on it.

## Status vocabulary

Every open item in these documents carries one of these statuses (defined in [open decisions](../implementation/open-decisions.md#status-vocabulary)):

| Status | Means |
| --- | --- |
| **DECIDED** | Ruled; implementation follows it |
| **DEFERRED** | Deliberately not decided for V1; the V1 fallback is stated |
| **PROVIDER-DEPENDENT** | Supported by the architecture; the concrete behavior or UX waits on unverified Razorpay behavior |
| **LIVE BLOCKER** | Does not block code; must be resolved before LIVE billing |
| **IMPLEMENTATION-TIME** | Mechanism decided; value or detail chosen while coding |

Rulings also record their **decision authority**: *product decision (owner)* or *architecture/technical decision (autonomous)*. See [settled decisions](../implementation/settled-decisions.md#rulings-from-the-2026-09-24-decision-close-out).

## Phases

| Phase | Name | Delivers | Depends on | Razorpay needed? |
| --- | --- | --- | --- | --- |
| [I](phase-I/README.md) | Entitlement foundation and admin grants | The plan/capability catalog, the async per-user effective-access resolver, grants with audit, billing admin actions and roles, `GET /me/entitlements`, the `modules/billing` skeleton | — | No |
| [II](phase-II/README.md) | Feature entitlement integration | Project quota, portfolio create and public display, notification intents, MCP, admin bypass, preference `entitled` flags, UI flags | I | No |
| [III](phase-III/README.md) | Billing persistence, mode and provider boundary | The billing schema, boot-time mode validation, configuration and catalogs, the provider interface with the Razorpay client and a fake, the failure taxonomy, the request budget and cooldown, the ESLint boundary, and a resolver that reads subscriptions | I | Contract checks only (TEST keys) |
| [IV](phase-IV/README.md) | Synchronization, reconciliation and webhooks | Mapping, guarded apply, claim, next-due, backoff, anomalies, history, the `billing:sync` task, webhook ingestion, admin sync-now | III | TEST, plus a stable webhook URL |
| [V](phase-V/README.md) | Commands and checkout | The command runner, StartCheckout (with reuse and abandon), confirm, orphan discovery, `/me/billing`, the thin checkout UI | IV | TEST |
| [VI](phase-VI/README.md) | Subscription lifecycle commands | Customer and admin cancel, `CANCELLATION_NOT_EFFECTIVE`, supersession, recovery entry points, native plan change behind the strategy seam | V | TEST |
| [VII](phase-VII/README.md) | Trials, Offers and Promotions | Trial kind, eligibility and bounded conversion; the Offer catalog and marketing codes; promotion redemption producing grants | V (and I) | TEST |
| [VIII](phase-VIII/README.md) | Admin billing tools and operations | Timeline, explain, anomaly resolution, bulk re-sync, health summary, payload pruning, runbook alignment | IV (grows with V–VII) | TEST |
| [IX](phase-IX/README.md) | LIVE readiness | The LIVE blockers resolved, LIVE catalogs, a UPI LIVE verification, the alert channel, the tick trigger, a runbook dry-run, removal of the TEMPORARY route | All | LIVE |

```text
            ┌──────────── II (feature gates) ─────────────────────────────┐
            │                                                             │
 I ─────────┼──> III ──> IV ──> V ──┬──> VI ─────────────────────┐        ├──> IX (LIVE readiness)
 (grants,   │   (schema,  (sync,    │                            │        │
  resolver) │    provider) webhooks)├──> VII (trials, codes) ────┤        │
            │                       │                            │        │
            │                 IV ───┴──> VIII (admin tools; grows with V–VII)
            └─────────────────────────────────────────────────────────────┘
```

- Phases II and III both depend only on I, so they can proceed in parallel.
- VI and VII both depend on V and can proceed in parallel.
- VIII starts after IV and gains features as V–VII land.

### Deferred, not phased

- **Account-removal workflow** (the old slice S16): DEFERRED until the platform has an account-deletion feature ([IB-14](../implementation/open-decisions.md#ib-14--account-removal-storage)). Its **storage shape** is built in Phases I and III, so a hard delete of a user with billing rows fails safely in the meantime.
- **Switch/successor plan changes** for UPI, e-mandate and domestic cards: DEFERRED ([IB-21](../implementation/open-decisions.md#ib-21--plan-change-extensibility)). Phase VI builds the seams that let it be added later.

## Persistence boundary

Each phase owns its own migrations. No phase changes another phase's tables except as listed below. The model-by-model mapping is in [database design](../implementation/database-design.md#which-phase-creates-what).

| Phase | Owns (creates) | Must not create |
| --- | --- | --- |
| **I — entitlement persistence** | Enums `MembershipPlan` (`PRO`, `PRO_PLUS`), `EntitlementSource` (**`ADMIN_GRANT` only**), `GrantStatus`, `GrantAuditAction`. Models `EntitlementGrant` and `GrantAuditEntry` (no `promotionId` yet), with nullable `userId` + `onDelete: Restrict` + `subjectPseudonym`, the validity-window and no-self-grant CHECKs, and the resolver's grant index. The Phase I resolver reads **grants only** | Any subscription, provider, operation, event, money, history, anomaly or promotion table or enum; any column that refers to Razorpay |
| **II — feature integration** | `ProjectMember @@index([userId, role])` on an existing model | New tables |
| **III — billing persistence** | The enums `BillingCycle`, `SubscriptionKind`, `ProviderMode`, `SubscriptionPhase`, `SyncReason`, `ProviderFailureClass`, `BillingOperationKind`, `BillingOperationStatus`, `BillingActorKind`, `BillingEventStatus`, `BillingProvider`, `MoneyFactKind`, `HistoryChange`, `HistoryCause`, `HistoryTrigger` and `BillingAnomalyType`. The models `Subscription`, `BillingOperation`, `BillingEvent`, `BillingMoneyFact`, `SubscriptionHistoryEntry`, `BillingAnomaly` and `BillingProviderState`, with their partial unique indexes and CHECKs. The resolver is **extended** to read contributing subscriptions of the expected mode | Changes to Phase I tables, apart from Prisma back-relations on `User` |
| **VII — promotions and trials** | `EntitlementSource.PROMOTION` and `BillingAnomalyType.TRIAL_CONVERSION_OVERDUE`, each in its own `ALTER TYPE … ADD VALUE` migration. The models `Promotion` and `PromotionRedemption`. The columns `EntitlementGrant.promotionId` and `GrantAuditEntry.promotionId`, with `Restrict` FKs and the `source <> 'PROMOTION' OR "promotionId" IS NOT NULL` CHECK | — |
| **IV, V, VI, VIII** | No new tables. A new enum value, if one is needed, gets its own `ALTER TYPE` migration and is named in the phase document | New tables |

Why the boundary sits here: Phase I must be useful with **no Razorpay concept at all**. Admin grants exercise every paid capability in every environment ([testing without Razorpay](../cross-cutting/testing-without-razorpay.md)). Phase III is the first phase that knows a provider exists.

## Definition of done (every phase)

A phase is done when all of the following hold:

1. Every acceptance criterion in its document is met and demonstrated by a test, or, for provider behavior, by a recorded TEST observation.
2. **Unit and integration tests** follow the repository conventions (`next/docs/testing/conventions.md`): tests sit beside their code, Prisma is never mocked, and integration tests use `DATABASE_TEST_URL`.
3. **No provider call inside a transaction or under a row lock**, and no provider mutation from a background process ([architecture fit](../implementation/architecture-fit.md#forbidden-dependencies-enforce-with-an-eslint-no-restricted-imports-rule-in-s5)).
4. **Documentation is live.** Any document the phase proved wrong is corrected in the same change. Values chosen at implementation time are recorded next to the code and in [configuration](../implementation/configuration.md).
5. **No silent decisions.** A product or architecture question found while coding is raised, ruled and recorded before the code relies on it.
6. The phase's **expected output** exists: the code, migrations, tests, and any provider observations written into [Razorpay facts](../provider-boundary/razorpay-facts.md).
7. Every review item is resolved or has a recorded follow-up.

## Blockers

**Before Phase I: none.** Phase I needs no Razorpay, no UPI and no webhook endpoint.

Things that block a *later* phase:

| Item | Blocks | Status |
| --- | --- | --- |
| UPI enabled for Subscriptions on the Razorpay TEST account ([IB-18](../implementation/open-decisions.md#ib-18--upi-disabled-on-the-razorpay-test-account)); the **owner asks Razorpay Support**, and should do it early because of the lead time | UPI verification in V–VII | PROVIDER-DEPENDENT |
| Stable public TEST webhook URL ([IB-20](../implementation/open-decisions.md#ib-20--a-public-test-webhook-endpoint)) | Phase IV webhook verification | Done for TEST (ngrok, 2026-09-25); a hosted URL is still needed later |
| Trial length (owner) | Phase VII | **Decided 2026-09-26: 14 days** ([IB-27](../implementation/open-decisions.md#ib-27--phase-vii-decisions-and-implementation-rulings)) |
| Whether launch waits for trials, Offers and Promotions (owner) | Phase IX scope | Owner decision before IX |

**LIVE blockers** (all resolved in Phase IX):

- Razorpay account rate limits (A12, from Support);
- the alert delivery channel (IB-11);
- the tick trigger reaching the target cadence (IB-19);
- pricing and the LIVE plan catalog (B6);
- UPI verification (A16), including the UPI recovery UX (IB-22).

## Slices → phases

The blueprint's older slices S0–S17 map onto these phases as recorded in [implementation/implementation-plan.md](../implementation/implementation-plan.md#slice--phase-map).

## Keeping this live

- When a phase starts, set its status line (`Not started` → `In progress` → `Done`) and note the date.
- When a phase finishes, record its date and the commit or PR range in its document.
- When a ruling changes something a phase relies on, update the affected phase in the same change as the ruling.
