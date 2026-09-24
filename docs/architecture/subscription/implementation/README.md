# Subscription Implementation Plan

> **Status:** Implementation plan — not implemented
>
> **Version:** 1.0
>
> **Audience:** Backend developers implementing Subscription & Billing
>
> **Last Updated:** 2026-09-24

## What this is

The implementation-planning layer of the Subscription & Billing documentation. It converts the reviewed *Kizunia Billing Blueprint* (baseline: branch `docs/suscriptions-payments` at `d90a39e`, 2026-09-24) into repository documentation. The blueprint compared the design documents with the current codebase and produced a plan another engineer can follow without rediscovering the architecture.

The design documents stay authoritative for behavior and architecture:

| Layer | Location | Says |
| --- | --- | --- |
| Product behavior and the decision register | [`docs/project/feature-specification/subscription/`](../../../project/feature-specification/subscription/README.md) | *What* the system does and why |
| Architecture | [`docs/architecture/subscription/`](../README.md) | *How* it is built so it can keep changing |
| Conceptual domain model | [`docs/architecture/domain/subscription/`](../../domain/subscription/README.md) | The entities and their relationships |
| **This directory** | `docs/architecture/subscription/implementation/` | *Where* each documented rule lands in the current code, and *where the documents and the code disagreed* (the IB findings and their rulings) |
| **Engineering roadmap** | [`docs/architecture/subscription/implementation-plan/`](../implementation-plan/README.md) | *In what order* to build it: Phases I–IX, each with scope, acceptance criteria and blockers |

Nothing here is implemented. No application code, Prisma schema or migration has been written or changed.

