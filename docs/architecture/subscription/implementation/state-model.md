# Subscription State Model

> **Status:** Implementation plan — not implemented
>
> **Last Updated:** 2026-09-24
>
> **Blueprint section:** §4 (see the [section map](README.md#blueprint-section-map))

The Kizunia subscription state machine: Razorpay provider status, Kizunia phase and effective contribution kept distinct, every phase, and every valid transition with what causes it.

**Decisions referenced here:** [IB-9](open-decisions.md#ib-9--trial-conversion-gap). All were ruled on 2026-09-24; see [open decisions](open-decisions.md) for each ruling and who made it (product decision (owner) or architecture decision (autonomous)).

---

Three layers, never conflated:

| Layer | Values | Who reads it |
| --- | --- | --- |
| **Razorpay provider status** | `created`, `authenticated`, `active`, `pending`, `halted`, `paused`, `cancelled`, `completed`, `expired` (+ unknown → `MALFORMED`) | `modules/billing/provider` and the apply path only (`providerStatus`) |
| **Kizunia phase** | the 11 below | Billing module; UI via DTO |
| **Effective contribution** | contributing / not | `lib/entitlements` only |

| Phase | Open | Contributes | Terminal | Synced |
| --- | --- | --- | --- | --- |
| `PROVISIONING` | yes | no | no | no (orphan discovery) |
| `PENDING_AUTHENTICATION` | yes | no | no | yes |
| `TRIALING` | yes | **yes** | no | yes |
| `ACTIVE` | yes | **yes** | no | yes |
| `PAST_DUE` | yes | **yes** | no | yes |
| `HALTED` | yes | no | no | yes (decaying) |
| `PAUSED` | yes | no | no | yes |
| `CANCELLED`, `EXPIRED`, `COMPLETED` | no | no | yes | no |
| `ABANDONED` (local only) | no | no | yes | no |

Mapping (applied in one place, `policy/state-mapping.ts`): `created → PENDING_AUTHENTICATION`; `authenticated` + `kind TRIAL` + (future `start_at`, or `start_at` passed but within the trial-conversion grace C7) → `TRIALING`, otherwise `PENDING_AUTHENTICATION`, raising `TRIAL_CONVERSION_OVERDUE` for a trial past the grace (**IB-9, decided**); `active → ACTIVE`; `pending → PAST_DUE`; `halted → HALTED`; `paused → PAUSED`; `cancelled → CANCELLED`; `expired → EXPIRED`; `completed → COMPLETED`; anything else → not applied (`MALFORMED`).

```text
PROVISIONING ─┬─ provider ID bound ─────> PENDING_AUTHENTICATION ─┬─ authenticated (TRIAL, before start_at) ─> TRIALING
              └─ create not applied ───> ABANDONED               ├─ authenticated + active (STANDARD) ──────> ACTIVE
                                                                 ├─ expire_by passed ───────────────────────> EXPIRED
                                                                 └─ abandon-checkout cancel ────────────────> CANCELLED

TRIALING ─── converts ───────────> ACTIVE          TRIALING ─── first charge fails ───> PAST_DUE
ACTIVE ───── renewal fails ──────> PAST_DUE ─── retries exhausted ───> HALTED ─── customer recovers ───> ACTIVE
PAST_DUE ─── retry succeeds ─────> ACTIVE
ACTIVE ───── paused ─────────────> PAUSED ───── resumed ─────────────> ACTIVE
ACTIVE ───── last cycle billed ──> COMPLETED
any open phase ─── cancellation observed ───> CANCELLED
```

Transitions (from `state-mapping.md`, plus the local ones):

| From | To | Cause | Kind of transition |
| --- | --- | --- | --- |
| — | `PROVISIONING` | Start-checkout command, before the provider call | Local write (the only phase written without an observation) |
| `PROVISIONING` | `PENDING_AUTHENTICATION` (or any phase the bound entity shows) | Create response bound; or orphan discovery / webhook `notes.kz_sub` match | Binding + applied observation |
| `PROVISIONING` | `ABANDONED` | Create `REJECTED`/`BUDGET_EXHAUSTED` (nothing sent or refused), or `OUTCOME_UNKNOWN` create whose orphan window closed unmatched | Local |
| `PENDING_AUTHENTICATION` | `TRIALING` / `ACTIVE` | Checkout authenticated (confirm, webhook or sync) | Observation |
| `PENDING_AUTHENTICATION` | `EXPIRED` | `expire_by` passed (lag 156–322 s observed, A8/D6) | Observation |
| `PENDING_AUTHENTICATION` | `CANCELLED` | Abandon-checkout cancel (reuse with a different plan) | Observation after command |
| `TRIALING` | `ACTIVE` / `PAST_DUE` / `CANCELLED` | Conversion / first charge fails (A7, inferred) / immediate cancel | Observation |
| `ACTIVE` | `PAST_DUE` / `CANCELLED` / `PAUSED` / `COMPLETED` | Renewal fails / cancel took effect / Dashboard or UPI pause / end of cycles | Observation |
| `PAST_DUE` | `ACTIVE` / `HALTED` / `CANCELLED` | Retry succeeds / retries exhausted / cancel | Observation |
| `HALTED` | `ACTIVE` / `CANCELLED` | Customer recovers outside Kizunia / supersession or Dashboard | Observation |
| `PAUSED` | `ACTIVE` / `CANCELLED` | Resume / cancel | Observation |
| any terminal | anything | — | **Never applied**: anomaly and alert |

Any other transition Razorpay reports between open phases **is applied** (Razorpay is authoritative), and is logged as unusual. Derived display facets sit on top of the phase, never as phases: `cancelAtPeriodEnd`, the scheduled change, "last change still confirming" (a young `OUTCOME_UNKNOWN` operation), and "on hold" (`HALTED`).

---

## Related documents

**In this directory**

- [Domain Model](domain-model.md)
- [Synchronization](synchronization.md)
- [PAST_DUE Cancellation](past-due-cancellation.md)
- [Open decisions](open-decisions.md) · [Settled decisions](settled-decisions.md) · [Index](README.md)

**Design and specification**

- [State mapping](../lifecycle/state-mapping.md)
- [Lifecycle overview](../lifecycle/README.md)
- [Multiple subscriptions](../lifecycle/multiple-subscriptions.md)
- [Razorpay facts — lifecycle states](../provider-boundary/razorpay-facts.md#lifecycle-states)
