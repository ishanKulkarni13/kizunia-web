# Notifications as an Independent Subsystem

## Status

Accepted — 2026-09-12. No implementation started.

---

# Context

Kizunia is adding notifications. The Phase 1 behavior is small: two competition notification types,
`TOP_RELEVANT_COMPETITION` and `REGISTRATION_CLOSING`.

The obvious implementation is proportionate to that scope — a notification service inside the
competition module, a scheduled job, a table. It would work, and it would be finished sooner.

It is rejected, because the scope is not the design problem. The list of changes this area is
expected to absorb was enumerated during design and is long and specific: new and removed
notification types, replaced relevance and ranking algorithms, an ML model at some stage, new
delivery mechanisms and channels, changed aggregation rules, paid features, feature flags,
analytics, detailed tracking, changed limits, changed eligibility rules, new filtering stages,
event-driven notifications, new clients such as Expo/mobile, and changed presentation.

A competition-scoped notification service absorbs the first two of those and then becomes the thing
everyone is afraid to edit.

---

# Decision

**Notifications is built as an independently bounded subsystem with a composable processing
pipeline, not as competition-domain functionality.**

Five commitments follow from that.

### 1. A bounded module

Notifications owns its own domain concepts, business rules, intents, preference handling, candidate
processing, filtering, relevance integration, generation, history and delivery orchestration. It
communicates with other domains through defined boundaries.

The competition domain stays responsible for competitions. Existing competition services and models
are not turned into notification services.

### 2. Recommendation and notification are separate responsibilities

```text
Recommendation  ->  "What should be recommended to this user?"
Notification    ->  "Should this recommendation become a notification, and how is it handled?"
```

The recommendation system does not own delivery. The notification system does not own the relevance
algorithm.

### 3. A composable pipeline with a typed context

Evaluation moves through composable stages operating on a shared, typed processing context. Stages
are independently testable, replaceable, and able to consume and contribute context.

The inspiration is a filter-chain architecture in the style of Spring Security — the architectural
property, not the implementation.

### 4. Intent is the extensibility boundary

Adding a notification type means adding behavior, not editing a central service. A growing
`if type === ... else if ...` chain is explicitly rejected as the extensibility mechanism.

### 5. Generation is separate from delivery

A notification may be generated and delivered asynchronously afterwards, through a queue seam. This
is what keeps the subsystem independent of the web client and open to additional channels.

---

# Consequences

### Accepted costs

**More indirection than Phase 1 needs.** Two intents do not require an intent contract. The cost is
paid deliberately, against an enumerated list of anticipated changes.

**A context contract to maintain.** The processing context is the part of this design most likely to
rot into a shared mutable bag. It is constrained explicitly and will need discipline.

**A boundary that must be defended.** Relevance scoring needs a lot of competition data, and the
cheap path — reaching into competition internals, or building notification queries inside the
competition module — will be available at every step.

### Explicitly not accepted

**Abstraction without a reason.** The target is *deeply modular where change is expected, simple
where change is not expected*. "Create 40 interfaces because interfaces are enterprise" is as wrong
as "put everything in one service because Phase 1 is small". Every abstraction must have a reason
to exist.

**Building the future.** The architecture supporting a capability is not a reason to implement it.
Phase 1 remains two intents. Nothing else may appear in the code, the model, or the interface.

### What this makes possible

Adding an intent, swapping the relevance algorithm, adding a channel, adding a trigger source,
gating a capability by plan, and adding tracking — each without touching the others. The specific
extension map is recorded in
[`notifications/pipeline/extension-points.md`](../notifications/pipeline/extension-points.md).

### What it depends on

Four decisions remain open and **block implementation**: the `REGISTRATION_CLOSING` evaluation
window, the disposition of the legacy `NotificationPreference` model, what the queue actually is
given that this repository has no queue infrastructure, and where "relevant to the user" comes from
for the deadline intent. See
[`open-decisions.md`](../../project/feature-specification/notification/open-decisions.md).

---

# Alternatives considered

**A notification service inside the competition module.** Rejected: it makes the first
non-competition intent a restructuring, and it accumulates unrelated competition rules until it
cannot be reasoned about.

**A single notification service with per-type branches.** Rejected explicitly during design. It is
the mechanism the intent boundary exists to avoid.

**Deferring the architecture until a third intent exists.** Rejected: notification history,
deduplication semantics and preference storage are all decided in Phase 1 and are expensive to
change afterwards. The parts that are hardest to revisit are precisely the parts Phase 1 must get
right.

---

# References

- Product specification:
  [`project/feature-specification/notification/`](../../project/feature-specification/notification/README.md)
- Architecture: [`architecture/notifications/`](../notifications/README.md)
- Domain model: [`architecture/domain/notifications/`](../domain/notifications/README.md)
- Scheduled-job convention: [`workflows/internal-jobs.md`](../workflows/internal-jobs.md)
- Competition status derivation:
  [`workflows/competition/lifecycle-automation.md`](../workflows/competition/lifecycle-automation.md)
