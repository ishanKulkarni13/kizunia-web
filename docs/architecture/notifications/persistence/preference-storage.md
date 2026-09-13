# Preference Storage

> **Status:** Design — blocking open decision
>
> **Last Updated:** 2026-09-12

Two independent preference systems are stored
([`preferences/README.md`](../../../project/feature-specification/notification/preferences/README.md)):

| System | Content |
| --- | --- |
| **Competition preference profile** | Weighted values across competition attributes |
| **Notification preferences** | Per-intent on/off, plus the `REGISTRATION_CLOSING` maximum |

They are separate concerns and should not be collapsed into one blob because they happen to belong
to the same user.

---

## Blocking: the legacy `NotificationPreference` model

A `NotificationPreference` model **already exists** in the Prisma schema:

```text
model NotificationPreference {
  userId              unique
  emailNotifications  Boolean  @default(true)
  pushNotifications   Boolean  @default(false)
  preferences         Json?
}
```

It is unused by this specification's design and presupposes things Phase 1 does not have:

- **channel toggles** for email and push, when Phase 1 delivers in-app web only
  ([`future/channels.md`](../../../project/feature-specification/notification/future/channels.md));
- **an untyped `preferences` JSON field**, with no defined shape.

**Open item A-2 — extend it, replace it, or leave it orphaned and introduce a new model.**

This must be decided before preference persistence is built. Whatever is chosen, the channel fields
should not be treated as meaningful until channels exist — a `pushNotifications` toggle that
controls nothing is a promise to the user that the product does not keep.

---

## Requirements the competition preference profile must satisfy

| Requirement | Ruling |
| --- | --- |
| Any subset of fields may be configured | [ND-P-02](../../../project/feature-specification/notification/decisions/preferences.md#nd-p-02--partial-configuration-is-normal) |
| An unset field is distinguishable from a configured one | [ND-P-03](../../../project/feature-specification/notification/decisions/preferences.md#nd-p-03--nothing-selected-in-a-field-means-no-preference) |
| **Multiple values within one field, each with its own weight** | [ND-P-07](../../../project/feature-specification/notification/decisions/preferences.md#nd-p-07--multiple-values-in-one-field-carry-independent-weights) |
| A weight in `[0, 1]`, where 1 means hard constraint | [ND-P-05](../../../project/feature-specification/notification/decisions/preferences.md#nd-p-05--weights-run-from-0-to-1) |
| An entirely empty profile is detectable | [ND-P-04](../../../project/feature-specification/notification/decisions/preferences.md#nd-p-04--an-empty-profile-disables-personalized-recommendation) |
| Weighted **location** must remain expressible later, even if the implementation temporarily treats location as a hard constraint | [ND-P-11](../../../project/feature-specification/notification/decisions/preferences.md#nd-p-11--location-may-temporarily-be-a-hard-constraint) |

The third row is the one that constrains the shape most. A profile is not a flat set of columns —
it is a set of `(field, value, weight)` entries, several of which may share a field.

The last row is a trap worth naming: a storage shape that can only express *"location is required"*
would satisfy Phase 1 and permanently foreclose the weighted behavior the product model requires.
The concession is to the *matching algorithm*, not to the *model*.

---

## Requirements for notification preferences

| Requirement | Ruling |
| --- | --- |
| Per-intent on/off | [ND-P-12](../../../project/feature-specification/notification/decisions/preferences.md#nd-p-12--notification-preferences-are-per-intent-and-separate) |
| Intent-specific settings, such as the `REGISTRATION_CLOSING` maximum | [ND-P-13](../../../project/feature-specification/notification/decisions/preferences.md#nd-p-13--registration_closing-exposes-a-user-configurable-maximum) |
| Extensible to new intents without a migration per intent | [`../intents/adding-an-intent.md`](../intents/adding-an-intent.md) |
| Readable cheaply at user-eligibility time, for every user in a sweep | [`../pipeline/stages.md`](../pipeline/stages.md) |

The third and fourth pull against each other: per-intent columns are cheap to read and require a
migration per intent; a keyed structure extends freely and reads less directly. This trade-off is
part of open item A-2.

---

## Preferences are read current, never versioned

Every evaluation uses the user's **current** profile. Past configurations do not influence the
current run, and the system does not need to evaluate against historical preference state
([ND-H-05](../../../project/feature-specification/notification/decisions/history.md#nd-h-05--each-evaluation-uses-current-preferences)).

So preference storage needs **no** history, no effective-dated rows and no snapshots.

**One caveat.** If open item A-4 resolves toward *storing* relevance rather than recomputing it,
stored relevance becomes derived from a preference profile that can change underneath it — which
requires invalidation on preference edits. That is a consequence of A-4, not a reason to version
preferences.

---

## Entitlements are not preferences

Do not store them in the same place or collapse them into one flag.

| | Preference | Entitlement |
| --- | --- | --- |
| Answers | Does the user **want** this? | Is the user **allowed** this? |
| Set by | The user | Their plan |

A user who loses an entitlement and later regains it should find their preference as they left it —
which is only possible if the two are stored independently. See
[`../cross-cutting/feature-flags-and-entitlements.md`](../cross-cutting/feature-flags-and-entitlements.md).
