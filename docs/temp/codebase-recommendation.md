## Notification feature — engineering requirements

The Notifications system should be treated as a **first-class, independently maintainable subsystem** of Kizunia.

This is not intended to be a small feature implemented around the current Phase 1 use cases.

The Phase 1 behavior is small, but the **architecture must be designed for substantial future evolution**.

### 1. Independent module

Notifications should exist as a **separately bounded module/domain**.

The notification subsystem should have clear ownership of its own:

- domain concepts
- business rules
- notification intents/types
- preference handling
- candidate processing
- filtering
- relevance/ranking integration
- notification generation
- notification history
- delivery orchestration
- future analytics/tracking extensions

It should communicate with other Kizunia domains through **well-defined boundaries**, rather than spreading notification-specific logic throughout competitions, users, bookmarks, etc.

Do not turn existing competition services/models into “notification services.”

The competition domain should remain responsible for competitions.

The notification domain should consume the information it needs.

---

### 2. Designed for heavy evolution

Assume that this subsystem will be **heavily redesigned and modified over time**.

The architecture should tolerate changes such as:

- completely changing notification algorithms
- changing relevance/scoring algorithms
- replacing ranking logic
- introducing an ML model at any stage
- adding/removing notification types
- changing notification delivery mechanisms
- adding new delivery channels
- changing aggregation rules
- introducing paid notification features
- introducing feature flags
- adding analytics
- adding detailed tracking
- changing notification limits
- changing eligibility rules
- introducing new filtering stages
- changing priorities between notification types
- adding event-driven notifications
- adding new clients such as Expo/mobile
- changing how notifications are presented to users

These should be possible **without requiring a rewrite of the entire subsystem**.

The architecture should optimize for **changeability**, not merely today's functionality.

---

### 3. Pipeline / filter-chain architecture

The notification processing model should be strongly inspired by systems such as **Spring Security's filter-chain architecture**.

The goal is not to copy Spring Security's implementation.

The goal is to adopt the architectural property:

> **A sequence of composable processing stages, each with a clearly defined responsibility, operating on shared context and allowing the pipeline to evolve.**
> 

A notification evaluation should conceptually move through a chain.

For example:

**Trigger → Context → Eligibility → Candidate Selection → Filters → Preference Matching → Relevance → Ranking → Selection → Notification Policy → Generation → Delivery**

This is conceptual.

Do **not** blindly create one class/service per arrow.

Instead, determine appropriate boundaries based on the actual Kizunia architecture.

The important property is that stages should be:

- composable
- independently testable
- replaceable
- reorderable where valid
- extensible
- capable of consuming previous context
- capable of contributing context for later stages

A future filter should be able to use information produced earlier without creating tight coupling between unrelated components.

---

### 4. Full processing context

The pipeline should have a well-defined **notification processing context**.

The context should carry the information accumulated during processing.

A stage/filter may:

**Read existing context**

→ use information produced by previous stages.

**Add context**

→ make useful information available to later stages.

**Make a decision**

→ allow/reject/modify processing according to its responsibility.

The context itself should be designed carefully.

Do not create an untyped/unstructured “god object” containing arbitrary data from every subsystem.

The context should have clear ownership and contracts so that it remains understandable as the pipeline grows.

---

### 5. Replaceable algorithms

Algorithms must not become inseparable from notification orchestration.

For example, the current relevance algorithm should be replaceable by:

- another deterministic algorithm
- a more sophisticated scoring system
- an ML-based relevance model
- an experiment/A-B variant
- a feature-flagged implementation

without rewriting notification generation and delivery.

Similarly, selection/ranking/aggregation should not be permanently coupled to one implementation.

Think in terms of **policies/strategies that can evolve independently**.

---

### 6. Notification intent/type as an extensibility boundary

`TOP_RELEVANT_COMPETITION` and `REGISTRATION_CLOSING` are only the first notification types.

The system should be capable of eventually supporting things such as:

- competition opened
- competition updated
- competition cancelled
- competition starting
- competition completed
- personalized recommendations
- admin-triggered notifications
- future notification types we have not designed yet

Adding a new notification type should primarily involve **adding the new behavior**, not modifying a giant central notification service containing an ever-growing chain of conditionals.

Avoid architecture such as:

> `if type === TOP ... else if type === REGISTRATION ... else if type === ...`
> 

as the fundamental extensibility mechanism.

---

### 7. Notification generation and delivery must remain separate

The system should conceptually distinguish:

**Should a notification exist?**

from:

**How is that notification delivered?**

A notification can be generated independently of the eventual delivery mechanism.

This is important because Kizunia is:

**Phase 1 → Web**

but may later support:

**Expo/mobile**

and potentially additional channels.

