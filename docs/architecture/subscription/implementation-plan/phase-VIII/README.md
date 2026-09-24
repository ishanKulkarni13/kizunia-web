# Phase VIII — Admin Billing Tools and Operations

> **Status:** Not started
>
> **Depends on:** Phase IV (it grows with V–VII) · **Razorpay needed:** TEST · **Old slice:** S15

## Objective

Give support and operators what the [operations runbook](../../cross-cutting/operations-runbook.md) assumes exists, so that every billing question ("why does this user have this access?", "what happened to this subscription?", "is billing healthy?") can be answered and acted on without database access.

## Scope

- **Explain access:** the resolver's explain output for any user: sources, phases, grants, and mode.
- **Billing timeline** per user or subscription: history entries, operations, events (metadata; raw payloads for `SUPER_ADMIN` only), and money facts.
- **Anomalies:** list, detail, and **resolve with a reason**. Resolving records a human decision and never changes billing state by itself.
- **Bulk re-sync:** mark matching subscriptions due at P3 (optionally filtered by `lastSyncedAt < t`).
- **Health summary** (`GET /api/v1/admin/billing/health`) computed from tables:
  - subscriptions by phase;
  - due-backlog age;
  - open anomalies by type;
  - `OUTCOME_UNKNOWN` count and age;
  - the last `billing:sync` result;
  - cooldown state;
  - the last webhook received per mode;
  - the provider mode.
- **Payload pruning** (`billing:payload-prune`): null `rawPayload` older than the retention horizon (180 days, the B3 default), in bounded batches.
- **Runbook alignment:** every runbook procedure maps to a tool that exists, and the runbook is corrected where the tools differ.

"Sync now" (Phase IV) and admin immediate cancel (Phase VI) are already built. This phase gives them a home in the admin billing UI.

## Architectural components involved

`modules/billing/backend/admin.controller.ts` and its services; the resolver's explain function; history, anomaly and event repositories; the internal-jobs registry; admin UI under `app/(dashboard)/admin/billing/**`.

## Dependencies

Phase IV (history, anomalies, events, sync). Checkout, lifecycle and promotion views appear as Phases V–VII land.

## Files and modules likely affected

Paths are relative to `next/src/`.

- `modules/billing/backend/{admin.controller,admin/*}.ts`, `backend/reconciliation/payload-prune.ts`.
- `app/api/v1/admin/billing/**`, `app/api/v1/internal/billing/payload-prune/route.ts` (optional manual route).
- `app/(dashboard)/admin/billing/**`.
- `docs/architecture/subscription/cross-cutting/operations-runbook.md`.

## Database and schema work

None.

## Domain and application work

- Views are read-only apart from these recorded actions:
  - anomaly resolution (with reason and actor);
  - bulk re-sync (a mark-due, never a provider mutation);
  - payload pruning (nulling content, never deleting rows).
- Raw payloads are shown only to `SUPER_ADMIN`, and are never logged.

## Provider work

None new. Bulk re-sync spends the P3 budget.

## Integration work

- Links from anomaly alerts (`billing.alert`) to the admin views.
- The runbook cross-references each tool.

## Authorization and entitlement implications

Role mapping per [IB-15](../../implementation/open-decisions.md#ib-15--billing-admin-roles) (product decision (owner)):

| Tool | Action | Roles |
| --- | --- | --- |
| Explain, timeline, anomaly list, health, sync now | `VIEW_BILLING` | `ADMIN`, `SUPER_ADMIN` |
| Resolve anomaly, bulk re-sync, admin immediate cancel | `MANAGE_BILLING` | `SUPER_ADMIN` |
| Raw payload view | — | `SUPER_ADMIN` only |

The platform bypass never confers billing-admin actions implicitly.

## Concurrency and transaction considerations

- Anomaly resolution uses a conditional update on the open row. A concurrent re-detection creates a new open row after resolution, by design of the partial unique index.
- Pruning runs in bounded batches, with no long transactions.

## Observability requirements

- `anomaly.resolved` events with actor and reason.
- Admin actions logged with actor.
- The health endpoint is the metrics substitute until the Phase IX alert channel exists.

## Testing requirements

**Integration:**
- role checks for every tool (`ADMIN` view-only, `MODERATOR` denied, raw payload `SUPER_ADMIN` only);
- anomaly resolve then re-detect;
- bulk re-sync marks rows due without a provider call;
- the prune nulls only old payloads and keeps rows.

**Unit:** health aggregation.

## Acceptance criteria

- [ ] Every procedure in the operations runbook can be performed with a tool from this phase or an earlier one, with no manual SQL.
- [ ] An `ADMIN` can diagnose ("explain", timeline, health) but cannot change billing. A `SUPER_ADMIN` can resolve, re-sync and cancel with a reason.
- [ ] Raw payloads never appear to non-`SUPER_ADMIN` users or in logs.
- [ ] Payload pruning honors the retention default and never deletes rows.

## Explicit non-goals

- Refund issuing (done in the Razorpay Dashboard, recorded as facts).
- A metrics backend.
- The alert delivery channel (Phase IX).
- The account-removal workflow (deferred).

## Decisions that must already be settled

IB-15 (DECIDED). B3 retention: the 180-day default applies, and B3 stays DEFERRED.

## Risks and blockers

- **Risk:** exposing personal data in raw payloads. Mitigated by the role gate and the no-logging rule.
- **Blockers:** none.

## Expected output

The admin billing UI and API (explain, timeline, anomalies, bulk re-sync, health); the payload-prune task; an aligned runbook; tests.
