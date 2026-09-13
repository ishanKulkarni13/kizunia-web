# Re-evaluation

> **Status:** Stable
>
> **Last Updated:** 2026-09-12
>
> **Rulings:** [ND-H-04](../decisions/history.md#nd-h-04--re-evaluation-creates-a-new-record-and-is-not-a-retry),
> [ND-H-05](../decisions/history.md#nd-h-05--each-evaluation-uses-current-preferences)

An undelivered notification does not consume its `(user, competition, intent)` triple
([deduplication.md](deduplication.md)). So what happens when that competition comes back?

---

## A new evaluation is a new decision

```text
Monday
  Competition A
  TOP_RELEVANT_COMPETITION
  delivered = false

Tuesday
  Competition A is still eligible and is again the best candidate
  New notification record created

The Monday record remains in history.
```

If a competition with an undelivered notification becomes the best candidate again during a later
evaluation, Kizunia may generate a **new** notification record.

---

## Re-evaluation is not a retry

This distinction is deliberate and load-bearing.

| | Re-evaluation | Delivery retry |
| --- | --- | --- |
| What happens | The pipeline runs again and re-derives the recommendation | The same notification is sent again |
| Input | Current data, current preferences, current eligibility | The existing record |
| Result | A **new** record, with its own timestamp | The **same** record, another attempt |
| Owned by | The notification pipeline | The delivery layer |
| Exists in Phase 1 | Yes | Not specified |

The Tuesday notification is not Monday's notification tried again. It is Tuesday's independent
conclusion that this competition is the best thing to tell this user about — reached from Tuesday's
data, Tuesday's competition catalogue and Tuesday's preferences. It happens to be the same
competition.

Reusing the Monday record would misdate the decision and would conflate two mechanisms that need to
evolve separately. The retry and re-delivery strategy remains an implementation concern and may
change independently — see
[`failure-and-idempotency.md`](../../../../architecture/notifications/cross-cutting/failure-and-idempotency.md).

---

## Re-evaluation uses current preferences

Each evaluation uses the user's **current** competition preference profile. Past configurations do
not affect the current run.

```text
Monday
  User preferences:  AI -> 0.9

Tuesday
  User changes preferences:  Design -> 0.9

Tuesday's evaluation uses:  Design -> 0.9
```

The system does not evaluate Tuesday's competitions against Monday's preference configuration.

> **Relevance is evaluated against the user's current preference state at the time of evaluation.**

Historical notification records remain preserved independently — they record what was sent, not
what the preferences were when it was sent.

**Why.** Relevance is a statement about what the user cares about *now*. Versioning preference
profiles and replaying history against past configurations would add substantial complexity for no
user-visible benefit. A user who switched from AI to Design wants Design competitions today.

### A consequence worth noticing

Because preferences are read fresh each time, a competition that was undelivered on Monday may no
longer qualify on Tuesday — the user changed their mind, and the competition no longer matches. That
is correct. It also means re-evaluation is not a guarantee of eventual delivery; it is another
chance, evaluated on its own merits.

---

## The same applies to disabled intents

If a notification was generated and then the user disabled the intent before delivery, the record
is left `delivered = false`
([ND-P-14](../decisions/preferences.md#nd-p-14--disabling-an-intent-suppresses-already-generated-notifications)).

Because the triple was not consumed, re-enabling the intent later allows that competition to be
considered again. The user never saw it, so nothing has been spent.
