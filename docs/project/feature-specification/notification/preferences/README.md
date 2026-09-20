# Preferences

> **Status:** Stable
>
> **Last Updated:** 2026-09-12

Kizunia has **two independent preference systems**. Keeping them apart is the single most
important thing to understand in this area.

| System | Answers | Affects |
| --- | --- | --- |
| **Competition preference profile** | "What kinds of competition do I care about?" | Which competitions are *relevant* to the user |
| **Notification preferences** | "Which notifications do I want?" | Whether an intent runs for the user at all |

A user can have a rich preference profile and every notification switched off. A user can have
notifications switched on and an empty profile — in which case personalized recommendation is
disabled until they configure something ([ND-P-04](../decisions/preferences.md#nd-p-04--an-empty-profile-disables-personalized-recommendation)).

---

## Documents

| Document | Contents |
| --- | --- |
| [filters-vs-preferences.md](filters-vs-preferences.md) | Why a filter and a notification preference are not the same thing, even though they share attributes |
| [competition-preference-profile.md](competition-preference-profile.md) | What the profile contains and what "no preference" means |
| [weights-and-constraints.md](weights-and-constraints.md) | The 0 to 1 scale, hard constraints, and dominance |
| [notification-preferences.md](notification-preferences.md) | Per-intent controls, and what happens when a user turns one off |

---

## How preferences reach a notification

```text
Competition preference profile
        determines relevance
                │
Notification preference
        determines whether this intent runs for this user
                │
Notification policy
        determines how many relevant competitions are selected
                │
Notification pipeline and filters
        process and validate
                │
Delivery layer
        delivers to the supported client
```

Each layer has one job. Relevance does not decide how many to send; the policy does. The policy
does not decide whether the user wants this kind of message; the notification preference does.

---

## Related

- Scoring and ranking behavior: [`relevance/`](../relevance/README.md)
- Rulings: [`decisions/preferences.md`](../decisions/preferences.md)
- Storage concerns, including the legacy preference model:
  [`preference-storage.md`](../../../../architecture/notifications/persistence/preference-storage.md)
