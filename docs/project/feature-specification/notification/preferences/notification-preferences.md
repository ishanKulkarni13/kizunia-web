# Notification Preferences

> **Status:** Stable
>
> **Last Updated:** 2026-09-12
>
> **Rulings:** [ND-P-12](../decisions/preferences.md#nd-p-12--notification-preferences-are-per-intent-and-separate),
> [ND-P-13](../decisions/preferences.md#nd-p-13--registration_closing-exposes-a-user-configurable-maximum),
> [ND-P-14](../decisions/preferences.md#nd-p-14--disabling-an-intent-suppresses-already-generated-notifications)

Notification preferences answer a different question from the competition preference profile:

> **Which types of notification does this user want to receive?**

Users control each notification type independently.

---

## Phase 1 controls

| Intent | User control | Selection |
| --- | --- | --- |
| `TOP_RELEVANT_COMPETITION` | On / Off | Always exactly 1 competition — not configurable |
| `REGISTRATION_CLOSING` | On / Off | User-configurable maximum, surfaced as one summary |

### Daily top competition

Users can turn `TOP_RELEVANT_COMPETITION` on or off. When disabled, the user is not eligible to
receive it, and the intent does not evaluate for them at all.

There is no volume setting. This intent surfaces one competition by design
([ND-I-06](../decisions/intents.md#nd-i-06--top_relevant_competition-selects-exactly-one-competition)).
A multi-competition digest is a separate future intent with its own preference, not a number on
this one — see [`future/notification-intents.md`](../future/notification-intents.md).

### Registration deadline

Users can turn `REGISTRATION_CLOSING` on or off, and can set the **maximum number of competitions**
included in the aggregated summary.

The number actually included is that maximum, bounded by how many qualified candidates exist. If
the user asks for five and three qualify, they get three — the relevance floor is never lowered to
fill the remaining slots
([ND-R-02](../decisions/relevance.md#nd-r-02--the-minimum-threshold-is-a-floor-never-lowered-for-quota)).

This single toggle covers both eligibility relationships. A user who is eligible because the
competition is relevant and a user who is eligible because they bookmarked it use the same
preference, and a user eligible through both still receives one notification
([ND-I-12](../decisions/intents.md#nd-i-12--one-notification-per-deadline-event)).

---

## Separate from the competition preference profile

```text
Competition preferences   ->  which competitions are relevant to the user
Notification preferences  ->  which types of notification the user wants
```

Turning off a notification type does not clear the user's competition preferences, and configuring
competition preferences does not opt the user into any notification. The two are stored and
reasoned about independently.

---

## Disabling an intent after a notification has been generated

If a notification has been generated but the user disables that intent before it is delivered, the
notification is **not sent**.

```text
Notification generated
        │
User disables the intent
        │
Notification is not delivered   ->   delivered = false
```

For Phase 1 the record is simply left with `delivered = false`. No separate cancellation or
suppression state is introduced; this can be extended later if notification lifecycle reporting
requires finer states.

**Consequence worth knowing.** An undelivered notification does not consume its
(user, competition, intent) triple
([ND-H-03](../decisions/history.md#nd-h-03--delivered-consumes-the-triple-undelivered-does-not)).
A user who turns the intent back on may therefore receive that competition in a later evaluation.
That is intended: they never saw it the first time.

---

## Where preferences sit in the flow

A notification preference is a **user eligibility** check, and it runs early — before candidate
selection, not after generation. The disabled-after-generation rule above is a safety net for the
narrow window between generation and delivery, not the primary mechanism.

```text
Trigger
  -> User eligibility        (is this intent enabled for this user?)
  -> Candidate selection
  -> Candidate filtering
  -> Relevance
  -> Selection and aggregation
  -> Generation
  -> [preference re-checked]
  -> Delivery
```

See [`architecture/notifications/pipeline/stages.md`](../../../../architecture/notifications/pipeline/stages.md).

---

## Future preference surface

The design discussions identified a broader preference tree than Phase 1 implements:

```text
Competition
├── Relevant competition notifications      Phase 1 (TOP_RELEVANT_COMPETITION)
├── Relevant competition deadlines          Phase 1 (folded into REGISTRATION_CLOSING)
├── Bookmarked competition deadlines        Phase 1 (folded into REGISTRATION_CLOSING)
└── Competition updates                     Future

Portfolio
└── Contact notifications                   Future

Platform
├── Feature notifications                   Future
└── Promotional notifications               Future
```

Splitting relevant-deadline and bookmark-deadline into independent toggles is a plausible future
refinement and does not require restructuring the intent — see
[`decisions/reconciliations.md`](../decisions/reconciliations.md#r-03--deadline-notification-preferences).
Volume limits beyond the per-intent maximum, such as a cap on total notification activity per day,
are also future work with their semantics undefined — see [`future/README.md`](../future/README.md).

Some notification capabilities may eventually require a paid plan. The preference system must
therefore coexist with entitlements without either owning the other — see
[`future/entitlements.md`](../future/entitlements.md).
