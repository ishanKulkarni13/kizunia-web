# Testing

> **Status:** Design
>
> **Last Updated:** 2026-09-12

Testing is treated as a **major architectural requirement**, not something added after
implementation.

| Document | Contents |
| --- | --- |
| [strategy.md](strategy.md) | The pyramid, and the repository conventions to follow |
| [test-surface.md](test-surface.md) | What must be independently testable, and what that implies |

---

## The requirement

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

> The system should not require massive integration tests for every small business rule.

Prefer a healthy testing pyramid:

```text
focused unit tests -> module/integration tests -> carefully selected end-to-end behavior
```

---

## Why this is architecture, not process

The list above is a **design constraint**, not a wish. Read backwards, it says:

- a filter that cannot be tested alone is doing more than one thing;
- a policy that needs a database is coupled to persistence;
- a stage that cannot be tested without the pipeline has become part of the pipeline;
- a rule that needs an end-to-end test is a rule nobody will change confidently.

If a business rule cannot be tested without running the whole pipeline, the boundaries are wrong.
That is the feedback loop this requirement exists to create — and the reason the processing context
is designed the way it is
([`../pipeline/processing-context.md`](../pipeline/processing-context.md)).

---

## Use the existing conventions

Kizunia already has an established Vitest setup and documented conventions, in
[`next/docs/testing/`](../../../../next/docs/testing/README.md).

> Use the existing repository conventions rather than inventing a parallel testing system.

Summarized in [strategy.md](strategy.md); the linked documents are authoritative.
