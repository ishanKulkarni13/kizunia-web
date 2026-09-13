# Decision Register

> **Status:** Live
>
> **Last Updated:** 2026-09-12

This area is the **authoritative record** of finalized product and behavioral decisions for the
Notifications subsystem. Where any other document disagrees with a ruling here, the ruling wins.

## How rulings work

Every ruling has:

- **An ID** — stable, never reused, referenced from elsewhere instead of restating the rule.
- **A statement** — what was decided, in one or two sentences.
- **A rationale** — why. A rule without a recorded reason gets re-litigated every six months.
- **A status** — `Accepted`, `Amended` (with a pointer), or `Superseded` (with a pointer).

ID prefixes map to topic files:

| Prefix | Topic | File |
| --- | --- | --- |
| `ND-P-xx` | Preferences and weights | [preferences.md](preferences.md) |
| `ND-R-xx` | Relevance, thresholds, selection | [relevance.md](relevance.md) |
| `ND-I-xx` | Notification intents | [intents.md](intents.md) |
| `ND-H-xx` | Records, deduplication, response | [history.md](history.md) |

## Rules for changing this register

1. **Amend, do not silently rewrite.** A changed decision keeps its ID and gains an amendment
   note. A reversed decision is marked `Superseded` and points at its replacement.
2. **A ruling and its prose ship together.** Changing a rule here without updating the document
   that explains it is an incomplete change.
3. **Open questions do not live here.** They live in [`open-decisions.md`](../open-decisions.md)
   until answered; answering one creates a ruling here and deletes the open item.
4. **Speculation does not live here.** Direction lives in [`future/`](../future/README.md).

---

## Register

### Preferences — [preferences.md](preferences.md)

| ID | Decision |
| --- | --- |
| ND-P-01 | Notification preferences are weighted signals; competition filters are strict retrieval. They must never affect each other |
| ND-P-02 | Users may configure any subset of preference fields |
| ND-P-03 | Nothing selected in a field means the user does not care about that field |
| ND-P-04 | A completely empty profile disables personalized competition recommendation |
| ND-P-05 | Preference weights run 0 to 1, with defined semantics at each end |
| ND-P-06 | Weight 0 is equivalent to unset; it never means dislike |
| ND-P-07 | The model supports independent weights for multiple values within one field |
| ND-P-08 | Weight 1 is a hard constraint, applied before relevance scoring |
| ND-P-09 | Any weight-1 value makes its whole field hard-constrained |
| ND-P-10 | Location matching expands downward through the hierarchy, never upward |
| ND-P-11 | Location may temporarily operate as a hard constraint for cost reasons |
| ND-P-12 | Notification preferences are per-intent and separate from the competition preference profile |
| ND-P-13 | `REGISTRATION_CLOSING` exposes a user-configurable maximum |
| ND-P-14 | A notification generated before the user disables its intent is not sent |

### Relevance — [relevance.md](relevance.md)

| ID | Decision |
| --- | --- |
| ND-R-01 | Relevance is a ranking signal, not a binary verdict |
| ND-R-02 | The minimum relevance threshold is a floor and is never lowered to fill a quota |
| ND-R-03 | How many ranked candidates are taken is decided by the notification policy, not by relevance |
| ND-R-04 | Candidate filtering runs strictly before relevance scoring |
| ND-R-05 | A soft mismatch or a missing competition value lowers relevance but does not exclude |
| ND-R-06 | A missing competition value fails a hard constraint |
| ND-R-07 | The relevance scoring formula is deliberately not decided |

### Intents — [intents.md](intents.md)

| ID | Decision |
| --- | --- |
| ND-I-01 | Phase 1 implements exactly two intents |
| ND-I-02 | `TOP_RELEVANT_COMPETITION` is a discovery notification, not a recurring reminder |
| ND-I-03 | `TOP_RELEVANT_COMPETITION` requires registration to be currently open |
| ND-I-04 | `TOP_RELEVANT_COMPETITION` is evaluated daily at midnight; the trigger is not the logic |
| ND-I-05 | A scheduled evaluation running is not a reason to notify |
| ND-I-06 | `TOP_RELEVANT_COMPETITION` selects exactly one competition |
| ND-I-07 | Registration reopening does not reset discovery history |
| ND-I-08 | Discovery freshness is defined by becoming actionable, not by creation date |
| ND-I-09 | A competition becoming registration-open needs no separate lifecycle notification |
| ND-I-10 | `REGISTRATION_CLOSING` targets 24 hours before the actual deadline timestamp |
| ND-I-11 | `REGISTRATION_CLOSING` eligibility is relevant OR bookmarked, excluding marked-as-registered |
| ND-I-12 | Multiple qualifying relationships produce one notification, not several |
| ND-I-13 | `REGISTRATION_CLOSING` aggregates its selection into one summary notification |
| ND-I-14 | There is no standalone `REGISTRATION_CLOSED` notification |
| ND-I-15 | `REGISTRATION_OPENED` is outside Phase 1 |
| ND-I-16 | Recipient rules use only relationships Kizunia actually knows |
| ND-I-17 | Competition state is not re-validated immediately before delivery in Phase 1 |
| ND-I-18 | The notification model is client-agnostic; Phase 1 targets web |

### History — [history.md](history.md)

| ID | Decision |
| --- | --- |
| ND-H-01 | A notification record represents an occurrence, not a competition's notification status |
| ND-H-02 | History is retained and never overwritten |
| ND-H-03 | A delivered notification consumes its (user, competition, intent) triple; an undelivered one does not |
| ND-H-04 | Re-evaluation creates a new record and is not a delivery retry |
| ND-H-05 | Each evaluation uses the user's current preference profile |
| ND-H-06 | Deduplication is keyed on user + competition + intent |
| ND-H-07 | Different intents are independent, including on the same day for the same competition |
| ND-H-08 | Response is binary: opening or clicking a notification marks it responded |
| ND-H-09 | A previously notified competition may still appear in later rankings |

---

## Reconciliations

The source material contained genuine contradictions. Each is recorded with its resolution in
[reconciliations.md](reconciliations.md) rather than silently applied.

## Source traceability

| Source document | Rulings derived |
| --- | --- |
| `docs/temp/notificatio-decisions.md` | All `ND-P`, `ND-R`, `ND-I`, `ND-H` rulings |
| `docs/temp/notofication-User-stories.md` | Scope classification for [`experience/user-stories.md`](../experience/user-stories.md); non-goals in [reconciliations.md](reconciliations.md) |
| `docs/temp/codebase-recommendation.md` | Architectural requirements, recorded in [`architecture/notifications/`](../../../../architecture/notifications/README.md) rather than as product rulings |
