# Missing and Mismatched Competition Data

> **Status:** Stable
>
> **Last Updated:** 2026-09-12
>
> **Rulings:** [ND-R-05](../decisions/relevance.md#nd-r-05--soft-mismatches-and-missing-values-lower-relevance-but-do-not-exclude),
> [ND-R-06](../decisions/relevance.md#nd-r-06--a-missing-value-fails-a-hard-constraint)

Competition data on Kizunia is frequently incomplete. Organizers omit fields, listings are
imported partially, and some attributes are simply unknown. Any competition attribute may be
`null`.

The rules below determine what that means for recommendation.

---

## The governing principle

> **A missing value is not automatically treated as a hard mismatch.**

How a `null` behaves depends entirely on whether the user's preference for that field is soft or
hard.

---

## Under a soft preference

Neither a mismatch nor a missing value excludes the competition.

```text
User:         Online -> 0.8
Competition:  Mode = Offline
```

The competition does not match the preference, but it can still be recommended based on its
overall relevance.

```text
User:         Online -> 0.8
Competition:  Mode = null
```

Same outcome — no match, still potentially recommendable.

> A soft mismatch or missing competition value lowers the competition's relevance but does not
> give it zero possibility of recommendation.

**Why.** Excluding every competition with a null field would discard genuinely good opportunities
because an organizer left a box blank. A user who mildly prefers online events would rather hear
about an excellent competition of unknown mode than hear nothing.

---

## Under a hard constraint

Hard constraints are strict, including when data is missing.

```text
User:         Online -> 1.0
Competition:  Mode = null

Result: cannot be recommended
```

Kizunia cannot establish that the competition satisfies the constraint, so it is excluded.

**Why.** A hard constraint is a promise to the user. Honouring it on unknown data would be
guessing on their behalf — and the guess that gets caught is the one that wastes their time.

---

## The complete matrix

| User preference | Competition value | Result |
| --- | --- | --- |
| `Online 0.8` | Online | Match |
| `Online 0.8` | Offline | Not a match, but possible |
| `Online 0.8` | `null` | Not a match, but possible |
| `Online 1.0` | Online | Match |
| `Online 1.0` | Offline | Excluded |
| `Online 1.0` | `null` | Excluded |

Stated compactly:

```text
Matching value          positive relevance
Different value         no match, still recommendable when the preference is soft
null                    no match, still recommendable when the preference is soft
null + hard constraint  excluded
```

---

## What is not specified

*How much* a soft mismatch or a `null` lowers relevance is part of the scoring formula, which is
deliberately undecided
([ND-R-07](../decisions/relevance.md#nd-r-07--the-scoring-formula-is-deliberately-undecided)).

Two reasonable positions exist and neither has been chosen: a `null` may be penalized identically
to a mismatch, or slightly less harshly on the grounds that unknown is not the same as wrong. This
is recorded in [`open-decisions.md`](../open-decisions.md).

What **is** fixed is the qualitative rule above: soft never excludes, hard always excludes on
`null`.