The notification domain should therefore not be tightly coupled to one frontend/client.

---

### 8. Feature flags and entitlements must be possible

The architecture should leave room for notification functionality to become:

- feature-flagged
- user-specific
- experiment-specific
- subscription/paid-plan dependent
- entitlement dependent

Do not implement a complete monetization system now.

But don't architect the notification subsystem so that adding:

> “This notification type is available only to Pro users”
> 

requires invasive changes across the system.

The same applies to feature flags and gradual rollout.

---

### 9. Analytics and tracking must be extensible

The current Phase 1 tracking requirements are intentionally simple.

We currently care about:

- notification existence
- delivery state
- whether the user responded/clicked

But the architecture should leave room for future tracking such as:

- generated
- filtered
- suppressed
- delivered
- opened
- clicked
- converted
- registered
- dismissed
- ranking position
- recommendation reason
- algorithm/model version
- experiment variant

**Do not build all of this now.**

The important requirement is that future analytics/tracking should not require contaminating the core notification business logic.

---

### 10. Testing must be first-class

Testing should be treated as a major architectural requirement, not something added after implementation.

Use the existing Kizunia testing conventions and **Vitest**, including the repository's established integration-test configuration and patterns.

Tests should be professional and comprehensive.

The architecture should make it possible to test independently:

- individual filters
- pipeline stages
- notification policies
- relevance logic
- ranking
- aggregation
- notification history rules
- notification preference rules
- notification-type isolation
- delivered/undelivered behavior
- response behavior
- scheduled evaluation
- end-to-end notification flows

The system should not require massive integration tests for every small business rule.

Prefer a healthy testing pyramid:

**focused unit tests → module/integration tests → carefully selected end-to-end behavior**

Use the existing repository conventions rather than inventing a parallel testing system.

---

### 11. Documentation is part of the feature

Documentation is a **live part of the Notifications subsystem**, not an afterthought.

All notification-specific documentation should live under:

**`/docs/project/feature-specs/notification/`**

The documentation itself should be modular.

Do **not** dump dozens of unrelated Markdown files into a single directory.

Organize documentation according to meaningful concepts/domains, for example:

**notification/**

→ overview / architecture

→ decisions

→ domain concepts

→ pipeline

→ notification types

→ preferences

→ delivery

→ testing

→ future/extension areas

The exact structure should be determined after studying the codebase and the amount of documentation actually required.

The documentation should remain **live**:

> When notification behavior, architecture, terminology, or decisions change, the relevant documentation must be updated as part of the same change.
> 

Code and documentation should not intentionally drift apart.

---

### 12. Documentation should capture decisions, not implementation noise

The documentation should explain:

- what the system does
- why it does it
- important architectural boundaries
- behavioral contracts
- important decisions
- extension points
- constraints

It should not become a dump of implementation details that immediately become stale.

Implementation-specific details belong in code where appropriate.

Architectural/product decisions belong in the feature documentation.

---

### 13. Git history should be professional

The implementation should be developed through **small, meaningful, logically separated commits**.

Do not make one enormous:

> `feat: implement notifications`
> 

commit containing the entire subsystem.

Separate changes according to meaningful architectural/product boundaries.

For example, conceptually:

- foundation
- domain model
- preference handling
- pipeline
- notification intent
- candidate evaluation
- aggregation
- delivery
- tests
- documentation

The actual commit breakdown should follow the implementation and repository conventions.

Commit messages should be:

- factual
- detailed enough to understand the change
- scoped
- human-sounding
- based only on what was actually changed

---

### 14. Avoid both extremes

The target is **enterprise-grade architecture**, but that does not mean:

> “Create 40 interfaces because interfaces are enterprise.”
> 

Nor do we want:

> “Put everything in one notification service because Phase 1 is small.”
> 

The desired architecture is:

**deeply modular where change is expected, simple where change is not expected.**

Every abstraction should have a reason to exist.

---

### 15. Phase 1 must remain intentionally small

Even though the architecture is designed for substantial future growth, Phase 1 behavior remains limited to:

**TOP_RELEVANT_COMPETITION**

and

**REGISTRATION_CLOSING**

Do not implement future functionality simply because the architecture supports it.

We are designing the **foundation for future evolution**, not implementing the future roadmap prematurely.

---

### Core engineering principle

The most important requirement for this subsystem is:

> **Build Notifications as a replaceable, composable subsystem rather than as a collection of competition-specific notification features.**
> 

Kizunia's notification requirements will change substantially over time.

The architecture should make it cheap to change:

**what is evaluated → how it is evaluated → what gets selected → why it is notified → how it is aggregated → whether it is allowed → how it is delivered → how it is tracked**

without repeatedly rewriting the entire notification system.

That is the standard I want the implementation to be held to.