# Decisions — Preferences

> **Status:** Live
>
> **Last Updated:** 2026-09-12

Rulings covering the competition preference profile, preference weights, and user notification
preferences. Explanatory treatment lives in [`preferences/`](../preferences/README.md).

---

## ND-P-01 — Filters and notification preferences are different things

**Status:** Accepted

Competition filters and competition notification preferences use the same competition attributes
but serve different purposes. A filter is a strict retrieval constraint answering *"what do I want
to see right now?"*. A notification preference is a weighted relevance signal answering *"what
makes a competition interesting enough that Kizunia should consider telling me?"*.

Notification preferences must **not** silently modify the user's normal competition search or
filter experience.

**Rationale:** The two share a vocabulary, which makes conflating them easy and the consequences
invisible. A user who says "online competitions matter to me" for notifications has not asked for
offline competitions to vanish from search.

---

## ND-P-02 — Partial configuration is normal

**Status:** Accepted

The preference system does not require users to configure every field. A user may set only
interest and location and leave mode, fee and eligibility unspecified.

**Rationale:** Requiring a full profile turns onboarding into a form. Most users have opinions
about two or three things.

---

## ND-P-03 — Nothing selected in a field means no preference

**Status:** Accepted

If nothing is selected for a field, every value of that field is acceptable and the field
contributes no preference signal.

**Rationale:** Silence is not a negative signal. The alternative — treating an unset field as
excluding everything — would make partial configuration useless.

---

## ND-P-04 — An empty profile disables personalized recommendation

**Status:** Accepted

If a user has configured no competition preference at all, Kizunia does not have enough
information to recommend competitions. Personalized competition recommendation is disabled until
at least one preference exists.

**Rationale:** With no signal, any recommendation is arbitrary. Sending arbitrary recommendations
is exactly the behavior this subsystem exists to avoid.

**Note:** This is distinct from ND-P-03. An unset *field* is fine; an entirely unset *profile* is
not enough to work with.

---

## ND-P-05 — Weights run from 0 to 1

**Status:** Accepted

Each selected preference carries a weight in `[0, 1]` expressing how strongly the user cares:

```text
0              no preference
0 < w < 1      soft preference
1              hard constraint
```

**Rationale:** One scale carries both "how much" and "is this negotiable", without a separate
boolean.

---

## ND-P-06 — Weight 0 means indifference, never dislike

**Status:** Accepted

A weight of `0` is semantically identical to the preference not being configured. `Online → 0`
means the user does not care about mode. It does **not** mean the user dislikes online
competitions.

**Rationale:** There is no negative-preference concept in the model. Reading `0` as aversion would
introduce one accidentally.

---

## ND-P-07 — Multiple values in one field carry independent weights

**Status:** Accepted

The model must support several values within the same field, each with its own weight, for
example `Online → 0.9` and `Offline → 0.4`.

The user experience for configuring individual weights is decided separately. The model supports
the capability regardless of what the initial UX exposes.

**Rationale:** Preference strength is genuinely graded, and a model that cannot express it would
have to be replaced the first time the UX improves.

---

## ND-P-08 — Weight 1 is a hard constraint applied before scoring

**Status:** Accepted

A preference with weight `1` must be satisfied for a competition to remain eligible. Hard
constraints are applied **before** relevance scoring.

**Rationale:** A hard constraint is a statement about eligibility, not about degree. Applying it
during scoring would let a high score elsewhere override it, and would waste scoring effort on
candidates that can never qualify. See ND-R-04.

---

## ND-P-09 — Hard constraints dominate their field

**Status:** Accepted

If any value within a field has weight `1`, the whole field becomes hard-constrained and only the
weight-1 values are acceptable. Soft weights on other values in that field are ignored.

```text
Online  → 1.0
Offline → 0.5      Offline is not acceptable
```

**Rationale:** A hard constraint is a hard constraint. Allowing a soft sibling value to survive
would make weight 1 mean something weaker than it says.

---

## ND-P-10 — Location expands downward, never upward

**Status:** Accepted

Location preferences follow the semantics of Kizunia's geographic competition filters. Location is
hierarchical:

- A competition **in** the preferred location matches strongly.
- A competition in a location **contained within** the preferred location also matches.
- A competition in a **broader** location containing the preference is not an equivalent match and
  should have a very low likelihood of selection.

`Pune → 0.8` matches a competition in Pune and one in a locality inside Pune. A competition listed
only as "Maharashtra" is not a Pune match.

**Rationale:** Containment is directional. Treating a state as equivalent to a city would flood
city-preferring users with results they cannot attend.

---

## ND-P-11 — Location may temporarily be a hard constraint

**Status:** Accepted

The product model conceptually supports weighted location (`0` to `1`). Hierarchical weighted
geographic matching may be expensive to query. If the initial implementation finds it prohibitive,
location may temporarily operate as a hard constraint (`1`).

The model must not foreclose weighted location later.

**Rationale:** A cost concession is acceptable; a modelling decision that permanently blocks the
intended behavior is not.

**Blocks:** the exact location-matching algorithm remains open — see
[`open-decisions.md`](../open-decisions.md).

---

## ND-P-12 — Notification preferences are per-intent and separate

**Status:** Accepted

Users independently control which notification types they receive. In Phase 1:

| Intent | Control |
| --- | --- |
| `TOP_RELEVANT_COMPETITION` | On / Off |
| `REGISTRATION_CLOSING` | On / Off, plus a maximum (ND-P-13) |

These are separate from the competition preference profile. Competition preferences determine
*which competitions are relevant*; notification preferences determine *which kinds of notification
the user wants*.

**Rationale:** A user may want Kizunia to understand their interests without wanting a daily
message about them.

---

## ND-P-13 — `REGISTRATION_CLOSING` exposes a user-configurable maximum

**Status:** Accepted

Users can set the maximum number of competitions included in the aggregated registration-deadline
summary. The number actually sent is that maximum, bounded by how many qualified candidates exist.

**Rationale:** Deadline pressure is personal. Some users want everything closing soon; some want
the top two.

**Note:** `TOP_RELEVANT_COMPETITION` has no equivalent setting — it always selects exactly one
(ND-I-06).

---

## ND-P-14 — Disabling an intent suppresses already-generated notifications

**Status:** Accepted

If a notification has been generated but the user disables that intent before it is delivered, the
notification is not sent. For Phase 1 it is simply marked `delivered = false`; no separate
cancellation or suppression state is introduced.

**Rationale:** The user's current preference wins over a decision made minutes earlier. A
dedicated suppression state would be more precise but adds lifecycle complexity Phase 1 does not
need; it can be added later if notification lifecycle reporting requires it.

**Consequence:** Because an undelivered notification does not consume its triple (ND-H-03), a user
who re-enables the intent may receive that competition in a later evaluation. This is intended.
