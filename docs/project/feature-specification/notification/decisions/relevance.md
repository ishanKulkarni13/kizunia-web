# Decisions — Relevance

> **Status:** Live
>
> **Last Updated:** 2026-09-12

Rulings covering candidate filtering, relevance scoring, thresholds and selection. Explanatory
treatment lives in [`relevance/`](../relevance/README.md).

---

## ND-R-01 — Relevance is a ranking, not a verdict

**Status:** Accepted

Kizunia does not treat relevance as one universal binary decision. The matching system produces a
continuous relevance signal, which orders candidates:

```text
Competition A   0.94
Competition B   0.87
Competition C   0.71
Competition D   0.32
```

What to do with that ordering is the notification policy's decision, not relevance's.

**Rationale:** Different intents want different things from the same ranking — one wants the
single best, another wants the top few. A binary "relevant / not relevant" answer cannot serve
both, and would have to be re-tuned every time a new intent appeared.

---

## ND-R-02 — The minimum threshold is a floor, never lowered for quota

**Status:** Accepted

A minimum relevance threshold exists as a floor: a competition must be relevant enough to be
considered at all. It does **not** determine how many competitions are sent.

If a policy asks for five and only three clear the floor, three are sent. The threshold is not
lowered to reach five.

> Kizunia should never sacrifice relevance merely to satisfy a requested recommendation quantity.

**Rationale:** Filling a quota with weak recommendations is the fastest way to teach users that
Kizunia's notifications are not worth opening.

**Open:** the threshold's actual value — see [`open-decisions.md`](../open-decisions.md).

---

## ND-R-03 — Selection count belongs to the notification policy

**Status:** Accepted

Relevance produces the ranking; the notification policy determines how many ranked candidates are
selected.

| Policy | Behavior |
| --- | --- |
| Single best (`TOP_RELEVANT_COMPETITION`) | Take the top 1, if it clears the floor |
| Aggregated (`REGISTRATION_CLOSING`) | Take the top N that clear the floor, then aggregate |

**Rationale:** Keeps relevance reusable. A new intent chooses a different selection policy without
touching the scoring layer.

---

## ND-R-04 — Candidate filtering runs strictly before scoring

**Status:** Accepted

Competitions that cannot participate in a particular notification decision are removed **before**
relevance is computed:

```text
All competitions
    -> Hard constraints
    -> Already notified for this intent (delivered)
    -> Other applicable exclusion rules
    -> Eligible candidates
    -> Calculate relevance
    -> Rank
    -> Apply minimum threshold
    -> Select top N
    -> Notify
```

**Rationale:** Both correctness and efficiency. A candidate that is ineligible must not be able to
score its way back in, and Kizunia should not spend scoring resources on candidates already known
to be impossible.

---

## ND-R-05 — Soft mismatches and missing values lower relevance but do not exclude

**Status:** Accepted

Competition data can be incomplete; an attribute may be `null`. Under a **soft** preference:

- a different value is not a match, but the competition remains recommendable;
- a `null` value is not a match, but the competition remains recommendable.

> A soft mismatch or missing competition value lowers the competition's relevance but does not
> give it zero possibility of recommendation.

**Rationale:** Real listings are incomplete. Excluding every competition with a null field would
discard genuinely good opportunities because an organizer left a field blank.

---

## ND-R-06 — A missing value fails a hard constraint

**Status:** Accepted

Hard constraints are strict, including when competition data is missing. Kizunia cannot establish
that a competition with `Mode = null` satisfies `Online → 1.0`, so it is excluded.

The complete matrix:

| User preference | Competition value | Result |
| --- | --- | --- |
| `Online 0.8` | Online | Match |
| `Online 0.8` | Offline | Not a match, still possible |
| `Online 0.8` | `null` | Not a match, still possible |
| `Online 1.0` | Online | Match |
| `Online 1.0` | Offline | Excluded |
| `Online 1.0` | `null` | Excluded |

**Rationale:** A hard constraint is a promise to the user. Honouring it on unknown data would be
guessing on their behalf.

---

## ND-R-07 — The scoring formula is deliberately undecided

**Status:** Accepted (as a deliberate non-decision)

The exact relevance scoring formula, whether different competition fields carry inherent
importance, and how weights are normalized are **not** decided. They are recorded in
[`open-decisions.md`](../open-decisions.md).

What *is* decided is everything around the formula: that it produces a ranking (ND-R-01), that it
runs after filtering (ND-R-04), that a floor applies (ND-R-02), and that selection is the policy's
job (ND-R-03).

**Rationale:** The formula is the part most likely to change — repeatedly, and eventually to a
learned model. Fixing it now would embed today's guess in the contract. Everything the rest of the
subsystem depends on is specified without it, which is precisely what makes the algorithm
replaceable — see
[`scoring-strategy.md`](../../../../architecture/notifications/recommendation/scoring-strategy.md).
