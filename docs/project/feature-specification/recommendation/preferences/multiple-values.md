# Multiple Values Within One Dimension

> **Status:** Stable — Phase 0
>
> **Last Updated:** 2026-09-15
>
> **Rulings:** [RD-02](../decisions/README.md#rd-02)

A user may express more than one value in the same dimension, each with its
own weight:

```text
Location: Pune -> 1.0, Mumbai -> 0.7
Categories: Hackathon -> 0.9, Ideathon -> 0.6
```

## Aggregation rule (Phase 0)

For a **soft** dimension, a candidate's match strength is the weight of the
*best* matching value, relative to the dimension's strongest expressed
weight (`userStrength`):

```text
strength = matched_value_weight / userStrength
```

So with `Pune -> 1.0, Mumbai -> 0.7`:

- A Pune competition matches at strength `1.0 / 1.0 = 1.0`.
- A Mumbai competition matches at strength `0.7 / 1.0 = 0.7`.
- A Bangalore competition does not match (strength `0`, mismatch).

The user's own relative ordering between their preferred values survives
into the score — Mumbai is never as good a match as Pune, but it is still a
better match than an unrelated city, and much better than no match at all.

For a **hard** dimension, hard-constraint dominance already applies (see
[`weights-and-constraints.md`](weights-and-constraints.md)) — only the
weight-1 values are acceptable, and a match against any of them is treated
as a full match.

## Why this formula, not an average

Averaging every preferred value's weight against a candidate would punish a
candidate for *not* matching a value the user prefers less — a Mumbai
competition should not score worse because the user also likes Pune. Taking
the best match means a candidate is judged on how well it satisfies the
user, not on how many of the user's preferences it fails to be
simultaneously.

This is a first version, chosen for explainability. See
[`../../../architecture/recommendation/scoring-strategy.md`](../../../architecture/recommendation/scoring-strategy.md)
for how it plugs into the overall score and how it could be replaced.