**Decision close-out (2026-09-24).** Every IB finding has been ruled, or explicitly deferred with a trigger. Each ruling records its **decision authority**: a *product decision (owner)* or an *architecture/technical decision (autonomous)*. See [open decisions](open-decisions.md) and [settled decisions](settled-decisions.md#rulings-from-the-2026-09-24-decision-close-out). Nothing is silently chosen in code: a question that is still open says so, together with the phase it blocks.

## Project status assumptions

Applied when these documents were created (2026-09-24); recorded in [settled decisions](settled-decisions.md#decisions-applied-when-this-documentation-was-created).

- Kizunia is **pre-production**.
- The database will be **created fresh**.
- There are currently **zero users**.
- There is **no legacy-user migration** requirement.
- Consequently the blueprint's finding IB-8 (launch enforcement for existing users) is **withdrawn** and is no longer a production blocker; see [withdrawn findings](open-decisions.md#withdrawn-findings).

## The core principle, restated

Razorpay is the billing provider, not the foundation of membership. Kizunia owns effective access, entitlements, quotas, grants, authorization and application-level subscription state. Free never touches Razorpay, and every check below the provider boundary works when Razorpay has never been configured. See [principles](../principles.md).

## Reading order

| # | Document | Contents |
| --- | --- | --- |
| 1 | README.md | This index: scope, assumptions, reading order, conventions. |
| 2 | [open-decisions.md](open-decisions.md) | The IB findings with their 2026-09-24 rulings and status; the Razorpay, product and configuration items still open. |
| 3 | [settled-decisions.md](settled-decisions.md) | Project-status assumptions; the decisions the plan relies on; the close-out rulings by decision authority. |
| 4 | [architecture-fit.md](architecture-fit.md) | Where subscriptions fit in the existing architecture; dependency rules. |
| 5 | [domain-model.md](domain-model.md) | The conceptual domain model. |
| 6 | [database-design.md](database-design.md) | The mapping onto Prisma/PostgreSQL (descriptive; no schema). |
| 7 | [state-model.md](state-model.md) | The subscription state machine. |
| 8 | [provider-boundary.md](provider-boundary.md) | The narrow Razorpay provider boundary. |
| 9 | [command-model.md](command-model.md) | The command runner, lifecycle and catalog. |
| 10 | [checkout-flow.md](checkout-flow.md) | Free → paid checkout and creation, end to end. |
| 11 | [webhooks.md](webhooks.md) | Webhook ingestion. |
| 12 | [synchronization.md](synchronization.md) | The single synchronization mechanism and its stale-apply guard. |
| 13 | [reconciliation.md](reconciliation.md) | Due-based reconciliation, budget, cooldown, orphan discovery. |
| 14 | [past-due-cancellation.md](past-due-cancellation.md) | The past-due cancellation behavior and its open decision. |
| 15 | [effective-access.md](effective-access.md) | Effective-access computation and authorization wiring. |
| 16 | [entitlements-and-quotas.md](entitlements-and-quotas.md) | Capabilities, quotas, downgrade behavior. |
| 17 | [admin-grants.md](admin-grants.md) | Admin grants. |
| 18 | [feature-integration.md](feature-integration.md) | Per-feature integration paths. |
| 19 | [configuration.md](configuration.md) | Configuration and environment. |
| 20 | [observability-and-operations.md](observability-and-operations.md) | Logs, metrics, alerts, runbook hooks. |
| 21 | [failure-recovery-matrix.md](failure-recovery-matrix.md) | Failure and recovery matrix. |
| 22 | [test-strategy.md](test-strategy.md) | Test strategy. |
| 23 | [implementation-plan.md](implementation-plan.md) | Historical: the blueprint's slices S0–S17, mapped to the phases. The roadmap itself is the [implementation-plan directory](../implementation-plan/README.md). |

## Blueprint section map

The blueprint was a single page with numbered sections. Cross-references such as "§7" in reviews or commit messages map to these files.

| Blueprint section | Where it is now |
| --- | --- |
| Implementation blockers and required decisions | [open-decisions.md](open-decisions.md) |
| §1 Current architecture fit | [architecture-fit.md](architecture-fit.md) |
| §2 Domain model | [domain-model.md](domain-model.md) |
| §3 Database design | [database-design.md](database-design.md) |
| §4 Subscription state model | [state-model.md](state-model.md) |
| §5 Provider boundary | [provider-boundary.md](provider-boundary.md) |
| §6 Billing command model | [command-model.md](command-model.md) |
| §7 Checkout and subscription creation | [checkout-flow.md](checkout-flow.md) |
| §8 Webhook architecture | [webhooks.md](webhooks.md) |
| §9 Synchronization | [synchronization.md](synchronization.md) |
| §10 Reconciliation | [reconciliation.md](reconciliation.md) |
| §11 PAST_DUE cancellation issue | [past-due-cancellation.md](past-due-cancellation.md) |
| §12 Effective access | [effective-access.md](effective-access.md) |
| §13 Entitlements and quotas | [entitlements-and-quotas.md](entitlements-and-quotas.md) |
| §14 Admin grants | [admin-grants.md](admin-grants.md) |
| §15 Existing feature integration | [feature-integration.md](feature-integration.md) |
| §16 Configuration / environment | [configuration.md](configuration.md) |
| §17 Observability / operations | [observability-and-operations.md](observability-and-operations.md) |
| §18 Failure / recovery matrix | [failure-recovery-matrix.md](failure-recovery-matrix.md) |
| §19 Test strategy | [test-strategy.md](test-strategy.md) |
| §20 Implementation order | [implementation-plan.md](implementation-plan.md) |
| §21 A Decisions already settled | [settled-decisions.md](settled-decisions.md) |
| §21 B Open questions | [open-decisions.md](open-decisions.md) |
| §22 Summary for the implementer | This README ([orientation](#orientation)) |
| Preamble (status, baseline, sources) | This README |

## Conventions used in these documents

- **IB-n** identifies a finding from comparing the design documents with the code (for example [IB-1](open-decisions.md#ib-1--past_due-cancellation)). Every IB item is defined once, in [open decisions](open-decisions.md), with its ruling. Numbers are kept stable: IB-8 is withdrawn and not reused; IB-18 to IB-22 were added at the close-out.
- **Decisions referenced here.** A document that depends on IB items names them at the top. Since the 2026-09-24 close-out, the text follows the ruling, not a recommendation.
- **Status vocabulary.** DECIDED · DEFERRED · PROVIDER-DEPENDENT · LIVE BLOCKER · IMPLEMENTATION-TIME, defined in [open decisions](open-decisions.md#status-vocabulary).
- **Rule IDs** (`SB-…`, `A…`, `B…`, `C…`, `D…`) refer to the [decision register](../../../project/feature-specification/subscription/decisions/README.md), the product [open decisions](../../../project/feature-specification/subscription/open-decisions.md) and the [Razorpay facts](../provider-boundary/razorpay-facts.md) ledger.
- **Phases I–IX** are the [phase-wise implementation plan](../implementation-plan/README.md). **Slices S0–S17** are the blueprint's older, finer-grained slices, mapped to phases in [implementation-plan.md](implementation-plan.md).
- **Terminology** is the blueprint's and the design documents': `Subscription` is Kizunia's record of one Razorpay subscription; *phase* is Kizunia's state; *provider status* is Razorpay's; *contributing* and *open* phases are defined in the [state model](state-model.md). See also the product [glossary](../../../project/feature-specification/subscription/glossary.md).
- Code paths such as `lib/entitlements/index.ts:32` were verified against the repository at the baseline commit and may drift; re-verify before relying on a line number.

## Orientation

Build on what is there. `lib/entitlements` becomes the one read-side seam every feature consumes. A new `modules/billing` owns every write, the Razorpay boundary, commands, webhooks and sync. Background work rides the existing tick, using the notification queue's claim-with-lease pattern on the `subscription` row itself. The outbound budget uses the existing `rate_limit` table with one new conditional increment. Denials reuse the reserved `UPGRADE_REQUIRED` and `FEATURE_DISABLED` codes inside the existing `AuthorizationEvaluator` chains. Details: [architecture fit](architecture-fit.md).

The decisions are ruled (2026-09-24). Build in the order of the [phase-wise implementation plan](../implementation-plan/README.md), starting with Phase I (entitlements and admin grants), which needs no Razorpay at all. Things that are still open are tied to the phase they block:

- UPI enablement on the TEST account ([IB-18](open-decisions.md#ib-18--upi-disabled-on-the-razorpay-test-account)): UPI verification, Phases V–VII.
- A stable TEST webhook URL ([IB-20](open-decisions.md#ib-20--a-public-test-webhook-endpoint)): Phase IV.
- The LIVE blockers: Phase IX.

## Related documents

- [Subscription architecture index](../README.md) · [Module boundaries](../module-boundaries.md) · [Verification checklist](../verification-checklist.md)
- [Decision record](../../decisions/subscription-billing.md)
- [Product specification](../../../project/feature-specification/subscription/README.md)

## Keeping this live

When an open decision is ruled, update [open decisions](open-decisions.md), move the ruling to [settled decisions](settled-decisions.md), and update the implementation document that depended on it in the same commit. When a ruling changes a behavior or amends a design document, follow that document's own keep-live rule and record the ruling in the [decision register](../../../project/feature-specification/subscription/decisions/README.md).
