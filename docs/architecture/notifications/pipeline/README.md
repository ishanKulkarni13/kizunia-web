# The Notification Pipeline

> **Status:** Design
>
> **Last Updated:** 2026-09-12

The pipeline is the core of this architecture. It is what makes a new intent, a new filter, a new
algorithm or a new channel an *addition* rather than a *rewrite*.

---

## The idea

A notification evaluation moves through a sequence of composable stages, each with a clearly
defined responsibility, operating on a shared typed context.

```text
Trigger
  -> Context
  -> Eligibility
  -> Candidate Selection
  -> Filters
  -> Preference Matching
  -> Relevance
  -> Ranking
  -> Selection
  -> Notification Policy
  -> Generation
  -> Delivery
```

**This is conceptual.** Do not blindly create one class or service per arrow. Boundaries are chosen
from the actual Kizunia architecture; the diagram describes responsibilities, not a file listing.

What matters is the architectural property:

> **A sequence of composable processing stages, each with a clearly defined responsibility,
> operating on shared context and allowing the pipeline to evolve.**

---

## Documents

| Document | Contents |
| --- | --- |
| [stages.md](stages.md) | Each stage's responsibility, inputs and outputs |
| [processing-context.md](processing-context.md) | The context contract, and the rules that stop it becoming a god object |
| [filter-chain.md](filter-chain.md) | The middleware model and the guarantees it provides |
| [extension-points.md](extension-points.md) | Where new behavior attaches without restructuring |

---

## The properties every stage must have

- **Composable** — stages combine without knowing about each other
- **Independently testable** — a stage can be tested without running the pipeline
- **Replaceable** — a stage can be swapped without touching its neighbours
- **Reorderable where valid** — ordering constraints are explicit, not accidental
- **Extensible** — new stages can be inserted
- **Context-consuming** — a stage can use information produced by earlier stages
- **Context-contributing** — a stage can make information available to later stages

A future filter should be able to use information produced earlier **without creating tight
coupling between unrelated components**.

---

## The one ordering constraint that is not negotiable

**Filtering runs before scoring.**

This is a product rule, not a performance choice
([ND-R-04](../../../project/feature-specification/notification/decisions/relevance.md#nd-r-04--candidate-filtering-runs-strictly-before-scoring)).
A candidate that cannot participate must not be able to score its way back in, and scoring effort
must not be spent on impossible candidates.

Other ordering is a design decision; this one is a correctness requirement.

---

## Why a pipeline rather than a service

The alternative — one notification service that does eligibility, candidate selection, scoring,
ranking, aggregation and generation in sequence — works perfectly for two intents and degrades
predictably from there. Every new intent adds a branch; every new filter adds a condition; every
algorithm change edits the same file.

The pipeline is not more sophisticated than that design. It is the same sequence, with the joins
made explicit so that each part can be replaced, tested and extended on its own.

The cost is real: more indirection, and a context contract to maintain. It is accepted because the
list of anticipated changes to this subsystem is long and specific
([`principles.md`](../principles.md)).
