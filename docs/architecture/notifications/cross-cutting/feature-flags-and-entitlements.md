# Feature Flags and Entitlements

> **Status:** Direction — not implemented
>
> **Last Updated:** 2026-09-24 (Subscription & Billing decisions IB-2 and IB-16 recorded)

The architecture should leave room for notification functionality to become:

- feature-flagged
- user-specific
- experiment-specific
- subscription or paid-plan dependent
- entitlement dependent

> **Do not implement a complete monetization system now.**

But do not architect the subsystem so that adding *"this notification type is available only to Pro
users"* requires invasive changes across the system. The same applies to feature flags and gradual
rollout.

---

## Where the seam already is

The Phase 1 intent flow names, at the user-eligibility stage:

```text
Eligible user
  -> notification preference enabled
  -> competition preference profile exists
  -> required capability is available      <-- here
```

In Phase 1 that last check is satisfied for everyone. It exists in the flow so that the place an
entitlement or flag check belongs is identified **before** there is anything to check
([`../pipeline/stages.md`](../pipeline/stages.md)).

**Open item A-9:** whether Phase 1 builds a concrete capability check with a permissive default, or
simply avoids designs that would obstruct one later
([`open-decisions.md`](../../../project/feature-specification/notification/open-decisions.md)).

**Subscription & Billing fills this seam (decided 2026-09-24,
[IB-2](../../subscription/implementation/open-decisions.md#ib-2--recommendation-gate-point)):**

| Intent | Required capability | Plans |
| --- | --- | --- |
| `REGISTRATION_CLOSING` (deadline notifications) | deadline notifications | Pro, Pro+ |
| `TOP_RELEVANT_COMPETITION` (competition recommendations) | recommendations | Pro+ |
| `FEATURE_ANNOUNCEMENT`, `ADMIN_COMPETITION_SUGGESTION` | none (unchanged) | all |

- The **primary** check is here, at user eligibility: a set-based predicate in the scheduler's
  eligible-user query, so users who are not entitled produce no candidates.
- The job handler / `NotificationPolicyService` and delivery **re-check** it, exactly as they already
  re-check the preference. This is a guard against entitlement lost between scheduling and sending,
  not the gate, so it does not contradict "at delivery" in the wrong-places table below.
- A failed check is suppressed with the new reason `NOT_ENTITLED`.
- The recommendation engine itself is never gated: it also serves the Pro deadline intent.
- There is no admin bypass, because a background job has no actor
  ([IB-7](../../subscription/implementation/open-decisions.md#ib-7--admin-bypass-of-entitlement-gates)).

---

## Why user eligibility is the right place

It is the earliest stage and it short-circuits everything. A user without a capability produces no
candidates, so no scoring, no generation and no delivery happen for them — which is both correct
and the cheapest possible rejection.

The wrong places, and why:

| Wrong place | Failure |
| --- | --- |
| At delivery | Work is done for a user who was never entitled to it |
| Inside each intent | Every intent reimplements the check; they drift |
| In the trigger | Scope becomes trigger-specific; an admin path bypasses it |
| In the UI only | The server generates notifications nobody is entitled to |

---

## Entitlements are not preferences

The distinction must survive into storage
([`../persistence/preference-storage.md`](../persistence/preference-storage.md)):

| | Preference | Entitlement |
| --- | --- | --- |
| Answers | Does the user **want** this? | Is the user **allowed** this? |
| Set by | The user | Their plan |
| Changes when | The user decides | The plan changes |
| Absence means | Not sent | Cannot be enabled |

Both produce "no notification", which is exactly why they get collapsed into one flag and should
not be. A user who loses an entitlement and regains it should find their preference as they left
it.

**Decided 2026-09-24 ([IB-16](../../subscription/implementation/open-decisions.md#ib-16--preferences-for-non-entitled-intents)):**
"Absence means cannot be enabled" above describes the *effect*, not a storage rule.

- A user may store a preference for an intent they are not entitled to; the toggle is always saved.
- The preferences DTO carries a server-computed `entitled` flag per intent, and the UI shows
  "requires Pro / Pro+".
- Nothing is delivered until the user is entitled.

---

## What was identified as potentially paid

From the design discussions, and flagged as *potential* rather than decided:

- relevant competition notifications;
- portfolio contact notifications.

No decision has been made. See
[`future/entitlements.md`](../../../project/feature-specification/notification/future/entitlements.md).

---

## Feature flags and experiment variants

The same seam serves gradual rollout and experiments, with one additional requirement: **strategy
selection must be resolvable per evaluation, not fixed at startup**
([`../recommendation/scoring-strategy.md`](../recommendation/scoring-strategy.md)).

A relevance algorithm chosen once at boot cannot be varied per user, which rules out both
percentage rollout and A/B testing. Keeping resolution per-evaluation is cheap now and expensive to
retrofit.

Note the dependency: an experiment is not analysable unless the run records which variant produced
the result — tracking that does not exist yet
([analytics-and-tracking.md](analytics-and-tracking.md)).

---

## What not to build now

| Do not build | Instead |
| --- | --- |
| A subscription or billing domain | Assume a capability answer comes from somewhere |
| An experiment assignment framework | Keep strategy resolution per-evaluation |
| A flag management system | A single capability check point is enough |
| Plan tiers in the notification model | Notifications asks whether a capability is available; it does not model plans |
