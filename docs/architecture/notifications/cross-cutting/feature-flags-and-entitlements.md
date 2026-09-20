# Feature Flags and Entitlements

> **Status:** Direction — not implemented
>
> **Last Updated:** 2026-09-12

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
