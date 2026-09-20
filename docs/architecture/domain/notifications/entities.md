# Notifications Domain — Entities

> **Status:** Design — conceptual, not a schema
>
> **Last Updated:** 2026-09-12

The conceptual entities of this domain and their contracts. Storage shape is deliberately absent —
several shaping decisions are open, and a guessed schema is harder to remove than to write. See
[`persistence/`](../../notifications/persistence/README.md).

---

## Notification Intent

A named business purpose that can produce a notification.

| Property | Contract |
| --- | --- |
| Identity | Stable. Appears in records, preferences and deduplication keys, so it outlives refactors |
| Current members | `TOP_RELEVANT_COMPETITION`, `REGISTRATION_CLOSING` |
| Extensibility | New intents are added; existing ones are not modified ([`intents/adding-an-intent.md`](../../notifications/intents/adding-an-intent.md)) |

**Invariant.** An intent must not appear in the model before it has a specification and a ruling.
An enum value added "for later" is behavior that exists without a definition
([`phase-1/boundaries.md`](../../../project/feature-specification/notification/phase-1/boundaries.md)).

---

## Notification Record

The fact that a notification occurred.

| Element | Contract |
| --- | --- |
| User | The recipient |
| Subject | What the notification is about. **Conceptually not competition-only** — the first non-competition intent must not require a migration |
| Intent | Why. Part of the deduplication key |
| Creation time | When the decision was made |
| Delivery state | Whether the user is reasonably presumed to have been told |
| Response state | Whether the user opened or clicked it. Binary in Phase 1 |

### Invariants

**Append-only.** User, subject, intent and creation time never change after insert.

**States move forward only.** Delivery and response each transition once, in one direction.

**Delivered is load-bearing.** `delivered = true` consumes the `(user, subject, intent)` triple and
prevents that subject being surfaced again for that intent. Any definition of "delivered" must be
consistent with that meaning — marking a record delivered at generation time would satisfy the
model and break the rule.

**No suppression state in Phase 1.** A notification suppressed by a preference change is simply
left `delivered = false`.

### Open

An aggregated notification covers several competitions while deduplication reads a per-competition
triple. Whether that is one record with several subjects, or several records sharing a presentation
group, is open item A-5
([`notification-storage.md`](../../notifications/persistence/notification-storage.md)).

---

## Competition Preference Profile

What the user cares about, expressed over competition attributes.

| Property | Contract |
| --- | --- |
| Structure | A set of `(field, value, weight)` entries. Several entries may share a field |
| Weight | `[0, 1]`. `0` means no preference; `1` means hard constraint |
| Completeness | Any subset of fields may be configured; an unset field is distinguishable from a configured one |
| Emptiness | An entirely empty profile is detectable, and disables personalized recommendation |
| Versioning | **None.** Every evaluation reads the current profile; history is never replayed against past preferences |

**Invariant.** Weight `0` is semantically identical to unset and never means dislike. There is no
negative-preference concept in this domain.

**Constraint on any future storage shape.** Weighted location must remain expressible even if the
matching algorithm temporarily treats location as a hard constraint for cost reasons. The
concession is to the algorithm, not to the model.

---

## Notification Preferences

Which notification types the user wants.

| Property | Contract |
| --- | --- |
| Granularity | Per intent |
| Minimum | An on/off control for every intent |
| Intent-specific settings | Permitted — for example the `REGISTRATION_CLOSING` maximum |
| Versioning | None. Read current |

**Invariant.** Separate from the competition preference profile. Turning off an intent does not
clear preferences; configuring preferences does not opt into any intent.

**Invariant.** Not the same as an entitlement. A preference answers *does the user want this?*; an
entitlement answers *is the user allowed this?* They must be stored independently, so that losing
and regaining an entitlement leaves the preference as the user left it.

---

## What is not an entity here

| Not an entity | Why |
| --- | --- |
| "Relevance" | A computed signal, not stored state — unless open item A-4 decides otherwise |
| "Notified" as a flag on a competition | Derived from the record log; a flag cannot express per-intent scope |
| A recipient group | Recipients are computed from relationships Kizunia already owns |
| A channel | Phase 1 has one; channels live behind the delivery boundary ([`clients-and-channels.md`](../../notifications/delivery/clients-and-channels.md)) |
| Notification content or template | Undecided; an open item |
