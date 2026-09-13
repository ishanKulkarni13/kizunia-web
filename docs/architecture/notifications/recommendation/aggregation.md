# Aggregation

> **Status:** Design
>
> **Last Updated:** 2026-09-12

Aggregation combines a selection into the notifications the user actually sees. It is a per-intent
policy, not a shared behavior with intent-aware branches.

---

## Phase 1 aggregation policies

| Intent | Policy |
| --- | --- |
| `TOP_RELEVANT_COMPETITION` | None. One competition, one notification |
| `REGISTRATION_CLOSING` | Combine the selection into **one** summary notification |

```text
Top 3 to 5 competitions
        │
One aggregated notification
```

Example shape:

> **Registration closing soon**
>
> 4 competitions relevant to you have registration deadlines approaching.

Exact presentation and wording are UX concerns. The binding rules are the ones below.

---

## Two different deduplications meet here

Both are called deduplication and they operate at different scopes. Aggregation is where the second
one lands.

| Rule | Scope | Effect |
| --- | --- | --- |
| **History deduplication** | Across evaluations | A competition already delivered for this intent is excluded — handled earlier, at candidate filtering |
| **Relationship deduplication** | Within one evaluation | A user qualifying through both relevance *and* bookmark gets one notification, not two |

The second is a real aggregation responsibility for `REGISTRATION_CLOSING`
([ND-I-12](../../../project/feature-specification/notification/decisions/intents.md#nd-i-12--one-notification-per-deadline-event)):

> Kizunia must not send one notification because the competition is relevant and another because it
> is bookmarked.

The eligibility relationships **may be retained internally** if useful — they are the natural raw
material for a future "why did I get this?" explanation, and for tracking — but they must not
produce duplicate user-facing notifications.

---

## The storage question this creates

One user-facing notification covers several competitions. History must still account for each
competition's `(user, competition, intent)` triple, because that triple is what deduplication reads
([`../persistence/notification-storage.md`](../persistence/notification-storage.md)).

Two shapes are possible and **neither is chosen**:

| Shape | Consequence |
| --- | --- |
| One record with several subjects | Matches what the user sees; response state is naturally at the right level; deduplication queries must look inside the subject set |
| Several records sharing a presentation group | Deduplication is a simple lookup; the inbox and response state need the grouping to reconstruct what the user saw |

This is open item A-5 in
[`open-decisions.md`](../../../project/feature-specification/notification/open-decisions.md).

The product requirements either shape must satisfy:

- the user sees **one** notification;
- history accurately records which competitions were included;
- response state is meaningful at the level the user actually interacts with
  ([ND-H-08](../../../project/feature-specification/notification/decisions/history.md#nd-h-08--response-is-binary)).

---

## Aggregation does not re-open earlier decisions

Aggregation receives a selection. It must not:

- add candidates that did not clear the threshold, to make a summary look fuller;
- re-rank;
- drop a selected candidate for presentation reasons without that being an explicit policy.

The relevance floor is not an aggregation concern and must not be relaxed here
([ND-R-02](../../../project/feature-specification/notification/decisions/relevance.md#nd-r-02--the-minimum-threshold-is-a-floor-never-lowered-for-quota)).

---

## Anticipated future aggregation

Named so that the policy boundary is drawn with them in mind, not built:

- **A discovery digest** — several relevant competitions in one notification, the future intent
  discussed in
  [`future/notification-intents.md`](../../../project/feature-specification/notification/future/notification-intents.md).
- **Cross-intent aggregation** — combining different intents into one message. This would strain
  the rule that intents are independent
  ([ND-H-07](../../../project/feature-specification/notification/decisions/history.md#nd-h-07--different-intents-are-independent))
  and should not be attempted without a deliberate decision.
- **Time-window batching** — holding notifications to combine them. Phase 1 has no such window;
  aggregation happens within a single evaluation only.
