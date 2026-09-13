# Competition Preference Profile

> **Status:** Stable
>
> **Last Updated:** 2026-09-12
>
> **Rulings:** [ND-P-02](../decisions/preferences.md#nd-p-02--partial-configuration-is-normal),
> [ND-P-03](../decisions/preferences.md#nd-p-03--nothing-selected-in-a-field-means-no-preference),
> [ND-P-04](../decisions/preferences.md#nd-p-04--an-empty-profile-disables-personalized-recommendation),
> [ND-P-10](../decisions/preferences.md#nd-p-10--location-expands-downward-never-upward),
> [ND-P-11](../decisions/preferences.md#nd-p-11--location-may-temporarily-be-a-hard-constraint)

Kizunia maintains a **Competition Preference Profile** for each user. It describes **what the user
cares about**. The notification system separately determines **when and how** to tell them.

The profile is built from the competition attributes already available through Kizunia's
competition filters, so users configure preferences using vocabulary they have already met while
browsing.

---

## Partial configuration is the normal case

Users are not required to configure every field. A profile like this is complete and valid:

```text
Interest:
  AI      -> 0.9

Location:
  Pune    -> 0.8
```

which means:

```text
Interest     preference exists
Location     preference exists
Mode         no preference
Fee          no preference
Eligibility  no preference
```

---

## Two meanings of "nothing selected"

These look alike and behave completely differently.

### 1. Nothing selected in a particular field

The user does not care about that attribute. Any value is acceptable, and the field contributes no
signal to relevance.

```text
Mode: nothing selected

Online   acceptable
Offline  acceptable
```

This is not a penalty and not an exclusion. The field simply does not participate.

### 2. Nothing selected anywhere in the profile

Kizunia has no information at all, so it cannot make a personalized recommendation.

```text
No preferences anywhere
        │
Personalized competition recommendation disabled
```

The user must select **at least one** preference before personalized competition recommendation
notifications can operate.

This is the honest outcome: with no signal, any recommendation would be arbitrary, and sending
arbitrary recommendations is the behavior the subsystem exists to prevent.

---

## Location is hierarchical

Location preferences follow the semantics of Kizunia's geographic competition filters, and
geography has direction.

If a user prefers `Pune → 0.8`:

| Competition location | Result |
| --- | --- |
| Pune | Strong geographic match |
| A locality **inside** Pune | Matches the Pune preference |
| Maharashtra (which **contains** Pune) | Very low likelihood of selection — not an equivalent match |

> **Search expands downward geographically, never upward.**

A competition listed only at state level is not a city-level match. Treating it as one would flood
a user who cares about their own city with events they cannot reach.

### Implementation cost caveat

The product model conceptually supports weighted location (`0` to `1`). Hierarchical weighted
geographic matching may be expensive to query. If the initial implementation finds it prohibitive,
location may temporarily operate as a **hard constraint** (`1`) while the model retains the
ability to support weighted location later.

This is an implementation decision to be evaluated separately. The product model must not
unnecessarily prevent future weighted location support.

The exact location-matching algorithm remains open — see
[`open-decisions.md`](../open-decisions.md). Related prior work exists in the Search subsystem's
[radius search research](../../search/08-radius-search-research.md).

---

## What the profile is not

- It is **not** a filter. Configuring it does not change search results
  ([filters-vs-preferences.md](filters-vs-preferences.md)).
- It is **not** an opt-in to notifications. Notification preferences control that separately
  ([notification-preferences.md](notification-preferences.md)).
- It is **not** versioned for evaluation purposes. Each evaluation uses the profile as it stands at
  that moment ([ND-H-05](../decisions/history.md#nd-h-05--each-evaluation-uses-current-preferences)).

---

## Next

How weights behave, including hard constraints and dominance:
[weights-and-constraints.md](weights-and-constraints.md).
