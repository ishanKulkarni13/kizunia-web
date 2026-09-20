# Adding an Intent

> **Status:** Design
>
> **Last Updated:** 2026-09-12

The checklist for introducing a new notification type, and the anti-patterns that mean it was done
wrong.

**Before anything below:** a new intent needs a product decision first. It must not appear in code,
in an enum, or in the user interface — even as a placeholder — until it has a specification and a
ruling
([`phase-1/boundaries.md`](../../../project/feature-specification/notification/phase-1/boundaries.md)).

---

## Checklist

### 1. Specify it

Write the intent's product specification in
[`feature-specification/notification/intents/`](../../../project/feature-specification/notification/intents/README.md),
answering every row of the intent table: purpose, kind, trigger, user eligibility, candidate rule,
exclusions, selection policy, aggregation, dedup scope, user preference.

Record the ruling in
[`decisions/intents.md`](../../../project/feature-specification/notification/decisions/intents.md).

If the intent was previously listed in
[`future/notification-intents.md`](../../../project/feature-specification/notification/future/notification-intents.md),
remove it from there — it graduates, it does not get duplicated.

### 2. Implement the contract

Supply the four varying pieces
([intent-contract.md](intent-contract.md)): candidate rule, filter composition, selection policy,
aggregation policy. Plus identity, trigger declaration, eligibility checks, dedup scope and
preference surface.

### 3. Reuse filters; add only what is new

Check the existing filter set before writing one. The delivery-history and hard-constraint filters
are shared by design. A genuinely new exclusion becomes a new filter with **one** reason
([`../pipeline/filter-chain.md`](../pipeline/filter-chain.md)).

### 4. Add the preference

Every intent has at least an on/off toggle
([ND-P-12](../../../project/feature-specification/notification/decisions/preferences.md#nd-p-12--notification-preferences-are-per-intent-and-separate)).
Decide the default deliberately — for some intents, off by default is the right answer.

### 5. Wire the trigger

Through the trigger layer, following the repository's scheduled-job convention where applicable
([`../triggers/scheduled-evaluation.md`](../triggers/scheduled-evaluation.md)). The trigger calls
into the evaluation logic; it does not contain any.

### 6. Test it in isolation

The intent's rules must be testable without running the other intents, and each supplied policy
must be testable without running the pipeline
([`../testing/test-surface.md`](../testing/test-surface.md)). Add a test asserting the new intent
does not suppress or interfere with existing ones.

### 7. Update the documentation in the same change

The specification, the ruling, the Phase boundaries if scope changed, and the user-story register
if it resolves a story
([`experience/user-stories.md`](../../../project/feature-specification/notification/experience/user-stories.md)).

> Code and documentation should not intentionally drift apart.

---

## What must not change

If adding an intent requires touching any of these, the boundary is wrong and the design should be
revisited rather than worked around:

- another intent's rules;
- the pipeline's stage sequence;
- the processing context's core contract;
- notification persistence;
- delivery;
- the scoring strategy.

---

## Anti-patterns

| Anti-pattern | Why it fails |
| --- | --- |
| A central service with `if (intent === ...)` branches | The explicitly rejected extensibility mechanism ([`../principles.md`](../principles.md)) |
| A filter that checks which intent it is running for | Filters are composed by intents, not aware of them |
| Copying an existing intent's file and editing it | Duplicates rules that should be shared filters; the two copies then drift |
| A new pipeline for an intent that does not need every stage | Stages the intent does not use are skipped, not forked ([intent-contract.md](intent-contract.md)) |
| Suppressing another intent's notification | Intents are independent ([ND-H-07](../../../project/feature-specification/notification/decisions/history.md#nd-h-07--different-intents-are-independent)). A genuine cross-intent limit is a separate stage, deliberately designed ([`../pipeline/extension-points.md`](../pipeline/extension-points.md)) |
| Adding the enum value "for later" | Phase boundaries are binding; an unused intent in the model is behavior that exists without a specification |

---

## The first real test

The Phase 1 intents are both competition-based, both scheduled, both relevance-driven. Their
similarity means the contract is not yet proven.

The first intent that breaks the pattern — most likely **portfolio contact notifications**, which
have no relevance, no ranking and no aggregation, and are triggered by an event rather than a
schedule — is where this design is actually tested
([`future/notification-intents.md`](../../../project/feature-specification/notification/future/notification-intents.md)).

Worth keeping in view while building the first two: the goal is not two intents that work. It is a
contract the third and fourth can be poured into.
