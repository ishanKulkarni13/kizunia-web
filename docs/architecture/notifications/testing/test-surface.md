# Test Surface

> **Status:** Design
>
> **Last Updated:** 2026-09-12

What must be independently testable, and the rules each area has to prove. This doubles as a
coverage checklist and as an architectural review tool: **anything on this list that cannot be
tested in isolation indicates a boundary in the wrong place.**

---

## Preferences

| Must be provable | Ruling |
| --- | --- |
| An unset field contributes no signal | [ND-P-03](../../../project/feature-specification/notification/decisions/preferences.md#nd-p-03--nothing-selected-in-a-field-means-no-preference) |
| Weight `0` behaves exactly like unset, and never as dislike | [ND-P-06](../../../project/feature-specification/notification/decisions/preferences.md#nd-p-06--weight-0-means-indifference-never-dislike) |
| An entirely empty profile disables personalized recommendation | [ND-P-04](../../../project/feature-specification/notification/decisions/preferences.md#nd-p-04--an-empty-profile-disables-personalized-recommendation) |
| Multiple values in one field carry independent weights | [ND-P-07](../../../project/feature-specification/notification/decisions/preferences.md#nd-p-07--multiple-values-in-one-field-carry-independent-weights) |
| Any weight-1 value makes the whole field hard-constrained, ignoring soft siblings | [ND-P-09](../../../project/feature-specification/notification/decisions/preferences.md#nd-p-09--hard-constraints-dominate-their-field) |
| Disabling an intent prevents delivery of an already-generated notification | [ND-P-14](../../../project/feature-specification/notification/decisions/preferences.md#nd-p-14--disabling-an-intent-suppresses-already-generated-notifications) |

## Relevance and filtering

| Must be provable | Ruling |
| --- | --- |
| Filtering runs before scoring — a filtered candidate is never scored | [ND-R-04](../../../project/feature-specification/notification/decisions/relevance.md#nd-r-04--candidate-filtering-runs-strictly-before-scoring) |
| A hard-constraint failure cannot be overcome by a high score elsewhere | [ND-P-08](../../../project/feature-specification/notification/decisions/preferences.md#nd-p-08--weight-1-is-a-hard-constraint-applied-before-scoring) |
| The full missing-data matrix — six cases | [ND-R-05](../../../project/feature-specification/notification/decisions/relevance.md#nd-r-05--soft-mismatches-and-missing-values-lower-relevance-but-do-not-exclude), [ND-R-06](../../../project/feature-specification/notification/decisions/relevance.md#nd-r-06--a-missing-value-fails-a-hard-constraint) |
| Location matches downward, not upward | [ND-P-10](../../../project/feature-specification/notification/decisions/preferences.md#nd-p-10--location-expands-downward-never-upward) |
| The threshold is never lowered to reach a target count | [ND-R-02](../../../project/feature-specification/notification/decisions/relevance.md#nd-r-02--the-minimum-threshold-is-a-floor-never-lowered-for-quota) |
| Asking for 5 when 3 qualify yields 3, not 5 | [ND-R-02](../../../project/feature-specification/notification/decisions/relevance.md#nd-r-02--the-minimum-threshold-is-a-floor-never-lowered-for-quota) |
| Nothing qualifying yields no notification | [ND-I-05](../../../project/feature-specification/notification/decisions/intents.md#nd-i-05--a-scheduled-run-is-not-a-reason-to-notify) |

## Intents

| Must be provable | Ruling |
| --- | --- |
| `TOP` selects exactly 1 | [ND-I-06](../../../project/feature-specification/notification/decisions/intents.md#nd-i-06--top_relevant_competition-selects-exactly-one-competition) |
| `TOP` considers an `ONGOING` competition whose registration is open | [ND-I-03](../../../project/feature-specification/notification/decisions/intents.md#nd-i-03--top_relevant_competition-requires-registration-to-be-currently-open) |
| `TOP` excludes competitions whose registration is not yet open or already closed | [ND-I-03](../../../project/feature-specification/notification/decisions/intents.md#nd-i-03--top_relevant_competition-requires-registration-to-be-currently-open) |
| Reopening registration does not reset discovery history | [ND-I-07](../../../project/feature-specification/notification/decisions/intents.md#nd-i-07--registration-reopening-does-not-reset-discovery-history) |
| A pre-existing competition becoming registration-open is a valid new opportunity | [ND-I-08](../../../project/feature-specification/notification/decisions/intents.md#nd-i-08--freshness-means-newly-actionable-not-newly-created) |
| `CLOSING` includes a relevant-but-not-bookmarked competition | [ND-I-11](../../../project/feature-specification/notification/decisions/intents.md#nd-i-11--eligibility-is-relevant-or-bookmarked-excluding-marked-as-registered) |
| `CLOSING` includes a bookmarked-but-not-relevant competition | [ND-I-11](../../../project/feature-specification/notification/decisions/intents.md#nd-i-11--eligibility-is-relevant-or-bookmarked-excluding-marked-as-registered) |
| `CLOSING` excludes a competition marked as Registered | [ND-I-11](../../../project/feature-specification/notification/decisions/intents.md#nd-i-11--eligibility-is-relevant-or-bookmarked-excluding-marked-as-registered) |
| Relevant **and** bookmarked yields **one** notification | [ND-I-12](../../../project/feature-specification/notification/decisions/intents.md#nd-i-12--one-notification-per-deadline-event) |
| `CLOSING` aggregates its selection into one summary bounded by the user's maximum | [ND-I-13](../../../project/feature-specification/notification/decisions/intents.md#nd-i-13--registration_closing-aggregates-into-one-summary) |

## History

| Must be provable | Ruling |
| --- | --- |
| A later notification creates a new record; the earlier one is unchanged | [ND-H-02](../../../project/feature-specification/notification/decisions/history.md#nd-h-02--history-is-retained-and-never-overwritten) |
| `delivered = true` suppresses; `delivered = false` does not | [ND-H-03](../../../project/feature-specification/notification/decisions/history.md#nd-h-03--delivered-consumes-the-triple-undelivered-does-not) |
| Deduplication is keyed on intent, not on competition alone | [ND-H-06](../../../project/feature-specification/notification/decisions/history.md#nd-h-06--deduplication-is-keyed-on-user--competition--intent) |
| Two intents may notify about the same competition on the same day | [ND-H-07](../../../project/feature-specification/notification/decisions/history.md#nd-h-07--different-intents-are-independent) |
| Changing preferences changes the next evaluation and leaves history alone | [ND-H-05](../../../project/feature-specification/notification/decisions/history.md#nd-h-05--each-evaluation-uses-current-preferences) |
| A previously notified competition still appears in rankings | [ND-H-09](../../../project/feature-specification/notification/decisions/history.md#nd-h-09--previously-notified-competitions-may-still-rank) |
| Clicking marks responded, and responded does not suppress | [ND-H-08](../../../project/feature-specification/notification/decisions/history.md#nd-h-08--response-is-binary) |

## Pipeline and triggers

| Must be provable |
| --- |
| A stage can be tested by constructing a context, running it, and asserting — no database, no pipeline |
| A filter can be tested without knowing which stages follow it |
| An intent's rules can be tested without running another intent |
| The evaluation service can be invoked directly, with no HTTP and no cron |
| An evaluation can be run "as of" an arbitrary timestamp without fake timers |
| A scheduled endpoint fails closed when the shared secret is missing or wrong |
| Re-running an evaluation does not duplicate notifications — **once A-1 and A-3 are decided** |

---

## The isolation test

For any stage: **construct a context, run the stage, assert on the result** — without a database,
without the rest of the pipeline, and without knowing what runs next.

If that is not possible, the processing context has become coupling rather than communication
([`../pipeline/processing-context.md`](../pipeline/processing-context.md)).

---

## Deliberately not tested in Phase 1

Because the behavior does not exist:

- retry and re-delivery (there is no retry — only re-evaluation);
- pre-delivery competition-state validation ([ND-I-17](../../../project/feature-specification/notification/decisions/intents.md#nd-i-17--competition-state-is-not-re-validated-before-delivery-in-phase-1));
- channels other than in-app;
- entitlement gating;
- analytics events beyond delivered and responded.

Each of these should gain tests at the same time it gains behavior — not before, as a placeholder.

---

## Rows that cannot be written yet

Two entries above depend on blocking open decisions:

- **deadline-window behavior**, including exactly-once per deadline event — blocked on A-1;
- **re-run idempotency** — blocked on A-1 and A-3.

They are listed rather than omitted, because they are the rows most likely to be forgotten once the
decisions land
([`../cross-cutting/failure-and-idempotency.md`](../cross-cutting/failure-and-idempotency.md)).
