# Filters vs Notification Preferences

> **Status:** Stable
>
> **Last Updated:** 2026-09-12
>
> **Ruling:** [ND-P-01](../decisions/preferences.md#nd-p-01--filters-and-notification-preferences-are-different-things)

Competition filters and competition notification preferences are built from the **same competition
attributes** — mode, interest, location, fee, eligibility. They are not the same thing, and the
resemblance is exactly what makes conflating them easy.

---

## Two different questions

### A filter asks

> **"What competitions do I want to see right now?"**

Filters are strict retrieval constraints. `Mode = Online` means *show me online competitions*.
Offline competitions are excluded from the result. There is no partial credit.

### A notification preference asks

> **"What characteristics make a competition interesting enough that Kizunia should consider
> notifying me?"**

Preferences are weighted. `Mode: Online → 0.8` means *online competitions are strongly preferred,
but an offline competition may still be worth telling me about if other characteristics make it
compelling.*

---

## Side by side

| | Filter | Notification preference |
| --- | --- | --- |
| Question | What do I want to see now? | What is worth telling me about? |
| Nature | Strict retrieval constraint | Weighted relevance signal |
| Lifetime | One request, URL-scoped | Persisted, ambient |
| Effect of a mismatch | Excluded from results | Lower relevance, still possible |
| Who applies it | The user, deliberately, per session | Kizunia, continuously, in the background |

```text
Filters      -> strict retrieval
Preferences  -> weighted relevance
```

---

## The rule this produces

> **Notification preferences must not silently modify the user's normal competition search or
> filter experience.**

A user who tells Kizunia that online competitions matter to them has not asked for offline
competitions to disappear from search results. Browsing stays exactly as it was.

The converse also holds: applying a filter while browsing is not a statement of ongoing
preference, and must not quietly retrain what the user gets notified about.

---

## The one place they overlap

A preference with weight `1` is a **hard constraint**, and a hard constraint behaves like a filter
— it excludes rather than discounts. That overlap is deliberate and bounded: it applies only
within notification evaluation, never to what the user sees while browsing. See
[weights-and-constraints.md](weights-and-constraints.md).

---

## Consistency with the Search subsystem

The [Search specification](../../search/README.md) draws the same distinction in its product
framing, separating **Search**, **Filters**, **Saved Search**, **Preferences** and
**Recommendations** as five concepts that must never collapse into one, and stating that
recommendations *never silently override explicit filters*.

This specification owns the Preferences and Recommendations halves of that table for the
notification use case. The two documents must not drift: if either changes its position on how
preferences relate to filters, the other needs updating in the same change.
