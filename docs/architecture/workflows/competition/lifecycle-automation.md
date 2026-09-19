# Competition Lifecycle Automation

> **Status:** Stable
> **Version:** 1.0
> **Last Updated:** 2026-09-10

## Purpose

This document defines how a Competition's `status` is derived automatically
from its lifecycle dates, and how that automation is triggered, disabled,
previewed and applied.

It supersedes `workflows/hackathon/lifecycle.md`'s published-hackathon
section for automation purposes — that document's four-state chain
(`Upcoming → Registration Open → Registration Closed → Completed`) predates
`ONGOING` and `CANCELLED` on the Prisma enum and does not describe automatic
transitions at all. This document is scoped to the `CompetitionStatus`
enum as it exists today (`UPCOMING`, `REGISTRATION_OPEN`,
`REGISTRATION_CLOSED`, `ONGOING`, `COMPLETED`, `CANCELLED`).

## Context

Before this feature, `status` was set only by hand — the editor's status
dropdown, the admin table's inline select, or the bulk `SET_STATUS` action.
Nothing derived it from `startDate`, `endDate` or `registrationDeadline`, so
a competition's advertised stage silently went stale once its dates passed.

## Decision

Status becomes a *derived* property of time plus lifecycle dates, computed
by one pure function and applied by a nightly sweep and an admin-driven
preview/apply workflow, with a per-competition opt-out
(`automaticStatusUpdatesDisabled`) for cases an administrator needs to pin a
status by hand.

## Not a sequential state machine

Automation does **not** force a competition through every intermediate
state. A competition whose dates already place it well into its lifecycle
jumps directly to the status those dates imply — `UPCOMING → COMPLETED` is a
valid single transition if `endDate` has already passed.

## The lifecycle dates

| Field | Meaning |
|---|---|
| `registrationStartDate` | When registration opens. Nullable — no automatic REGISTRATION_OPEN transition without it. |
| `registrationDeadline` | When registration closes. |
| `startDate` | When the event itself begins. |
| `endDate` | When the event ends. |

## Precedence (first match wins)

```text
0. CANCELLED           currentStatus === CANCELLED           -> unchanged (terminal)
1. COMPLETED           endDate <= now                        -> COMPLETED
2. REGISTRATION_OPEN   registrationStartDate <= now
                       AND (registrationDeadline is null OR registrationDeadline > now)
3. ONGOING             startDate <= now                       -> ONGOING
4. REGISTRATION_CLOSED registrationDeadline <= now             -> REGISTRATION_CLOSED
5. UPCOMING            any lifecycle date is known             -> UPCOMING
6. unchanged           no lifecycle date is known at all       -> unchanged
```

"Reached" (`<=`) is inclusive; its complement (`>`, in rule 2) is strict —
at the exact instant `now` equals `registrationDeadline`, registration is
closed, not still open.

### Why REGISTRATION_OPEN outranks ONGOING

A competition may already have started while registration is still open
(late registration). The status at that point describes the registration
window, not the event, so rule 2 is checked before rule 3:

```text
registrationStartDate <= now
startDate <= now
registrationDeadline > now
=> REGISTRATION_OPEN, not ONGOING
```

### Why ONGOING outranks REGISTRATION_CLOSED

"The event has started" is a stronger signal than "the registration window
is over" whenever both are true — rule 3 is checked before rule 4.

### Missing dates

Every rule names exactly the date(s) it needs and is skipped — never
defaulted, never inferred — when that date is null. **A null
`registrationStartDate` does not mean "registration is always open"**; it
only means rule 2 has no date to evaluate. Every other rule still applies
normally:

```text
registrationStartDate = null
startDate <= now
endDate > now
=> ONGOING   (rule 3 fires regardless of rule 2)
```

If none of the four dates are known, `status` is left exactly as it is
(rule 6) — there is nothing to derive from.

### CANCELLED

CANCELLED is manually controlled. Automatic processing never moves a
competition out of it (rule 0). The only way out is an explicit manual
status change through the admin dropdown or bulk action.

### `status = null`

Null is treated as "no status yet", not CANCELLED — it is fully automatable.
`null -> UPCOMING` (once a date is known) is a real, reportable change.

