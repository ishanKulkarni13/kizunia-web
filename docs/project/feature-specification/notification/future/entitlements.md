# Future Entitlements and Feature Flags

> **Status:** Direction only — none of this is implemented
>
> **Last Updated:** 2026-09-12
>
> **Story:** US-31

Some notification capabilities are expected to be available only to users whose plan provides
them. **No entitlement system exists, and the subscription domain is not designed.**

---

## What was identified

Capabilities flagged during design as *potentially* paid:

- Relevant competition notifications
- Portfolio contact notifications ([`notification-intents.md`](notification-intents.md))

"Potentially" is the operative word. No decision has been made about what is paid, and this list
must not be read as a plan.

---

## The requirement on the architecture

The notification subsystem should support **entitlements**, while the subscription system itself
remains future scope.

Concretely, it should be possible to make a notification capability:

- feature-flagged;
- user-specific;
- experiment-specific;
- subscription or paid-plan dependent;
- entitlement dependent;

without invasive changes across the system. Adding *"this notification type is available only to
Pro users"* should not require touching the pipeline, persistence, delivery or unrelated intents.

The same applies to feature flags and gradual rollout.

**Do not implement a monetization system now.** The requirement is that adding one later is cheap,
not that it is anticipated in code.

See
[`feature-flags-and-entitlements.md`](../../../../architecture/notifications/cross-cutting/feature-flags-and-entitlements.md).

---

## Where the seam already exists conceptually

The Phase 1 intent flow includes a user-eligibility stage that already asks whether *"the required
capability is available"* alongside whether the intent is enabled and whether a preference profile
exists
([`intents/top-relevant-competition.md`](../intents/top-relevant-competition.md)).

In Phase 1 that check is trivially satisfied for everyone. It is named in the flow so that the
place where an entitlement check belongs is identified before there is anything to check.

**Open:** whether Phase 1 leaves a concrete seam — an interface with a permissive default — or
simply avoids designs that would obstruct one later. See
[`open-decisions.md`](../open-decisions.md).

---

## Subscription notifications

**Story:** US-30

Users would want notifications about their own subscription — expiry being the obvious example.

**Position:** leave architectural space for them without designing the subscription domain now.
When the subscription domain exists, subscription notifications become an ordinary intent with the
same contract as any other ([`intents/README.md`](../intents/README.md)).

---

## Entitlements are not preferences

Worth stating before either is built, because they are easy to conflate:

| | Preference | Entitlement |
| --- | --- | --- |
| Answers | Does the user **want** this? | Is the user **allowed** this? |
| Set by | The user | Their plan |
| When it changes | Whenever the user decides | When their plan changes |
| Effect of absence | The user does not receive it | The user cannot enable it |

A disabled preference and an unavailable entitlement both result in no notification, but they are
different states and must not be collapsed into one flag. A user who loses an entitlement and later
regains it should find their preference as they left it.
