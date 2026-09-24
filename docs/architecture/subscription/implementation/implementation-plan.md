# Implementation Order (historical slices)

> **Status:** **Superseded as the roadmap on 2026-09-24** by the [phase-wise implementation plan](../implementation-plan/README.md). Kept for history and traceability.
>
> **Last Updated:** 2026-09-24
>
> **Blueprint section:** §20 (see the [section map](README.md#blueprint-section-map))

The blueprint's dependency-aware sequence of small vertical slices (S0–S17): goal, files likely affected, prerequisites, tests, architectural risks and what to commit, plus the proposed commit sequence.

**Use the [phase-wise implementation plan](../implementation-plan/README.md) to build.** On 2026-09-24 the slices were regrouped into nine engineering phases, each substantial enough to implement, test, review and stabilize as a unit. The slice table below is unchanged apart from annotations. Where it disagrees with a phase document (for example S10's `PAST_DUE` note, or S16's timing), the phase document and the rulings in [open decisions](open-decisions.md) win.

## Slice → phase map

| Slice | Phase |
| --- | --- |
| S0 Decisions & doc alignment | Done: the 2026-09-24 decision close-out |
| S1 Entitlement core, S2 Admin grants | [Phase I](../implementation-plan/phase-I/README.md) |
| S3 Feature gates | [Phase II](../implementation-plan/phase-II/README.md) |
| S4 Billing schema + mode, S5 Provider boundary | [Phase III](../implementation-plan/phase-III/README.md) |
| S6 Sync + reconciliation, S7 Webhooks | [Phase IV](../implementation-plan/phase-IV/README.md) |
| S8 Checkout, S9 Orphan discovery | [Phase V](../implementation-plan/phase-V/README.md) |
| S10 Cancellation, S11 Supersession, S12 Plan changes | [Phase VI](../implementation-plan/phase-VI/README.md) |
| S13 Trials, S14 Offers & Promotions | [Phase VII](../implementation-plan/phase-VII/README.md) |
| S15 Admin billing tools | [Phase VIII](../implementation-plan/phase-VIII/README.md) |
| S16 Account removal | **Deferred** until the platform has account deletion ([IB-14](open-decisions.md#ib-14--account-removal-storage)); its storage shape is built in Phases I and III |
| S17 LIVE readiness | [Phase IX](../implementation-plan/phase-IX/README.md) |

## Original slices (historical)

**Decisions referenced here:** [IB-1](open-decisions.md#ib-1--past_due-cancellation), [IB-2](open-decisions.md#ib-2--recommendation-gate-point), [IB-3](open-decisions.md#ib-3--entitlement-resolver-signature), [IB-4](open-decisions.md#ib-4--portfolio-creation-gate), [IB-5](open-decisions.md#ib-5--async-portfolio-public-eligibility), [IB-6](open-decisions.md#ib-6--composed-commands-and-the-in-flight-constraint), [IB-7](open-decisions.md#ib-7--admin-bypass-of-entitlement-gates), [IB-9](open-decisions.md#ib-9--trial-conversion-gap), [IB-10](open-decisions.md#ib-10--tick-time-budget), [IB-11](open-decisions.md#ib-11--alerting-channel), [IB-12](open-decisions.md#ib-12--soft-deleted-projects-and-the-quota), [IB-13](open-decisions.md#ib-13--boot-time-mode-validation-and-expected-mode), [IB-14](open-decisions.md#ib-14--account-removal-storage), [IB-15](open-decisions.md#ib-15--billing-admin-roles), [IB-16](open-decisions.md#ib-16--preferences-for-non-entitled-intents), [IB-17](open-decisions.md#ib-17--stale-documents-and-leftovers). All were ruled on 2026-09-24; see [open decisions](open-decisions.md) for each ruling and who made it (product decision (owner) or architecture decision (autonomous)).

---

Each slice is a vertical, shippable step with its own tests. No slice has a rollout dependency on existing users: Kizunia is pre-production with zero users and a freshly created database, so there is no grandfathering, backfill or legacy-user migration in any slice ([settled decisions](settled-decisions.md#decisions-applied-when-this-documentation-was-created)). This replaces the blueprint's earlier constraint that no gate reach production before IB-8; IB-8 is withdrawn ([open decisions](open-decisions.md#withdrawn-findings)).

| Slice | Goal | Likely files | Prereqs | Tests | Risks | Commit |
| --- | --- | --- | --- | --- | --- | --- |
| **S0 Decisions & doc alignment** *(done 2026-09-24)* | Rule on the open decisions (IB-1…IB-16 except the withdrawn IB-8); fix stale docs (IB-17) | `docs/**` only | — | — | Deciding by accident in code | `docs(subscription): record implementation decisions and align docs with code` |
| **S1 Entitlement core** | Plan/capability catalog; async `resolveEntitlements(userId)`; set-based predicate; explain; `EntitlementGrant` + `GrantAuditEntry` schema (+ `MembershipPlan`) | `lib/entitlements/*`, `prisma/schema.prisma`, migration (CHECKs), `lib/rate-limit/service.ts` (keep default) | S0 (IB-3) | Unit + agreement integration | Signature change ripples to rate limiting | `feat(entitlements): resolve effective access from grants` |
| **S2 Admin grants** | Grant/extend/revoke + audit + actions | `modules/billing/backend/grants/*`, admin routes, `authorization/platform/{actions,permission-set}.ts` | S1, IB-15 | Grants integration | Self-grant path | `feat(billing): admin entitlement grants with audit` |
| **S3 Feature gates** | Project quota, portfolio create + public, notification intents, MCP, `GET /me/entitlements` | `projects/backend/{service,repository}.ts` + index migration, `portfolio/backend/authorization/*`, `notifications/backend/notification-scheduler.service.ts`, handlers, delivery, `policy/types.ts`, `mcp/server/transport/dispatch.ts`, UI flags | S1, S2, IB-2/4/5/7/12/16 | Quota race, downgrade suite, notification scoping, MCP | Async portfolio resolver (IB-5) | One commit per feature: `feat(projects): enforce owned-project quota`, `feat(portfolio): gate creation and public display on entitlement`, `feat(notifications): gate deadline and recommendation intents`, `feat(mcp): require MCP capability` |
| **S4 Billing schema + mode** | All billing models/enums/indexes; `instrumentation.ts` mode validation; `.env.example`; resolver reads subscriptions | schema, migration(s) with CustomIndex/CustomCheck, `src/instrumentation.ts`, `modules/billing/provider/provider-mode.ts`, delete `types/auth-types.ts` `Subscription` | S1, IB-13/14 | Migration applies; mode unit tests; TEST/LIVE isolation | Partial indexes via raw SQL; enum-add migrations | `feat(billing): add subscription and billing schema` |
| **S5 Provider boundary** | Interface, taxonomy, fake, Razorpay fetch client, budget (`incrementIfBelow`), cooldown, ESLint boundary | `modules/billing/provider/*`, `backend/budget/*`, `lib/rate-limit/{store,postgres.store,memory.store}.ts`, `eslint.config.mjs` | S4 | Unit; provider-TEST contract (manual) | Classification errors | `feat(billing): Razorpay provider boundary with request budget` |
| **S6 Sync + reconciliation** | Mapping, apply + guard, mark/claim, `nextDue`, backoff, anomalies, history, `billing:sync` task + manual route, admin sync-now, health | `modules/billing/{policy,backend/sync,backend/reconciliation,backend/history,backend/anomalies}`, tick route, internal route | S5, IB-9, IB-10 | Sync integration suite | Tick budget; raw SQL hazards | `feat(billing): provider synchronization and billing-sync task` |
| **S7 Webhooks** | Route, verify, record tx, facts, `after()` sync, unmatched resolution; register TEST webhook; verify A6 | `app/api/v1/webhooks/razorpay/route.ts`, `backend/webhooks/*`, rate-limit policy | S6 | Webhook integration; provider-TEST webhook | First real webhook observation | `feat(billing): Razorpay webhook ingestion` |
| **S8 Checkout** | Command runner, StartCheckout (+reuse, abandon), confirm, `/me/billing`, pricing/checkout UI (thin) | `backend/commands/*`, `controller.ts`, `app/api/v1/me/billing/**`, `modules/billing/frontend/*` | S6, S7 | Command integration; manual TEST checkout | Double-create race | `feat(billing): checkout and subscription creation` |
| **S9 Orphan discovery** | Scan, bind, window close → `ABANDONED`; payload prune | `backend/reconciliation/orphan-discovery.service.ts`, tick | S8 | Orphan integration | Window too short → duplicates | `feat(billing): orphan discovery and outcome-unknown resolution` |
| **S10 Cancellation** | Customer cancel (`ACTIVE` cycle-end, `TRIALING` and — per IB-1, decided — `PAST_DUE` immediate), admin immediate, `CANCELLATION_NOT_EFFECTIVE` | `backend/commands/cancel*.ts`, apply detection | S8, **IB-1** | Cancel matrix; I-4 | PAST_DUE (IB-1) | `feat(billing): subscription cancellation` |
| **S11 Supersession** | HALTED/PAUSED replace flow | `backend/commands/supersede.ts`, UI confirmation | S10 | Supersession suite | Confirmation latency (IB-6) | `feat(billing): supersede halted or paused subscriptions` |
| **S12 Plan changes** | Native upgrade/downgrade, cancel scheduled change, advisory payment method | `backend/commands/change-plan.ts`, provider payment fetch | S8 | Plan-change matrix; provider-TEST refusal | Needs an international card to verify success (A3/A15) | `feat(billing): native plan changes` |
| **S13 Trials** | TRIAL kind, eligibility, conversion | preconditions, mapping | S8, IB-9 | Trial suite | A7 unverified | `feat(billing): Razorpay-native trials` |
| **S14 Offers & Promotions** | Code → Offer map; Promotion redemption → grant | `config/offer-catalog.ts`, `backend/grants/promotion.service.ts`, schema | S2, S8 | Eligibility and race tests | D11 offer/downgrade | `feat(billing): marketing codes and promotions` |
| **S15 Admin billing tools** | Timeline, explain, anomalies, bulk re-sync, health page | `app/(dashboard)/admin/billing/**`, admin controller | S6+ | Authorization tests | Raw-payload exposure | `feat(billing): admin billing tools` |
| **S16 Account removal** *(deferred, IB-14)* | Refuse-while-open + pseudonymize | `backend/account-removal/*` | S10, B3 | Removal integration | Better Auth endpoint interplay | `feat(billing): account removal with pseudonymized billing records` |
| **S17 LIVE readiness** | Razorpay Support rate limits (A12), alert channel (IB-11), runbook dry-run, LIVE catalogs, cadence (C6) | config, docs | all | Staging drill | — | `chore(billing): live readiness configuration` |

**Proposed commit sequence:** S0 → S1 → S2 → S4 → S5 → S6 → S7 → S8 → S9 → S13 → S10 → S11 → S12 → S14 → S15 → S3 → S16 → S17. In the blueprint S3 sits late in this sequence because its enablement was tied to IB-8, which is now withdrawn. Its remaining prerequisites are S1, S2 and the open decisions named in its row, so it may be scheduled any time after those; the rest of the sequence is unchanged.

---

## Related documents

**In this directory**

- [Database Design](database-design.md)
- [Billing Command Model](command-model.md)
- [Existing Feature Integration](feature-integration.md)
- [Open decisions](open-decisions.md) · [Settled decisions](settled-decisions.md) · [Index](README.md)

**Design and specification**

- [Verification checklist](../verification-checklist.md)
- [Architecture decision record](../../decisions/subscription-billing.md)
