# Architectural Principles

> **Status:** Stable
>
> **Last Updated:** 2026-09-12

The rules this subsystem is held to. Every design decision in this directory should be traceable to
one of them.

---

## 1. Build a platform, not a competition feature

> **Build Notifications as a replaceable, composable subsystem rather than as a collection of
> competition-specific notification features.**

Phase 1's two intents are both about competitions. That is a fact about Phase 1, not about the
subsystem. The first non-competition intent — portfolio contact notifications are the likely
candidate — should require no structural change.

Concretely: nothing in the pipeline, context, persistence or delivery layers may assume the subject
of a notification is a competition.

---

## 2. Optimize for changeability

The architecture should make it cheap to change:

```text
what is evaluated  ->  how it is evaluated  ->  what gets selected  ->  why it is notified
->  how it is aggregated  ->  whether it is allowed  ->  how it is delivered  ->  how it is tracked
```

without repeatedly rewriting the notification system.

Assume this subsystem will be heavily redesigned over time. A design that is optimal for today's
two intents and hostile to a third is the wrong design.

---

## 3. Recommendation and notification are separate responsibilities

```text
Recommendation  ->  "What should be recommended to this user?"
Notification    ->  "Should this recommendation become a notification, and how is it handled?"
```

Conceptually:

```text
Recommendation -> Notification Decision -> Notification -> Delivery
```

**The recommendation system must not own notification delivery.**
**The notification system must not own the competition relevance algorithm.**

This is the boundary that makes the relevance algorithm replaceable at all.

---

## 4. Composable stages over a monolithic service

The processing model is a sequence of composable stages, each with a clearly defined
responsibility, operating on shared context.

Stages must be:

- composable
- independently testable
- replaceable
- reorderable where valid
- extensible
- able to consume context produced by earlier stages
- able to contribute context for later stages

The inspiration is a filter-chain architecture in the style of Spring Security — the architectural
property, not the implementation. See [`pipeline/filter-chain.md`](pipeline/filter-chain.md).

**This does not mean one class per arrow in a diagram.** Boundaries are chosen from the actual
Kizunia architecture, not from the shape of a flowchart.

---

## 5. Intent is the extensibility boundary

Adding a notification type should primarily mean **adding new behavior**, not modifying a central
service that accumulates conditionals.

Explicitly rejected as the fundamental extensibility mechanism:

```text
if type === TOP ... else if type === REGISTRATION ... else if type === ...
```

See [`intents/intent-contract.md`](intents/intent-contract.md).

---

## 6. Algorithms are replaceable, independently

Relevance scoring, ranking, selection and aggregation are expected to evolve. Changing any of them
must not require changes to:

- notification persistence;
- notification delivery;
- notification preferences;
- queueing;
- unrelated notification intents.

The current relevance algorithm should be replaceable by another deterministic algorithm, a more
sophisticated scorer, an ML model, an experiment variant, or a feature-flagged implementation.

Think in terms of **policies and strategies that evolve independently**, not fixed implementations.
See [`recommendation/scoring-strategy.md`](recommendation/scoring-strategy.md).

---

## 7. Generation is separate from delivery

> **Should a notification exist?** is a different question from **how is that notification
> delivered?**

A notification may be generated first and delivered asynchronously afterwards:

```text
Notification decision -> Notification generation -> Queue -> Delivery
```

This separation is the foundation for asynchronous delivery, retries, additional channels, delivery
status tracking and future clients — and it is why the subsystem is not coupled to the web
frontend. See [`delivery/generation-vs-delivery.md`](delivery/generation-vs-delivery.md).

---

## 8. Triggers are not logic

Different intents use different trigger mechanisms — a scheduled discovery sweep, a scheduled
deadline evaluation, a future admin action or domain event.

The trigger mechanism must remain separate from the underlying notification logic. The same
business logic must be reusable whether execution was initiated by a scheduled job, an admin
action, a domain event, or a future trigger.

See [`triggers/README.md`](triggers/README.md).

---

## 9. No competition-notification god service

The architecture must avoid one large competition-specific notification service owning every
competition notification rule.

A service that gradually accumulates top recommendations, registration deadlines, registration
events, cancellations, competition updates and future notifications becomes difficult to reason
about and impossible to change safely.

Notification capabilities remain modular and independently composable.

---

## 10. The context is typed and owned, not a bag

The pipeline has a well-defined processing context that carries information accumulated during
processing. A stage may read existing context, add context, and make a decision within its
responsibility.

**Do not create an untyped "god object" containing arbitrary data from every subsystem.** The
context must have clear ownership and contracts so that it remains understandable as the pipeline
grows. See [`pipeline/processing-context.md`](pipeline/processing-context.md).

---

## 11. Leave room for flags, entitlements and analytics — build none of them

It must be possible to make a notification capability feature-flagged, user-specific,
experiment-specific or plan-dependent without invasive change. It must be possible to add richer
tracking without contaminating core notification business logic.

**Do not implement a monetization system, an experiment framework, or an analytics pipeline now.**
The requirement is that adding them later is cheap.

See [`cross-cutting/README.md`](cross-cutting/README.md).

---

## 12. Testing is an architectural requirement

Testing is a design constraint, not a phase that follows implementation. If a business rule cannot
be tested without running the whole pipeline, the boundaries are wrong.

See [`testing/README.md`](testing/README.md).

---

## 13. Every abstraction must justify itself

The target is enterprise-grade architecture. That does not mean:

> "Create 40 interfaces because interfaces are enterprise."

Nor does it mean:

> "Put everything in one notification service because Phase 1 is small."

The desired architecture is:

> **Deeply modular where change is expected, simple where change is not expected.**

An abstraction that exists because a category of change is genuinely anticipated is justified. One
that exists because it looked professional is not.

---

## 14. Phase 1 stays small

The architecture is designed for substantial future growth. Phase 1 behavior remains limited to
`TOP_RELEVANT_COMPETITION` and `REGISTRATION_CLOSING`.

> **Do not implement future functionality simply because the architecture supports it.**

We are designing the foundation for future evolution, not implementing the roadmap early. See
[`phase-1/boundaries.md`](../../project/feature-specification/notification/phase-1/boundaries.md).