## `automaticStatusUpdatesDisabled`

- `false` (default): automation applies normally.
- `true`: the nightly sweep, the admin preview/apply workflow, and
  date-edit reconciliation all leave `status` untouched. The manual status
  dropdown/bulk action remain fully usable regardless of this flag — it
  disables *automatic* changes only, never an explicit admin choice.

Flipping `true -> false` triggers an immediate recalculation in the same
request — it does not wait for the next nightly sweep.

## Where reconciliation runs

| Trigger | Entry point |
|---|---|
| Nightly sweep | `POST /api/v1/internal/competitions/lifecycle` (secret-protected; see below) |
| Admin bulk reconciliation | `/admin/competitions/lifecycle` preview + apply |
| A lifecycle date, or the automation flag, changes | `PATCH /admin/competitions/[id]` (immediate, same request) |

All three call the same canonical resolver
(`src/modules/competitions/lifecycle/resolver.ts`,
`resolveAutomaticStatus` / `evaluateLifecycle`) through the same service
(`CompetitionLifecycleService`). None of them re-encode the precedence
rules independently.

### An explicit manual `status` always wins

If a request's payload sets `status` directly, automatic recalculation is
skipped for that request — an admin's explicit choice is never silently
overwritten by the same save that made it.

## Preview / apply (admin console)

`/admin/competitions/lifecycle` shows every competition whose automatically
derived status differs from what is persisted, using the same Competition
filter architecture as the rest of the admin area (`scope="lifecycle"`),
plus two lifecycle-only filters (automation state, registration-opens date
range).

- Preview is read-only.
- An admin may exclude individual rows before applying — exclusion is
  scoped to *that operation only* and never touches
  `automaticStatusUpdatesDisabled`.
- Apply sends competition **ids only**. The server re-reads and
  re-evaluates each one against authoritative state before writing
  anything; it never trusts a client-asserted target status.
- Writes are grouped by `(from -> to)` transition and applied with a
  compare-and-set `updateMany` (`status: from` re-asserted in the `where`),
  so a row that changed state between the read and the write is simply left
  untouched rather than clobbered.

## Cron

`POST /api/v1/internal/competitions/lifecycle` is the nightly sweep's
invocation point. There is no scheduling infrastructure in this repository
(see `docs/architecture/domain/assets/security.md`); the route exists only
to be called by an external scheduler, guarded by comparing the
`x-internal-secret` header against `INTERNAL_LIFECYCLE_SECRET` (fails closed
if unset). It is safe to invoke more than once — a row already at its
correct status is not re-written.

**Before enabling a scheduler against this route in production**: every
existing competition defaults to `automaticStatusUpdatesDisabled = false`,
so the first sweep after this feature ships recalculates the entire table.
Run an unfiltered preview at `/admin/competitions/lifecycle` first and
review every proposed change.

## Audit

`updatedById` means "the last human who updated this competition". Automatic
lifecycle changes (cron, admin bulk apply, date-edit / re-enable
reconciliation) update `statusUpdatedAt` and `updatedAt` but never touch
`updatedById`. `statusUpdatedAt` changes only when the persisted `status`
value actually changes — an ordinary edit that leaves `status` alone never
disturbs it.

## Design Decisions

- **A pure resolver, one call site.** `resolveAutomaticStatus` has no
  database access and no side effects; every consumer goes through
  `CompetitionLifecycleService`, so the precedence rules exist in exactly
  one place.
- **Preview computes actionable changes, not raw filter matches.** Pagination
  and counts describe how many competitions would actually change, not how
  many match the filters — a filter matching 500 rows where only 100 would
  change reports 100.
- **No new scheduling infrastructure.** The internal route follows the
  existing `internal/assets/reconcile` precedent exactly (secret header,
  fails closed, no session-based auth).

## Future Expansion

- Promoting `registrationStartDate` to a public filter and to the public
  competition detail page (deliberately deferred — see the feature's
  implementation plan).
- A `LifecycleAuditLog` if per-transition history (not just the latest
  `statusUpdatedAt`) becomes a requirement.
