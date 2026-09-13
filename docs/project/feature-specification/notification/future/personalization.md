# Future Personalization

> **Status:** Direction only — none of this is implemented
>
> **Last Updated:** 2026-09-12

How relevance and recommendation are expected to evolve. **Phase 1 relevance is a deterministic
computation over the user's declared preference profile, and nothing more.**

---

## ML-based relevance

Relevance scoring is expected to change repeatedly, and eventually to become learned rather than
computed.

**What Phase 1 already guarantees.** The relevance algorithm is replaceable by design. Nothing
downstream reads the score's internals — relevance produces an ordering, filtering runs before
scoring, a floor applies, and selection belongs to the policy
([`relevance/relevance-model.md`](../relevance/relevance-model.md)). Swapping the algorithm must
not require changes to notification persistence, delivery, preferences, queueing or any unrelated
intent
([`scoring-strategy.md`](../../../../architecture/notifications/recommendation/scoring-strategy.md)).

**What is undecided.** Everything else: what signal a model would train on, whether declared
preferences remain an input or become one feature among many, and how an unexplainable score
interacts with the product's commitment that a user can see why they received a notification
([`overview/purpose.md`](../overview/purpose.md)).

---

## Behavioral signal

Phase 1 computes relevance from what the user **declared**, not from what they **did**. Response
state is recorded but does not feed back into relevance
([`history/user-response.md`](../history/user-response.md)).

Using behavior — clicks, bookmarks, registrations, dismissals — as a relevance input is a plausible
future direction and a substantial one. It changes the preference profile from a specification into
a prior, and it makes preference changes harder to reason about.

**Undecided:** whether this happens at all, and if so how a user's explicit preferences remain
authoritative over inferred ones.

---

## Experiments and algorithm variants

The architecture should accommodate an experiment or A/B variant of the relevance algorithm, and a
feature-flagged implementation, without invasive change.

The analytics vocabulary that would make experiments meaningful — ranking position, recommendation
reason, algorithm or model version, experiment variant — is listed as future tracking, not built
([`analytics-and-tracking.md`](../../../../architecture/notifications/cross-cutting/analytics-and-tracking.md)).

**Note:** without recorded algorithm version and ranking position, no experiment is analysable
after the fact. Whoever builds the first experiment will need that tracking first.

---

## Richer preference expression

Capabilities the current model deliberately excludes:

| Capability | Status |
| --- | --- |
| **Negative preferences** | Not in the model. Weight `0` means indifference, never dislike ([ND-P-06](../decisions/preferences.md#nd-p-06--weight-0-means-indifference-never-dislike)). Genuine negative preferences would need their own design and their own ruling |
| **Per-field importance** | Whether some competition fields carry inherent importance regardless of user weight is an open decision, not a future idea — see [`open-decisions.md`](../open-decisions.md) |
| **Weighted location UX** | The model supports weighted location; the implementation may temporarily treat it as a hard constraint for cost reasons ([ND-P-11](../decisions/preferences.md#nd-p-11--location-may-temporarily-be-a-hard-constraint)) |
| **Individual weight configuration UX** | The backend supports independent weights per value within a field; how users set them is undecided ([ND-P-07](../decisions/preferences.md#nd-p-07--multiple-values-in-one-field-carry-independent-weights)) |
| **Saved searches as preference input** | The Search subsystem treats saved search and preferences as distinct concepts ([search README](../../search/README.md)). Connecting them is neither planned nor precluded |

---

## The constraint on all of it

Whatever changes, the separation holds:

```text
Recommendation  ->  "What should be recommended to this user?"
Notification    ->  "Should this recommendation become a notification, and how is it handled?"
```

The recommendation system must not own notification delivery. The notification system must not own
the competition relevance algorithm. That boundary is what makes any of the above replaceable at
all — see
[`architecture/notifications/principles.md`](../../../../architecture/notifications/principles.md).
