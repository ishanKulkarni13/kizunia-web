# Subscription Domain

> **Status:** Design — conceptual, not a schema
>
> **Last Updated:** 2026-09-21

The conceptual entities behind Subscription & Billing and how they relate. This is the domain
counterpart to [`docs/architecture/subscription/`](../../subscription/README.md), which describes
mechanism, and the product counterpart to
[`docs/project/feature-specification/subscription/`](../../../project/feature-specification/subscription/README.md),
which describes behavior.

Storage shape (Prisma models, exact fields, migrations) is **not** decided here, on purpose — this
document set is architecture, not implementation. See
[`overview.md`](overview.md) for why entities are described by contract rather than by schema.

## Reading order

| # | Document |
| --- | --- |
| 1 | [overview.md](overview.md) |
| 2 | [entities.md](entities.md) |
| 3 | [relationships.md](relationships.md) |
