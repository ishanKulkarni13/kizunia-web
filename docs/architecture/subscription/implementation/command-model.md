# Billing Command Model

> **Status:** Implemented in Phase V (2026-09-25): `backend/commands/command-runner.ts`. Rulings made while implementing: [IB-25](open-decisions.md#ib-25--phase-v-implementation-rulings)
>
> **Last Updated:** 2026-09-24
>
> **Blueprint section:** §6 (see the [section map](README.md#blueprint-section-map))

The application command model: the single command runner, the ordered command lifecycle (record before calling, never retry blindly), composed commands, the command catalog with preconditions, and how an unknown outcome is resolved by observation.

**Decisions referenced here:** [IB-1](open-decisions.md#ib-1--past_due-cancellation), [IB-6](open-decisions.md#ib-6--composed-commands-and-the-in-flight-constraint). All were ruled on 2026-09-24; see [open decisions](open-decisions.md) for each ruling and who made it (product decision (owner) or architecture decision (autonomous)).

---

One runner, `backend/commands/command-runner.ts`, implements the documented lifecycle. Each command supplies `preconditions(tx, state)`, `call(provider)` and `settle(observation)`.

```text
1 authorize        user: SessionService.getStrictActor; userId only from session
                   admin: PlatformAuthorizer.can(MANAGE_BILLING) (+ reason required)
                   isBillingProviderEnabled() else 503 BILLING_UNAVAILABLE (nothing written)
2 idempotency      find (userId, key): SUCCEEDED/REJECTED -> recorded result; IN_FLIGHT/UNKNOWN -> 202 "in progress" + op id
3 begin (tx A)     expire this user's lapsed IN_FLIGHT root op -> OUTCOME_UNKNOWN (cheap self-heal)
                   refuse if an OUTCOME_UNKNOWN op younger than the resolution window exists (409)
                   refuse customer commands if an open MULTIPLE_OPEN_SUBSCRIPTIONS anomaly exists for the user
                   INSERT BillingOperation(IN_FLIGHT, leaseUntil)   -- P2002 on partial index -> 409
                   preconditions against local state -> fail: same tx marks op REJECTED, typed error
                   CREATE only: INSERT Subscription(PROVISIONING, kind, mode, plan, cycle)
                   COMMIT
4 budget           priority 1; none -> tx: op REJECTED(BUDGET_EXHAUSTED), sub ABANDONED; "billing is busy"
5 call             requestSentAt := now (persisted in the settle tx); bounded timeout; NO tx held
6 classify         SUCCESS | REJECTED | OUTCOME_UNKNOWN (per the taxonomy table in operation-model.md)
7 settle (tx B)    SUCCESS: apply entity via the sync apply path (observationAt = requestSentAt),
                            command-specific writes (bind ID / cancelAtPeriodEnd / scheduled change),
                            mark sync-due (COMMAND_CONFIRM), op SUCCEEDED, history cause KIZUNIA_COMMAND
                   REJECTED: op REJECTED (+ failureClass, provider code); maybe mark sync-due; CREATE -> ABANDONED
                   UNKNOWN : op OUTCOME_UNKNOWN; update/cancel -> mark sync-due; create -> left PROVISIONING
8 respond          local state after tx B (never optimistic)
```

**Composed commands (IB-6, decided):** a root operation (`SUPERSEDE`, `CHANGE_PLAN`) takes the per-user slot; children (`parentOperationId` set) run sequentially under it. Each child is recorded and a failed child stops the root. A step that needs "confirmed by sync" does one targeted immediate sync inside the request (priority 1). If the confirmation is not yet visible, the root ends `SUCCEEDED` for the steps completed and returns `CONFIRMING`. The user's next request (a new idempotency key) re-evaluates preconditions from local state and proceeds when the old subscription is observed terminal. No hidden continuation job exists; background processes never mutate (SB-RC-10).

| Command | Actor | Preconditions (local, inside tx A) | Provider call(s) | Settled by |
| --- | --- | --- | --- | --- |
| **StartCheckout** (`CREATE_SUBSCRIPTION`) | user | Provider enabled; reuse/uniqueness table ([checkout flow](checkout-flow.md)); trial eligibility if TRIAL; code eligibility | `createSubscription` | Bind + apply → `PENDING_AUTHENTICATION` |
| **ConfirmCheckout** | user | Caller owns a `PENDING_AUTHENTICATION` sub | none (read-only trigger): verify signature, mark due, targeted sync at priority 2 | Sync |
| **AbandonCheckout** (child of StartCheckout reuse) | user | Existing `PENDING_AUTHENTICATION`, different plan/cycle or expired | `cancelSubscription(atCycleEnd:false)` | Sync shows `cancelled`/`expired` |
| **ChangePlan** (`CHANGE_PLAN` → `CANCEL_SCHEDULED_CHANGE`? → `UPDATE_PLAN`) | user | Phase `ACTIVE` (or `TRIALING` for upgrades); no `cancelAtPeriodEnd`; target ≠ current; no open anomaly; the plan-change **strategy policy** returns `NATIVE_UPDATE` (V1 strategies: `NATIVE_UPDATE`, `UNAVAILABLE`; a later `SWITCH` is added here, [IB-21](open-decisions.md#ib-21--plan-change-extensibility)) | `now` for upgrades, `cycle_end` for downgrades | Sync: plan (or pending change) equals target |
| **Cancel** (customer) | user | `ACTIVE` → `CANCEL_AT_CYCLE_END`; `TRIALING` → `CANCEL_IMMEDIATELY`; `PENDING_AUTHENTICATION` → abandon; **`PAST_DUE` → `CANCEL_IMMEDIATELY`** (IB-1, decided); `HALTED`/`PAUSED` → immediate only; terminal → refused; pending scheduled change cancelled first (parent) | `cancelSubscription` | See [PAST_DUE cancellation](past-due-cancellation.md) for cycle-end |
| **AdminCancelImmediately** | admin | Any open phase; reason | `cancelSubscription(false)` | Sync shows `cancelled` |
| **Supersede** (`SUPERSEDE` → `CANCEL_IMMEDIATELY` → confirm → `CREATE_SUBSCRIPTION`) | user | Open sub is `HALTED`/`PAUSED`; request carries `supersedesSubscriptionId` + explicit confirmation | Immediate cancel, fetch, create | Old `CANCELLED` observed → `supersededById` + history `SUPERSESSION` → create |
| **Recover (HALTED)** | user | — | none: client opens Razorpay's card-change Checkout; Kizunia offers "check now" = ConfirmCheckout-style sync trigger | Sync |
| **Admin grant/revoke** | admin | Not a billing command: no BillingOperation, no provider | — | Grant audit ([admin grants](admin-grants.md)) |
| **Sync now / bulk re-sync** | admin | Not a command: marks due (priority 1 / 3) | fetch only | Sync |

**Operation-slot rules (IB-6, decided).** Admin commands take the same per-user root slot as customer commands. Every user-facing mutating endpoint requires an `Idempotency-Key` header, unique per `(userId, idempotencyKey)`. The app has no such convention yet, so billing introduces it; the key format is chosen at implementation time.

**`OUTCOME_UNKNOWN` resolution** is always observation. The apply path settles a pending operation whenever an observation proves or disproves it (plan equals target; `cancelled`; `has_scheduled_changes=false`). Creates are settled by binding (orphan scan or webhook) or by the closed window. An operation still unresolved past the alert threshold emits `billing.alert OPERATION_OUTCOME_UNKNOWN`.

---

## Related documents

**In this directory**

- [Database Design](database-design.md)
- [Provider Boundary](provider-boundary.md)
- [Checkout and Subscription Creation](checkout-flow.md)
- [Synchronization](synchronization.md)
- [PAST_DUE Cancellation](past-due-cancellation.md)
- [Open decisions](open-decisions.md) · [Settled decisions](settled-decisions.md) · [Index](README.md)

**Design and specification**

- [Commands overview](../commands/README.md)
- [Operation model](../commands/operation-model.md)
- [Cancellation](../lifecycle/cancellation.md)
- [Upgrade and downgrade](../lifecycle/upgrade-downgrade.md)
- [Multiple subscriptions](../lifecycle/multiple-subscriptions.md)
- [Rulings — commands and idempotency](../../../project/feature-specification/subscription/decisions/commands-and-idempotency.md)
