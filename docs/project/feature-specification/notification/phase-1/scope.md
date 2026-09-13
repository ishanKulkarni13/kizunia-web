# Phase 1 Scope — Consolidated Model

> **Status:** Stable
>
> **Last Updated:** 2026-09-12

The complete Phase 1 behavior in one place. Every statement here is specified in full elsewhere;
this document exists so the whole model can be seen at once.

---

## `TOP_RELEVANT_COMPETITION`

```text
Daily evaluation
    │
Use current user preferences
    │
Registration currently open
    │
Exclude previously delivered same-intent notifications
    │
Apply hard constraints
    │
Apply relevance rules
    │
Apply minimum threshold
    │
Rank
    │
Select at most 1
    │
Generate notification
```

Full specification:
[`intents/top-relevant-competition.md`](../intents/top-relevant-competition.md).

---

## `REGISTRATION_CLOSING`

```text
Evaluate competitions approaching their deadline
    │
Relevant OR bookmarked
    │
Exclude competitions marked as Registered
    │
Collapse multiple qualifying relationships to one
    │
Rank qualified competitions
    │
Select top 3 to 5, bounded by the user's configured maximum
    │
Aggregate into one summary notification
```

Full specification: [`intents/registration-closing.md`](../intents/registration-closing.md).

---

## Notification history

Retained independently of either intent:

```text
Notification occurrence
    │
New record
    │
Delivery state
    │
User response state
```

Records are never overwritten. A later notification is a new occurrence. Full specification:
[`history/README.md`](../history/README.md).

---

## Intents remain independent

```text
Competition A
├── TOP_RELEVANT_COMPETITION
├── REGISTRATION_CLOSING
└── Future notification types
```

A notification for one intent never suppresses one for another, including on the same day.

---

## The Phase 1 user-facing controls

| Notification | User control | Selection |
| --- | --- | --- |
| `TOP_RELEVANT_COMPETITION` | On / Off | Maximum 1 competition |
| `REGISTRATION_CLOSING` | On / Off | User-configurable maximum, surfaced as one summary |

---

## The separation of concerns this preserves

```text
Competition preferences        ->  determine relevance
Notification preferences       ->  determine whether the user wants this type of notification
Notification objective/policy  ->  determines how many relevant competitions are selected
Notification pipeline/filters  ->  process and validate the notification
Delivery layer                 ->  delivers to the supported client/channel
```

This keeps the product rules independent of implementation details and leaves room for the
subsystem to grow more notification types, filters and clients without rewriting the core.

---

## Phase 1 limitations, stated plainly

These are known and accepted, not oversights:

| Limitation | Ruling |
| --- | --- |
| Competition state is not re-validated before delivery — a cancelled competition's notification still sends | [ND-I-17](../decisions/intents.md#nd-i-17--competition-state-is-not-re-validated-before-delivery-in-phase-1) |
| A notification suppressed by a preference change is simply left `delivered = false`, with no dedicated suppression state | [ND-P-14](../decisions/preferences.md#nd-p-14--disabling-an-intent-suppresses-already-generated-notifications) |
| Response tracking is a single boolean | [ND-H-08](../decisions/history.md#nd-h-08--response-is-binary) |
| There is no retry strategy; an undelivered notification is re-evaluated rather than retried | [ND-H-04](../decisions/history.md#nd-h-04--re-evaluation-creates-a-new-record-and-is-not-a-retry) |
| In-app web delivery only | [ND-I-18](../decisions/intents.md#nd-i-18--the-notification-model-is-client-agnostic) |

---

## What must be true when Phase 1 ships

A checklist for judging whether the foundation was actually built, rather than just the two
notifications:

- [ ] Adding a third intent does not require modifying either existing intent.
- [ ] Replacing the relevance algorithm does not touch persistence, delivery, preferences or
      queueing.
- [ ] The evaluation logic can be invoked by something other than the cron trigger without
      duplicating it.
- [ ] Each pipeline stage can be tested without running the whole pipeline.
- [ ] Nothing in the notification module reaches into competition internals beyond a defined
      boundary.
- [ ] No notification behavior exists that is not specified in this documentation set.
