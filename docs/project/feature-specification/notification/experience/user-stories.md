# User Story Register

> **Status:** Live
>
> **Last Updated:** 2026-09-12

Every user story from the Notifications design sessions, with its scope status and where it is
specified.

**Status meanings:**

| Status | Meaning |
| --- | --- |
| **Phase 1** | Being built now; specified in this documentation set |
| **Future** | Wanted, not designed, not built. Recorded in [`future/`](../future/README.md) |
| **Non-goal** | Explicitly declined. Not a deferral |
| **Existing** | Already implemented outside this subsystem |

---

## 1. Notification inbox

| ID | Story | Status | Where |
| --- | --- | --- | --- |
| US-01 | Receive notifications relevant to me | **Phase 1** | [`inbox.md`](inbox.md) |
| US-02 | View my notifications in one place | **Phase 1** | [`inbox.md`](inbox.md) |
| US-03 | Distinguish unread notifications | **Phase 1** | [`inbox.md`](inbox.md), [`history/user-response.md`](../history/user-response.md) |
| US-04 | Open the resource associated with a notification | **Phase 1** | [`inbox.md`](inbox.md) |

## 2. Competition discovery

| ID | Story | Status | Where |
| --- | --- | --- | --- |
| US-05 | Be notified when Kizunia finds a competition relevant to my preferences | **Phase 1** | [`intents/top-relevant-competition.md`](../intents/top-relevant-competition.md) |
| US-06 | Group multiple relevant competitions into a single notification | **Future** | [`future/notification-intents.md`](../future/notification-intents.md) |
| US-07 | Enable or disable relevant-competition notifications | **Phase 1** | [`preferences/notification-preferences.md`](../preferences/notification-preferences.md) |
| US-08 | Control how many relevant competitions I am notified about | **Future** | [`future/notification-intents.md`](../future/notification-intents.md) |

> **Note on US-06 and US-08.** Phase 1's discovery intent surfaces exactly one competition
> ([ND-I-06](../decisions/intents.md#nd-i-06--top_relevant_competition-selects-exactly-one-competition)).
> An aggregated multi-competition digest with a configurable volume is a **separate future intent**,
> not a setting on the Phase 1 one. See
> [R-02](../decisions/reconciliations.md#r-02--top_relevant_competition-selection-count).

## 3. Competition bookmark

The bookmark feature itself already exists. The design notes used "wishlist" and "waitlist"
interchangeably; this specification uses **bookmark** exclusively
([R-04](../decisions/reconciliations.md#r-04--bookmark-not-wishlist)).

| ID | Story | Status | Where |
| --- | --- | --- | --- |
| US-09 | Add a competition to bookmarks | **Existing** | Competition domain (`CompetitionBookmark`) |
| US-10 | Remove a competition from bookmarks | **Existing** | Competition domain |
| US-11 | Be notified when a bookmarked competition's deadline approaches | **Phase 1** | [`intents/registration-closing.md`](../intents/registration-closing.md) |
| US-12 | Enable or disable bookmark deadline notifications | **Phase 1**, folded | [`preferences/notification-preferences.md`](../preferences/notification-preferences.md) |

> **Note on US-12.** Bookmark deadlines and relevant-competition deadlines are one intent with one
> toggle in Phase 1, not two independent controls. See
> [R-03](../decisions/reconciliations.md#r-03--deadline-notification-preferences).

## 4. Relevant competition deadlines

| ID | Story | Status | Where |
| --- | --- | --- | --- |
| US-13 | Be notified when a deadline approaches for a competition relevant to me | **Phase 1** | [`intents/registration-closing.md`](../intents/registration-closing.md) |
| US-14 | Enable or disable relevant-competition deadline notifications | **Phase 1**, folded | [`preferences/notification-preferences.md`](../preferences/notification-preferences.md) |

The distinction the stories draw still holds conceptually — a relevant competition is *"I might be
interested"* while a bookmarked one is *"I explicitly saved this"* — but both make a user eligible
for the same notification, deduplicated into one
([ND-I-11](../decisions/intents.md#nd-i-11--eligibility-is-relevant-or-bookmarked-excluding-marked-as-registered),
[ND-I-12](../decisions/intents.md#nd-i-12--one-notification-per-deadline-event)).

## 5. Competition lifecycle

| ID | Story | Status | Where |
| --- | --- | --- | --- |
| US-15 | Registration opened | **Future** | [`future/notification-intents.md`](../future/notification-intents.md) |
| US-16 | Registration closing | **Phase 1** | [`intents/registration-closing.md`](../intents/registration-closing.md) |
| US-17 | Registration closed | **Future** | [`future/notification-intents.md`](../future/notification-intents.md) |
| US-18 | Competition started | **Non-goal** | [R-05](../decisions/reconciliations.md#r-05--explicit-non-goals-not-deferrals) |
| US-19 | Competition cancelled | **Future** | [`future/notification-intents.md`](../future/notification-intents.md) |
| — | Competition completed | **Non-goal** | Intentionally excluded |

> **US-15 note.** A competition becoming registration-open already makes it eligible for the next
> discovery evaluation, so Phase 1 gets the practical outcome without a dedicated intent
> ([ND-I-09](../decisions/intents.md#nd-i-09--becoming-registration-open-needs-no-separate-lifecycle-notification)).
> An explicit `REGISTRATION_OPENED` intent remains possible later
> ([ND-I-15](../decisions/intents.md#nd-i-15--registration_opened-is-outside-phase-1)).
>
> **US-17 note.** No standalone "registration closed" notification exists, because after closure
> the user can no longer act
> ([ND-I-14](../decisions/intents.md#nd-i-14--no-standalone-registration_closed-notification)).

## 6. User-declared competition status

Kizunia does not know who actually registered for or participated in an external competition. The
user can explicitly tell it.

| ID | Story | Status | Where |
| --- | --- | --- | --- |
| US-20 | Mark a competition as registered | **Existing** | Competition domain (`CompetitionRegistration`); consumed by [`intents/registration-closing.md`](../intents/registration-closing.md) |
| US-21 | Mark a competition as participated | **Non-goal** | [R-05](../decisions/reconciliations.md#r-05--explicit-non-goals-not-deferrals) |

These are **user-provided relationships**, never verified registration data from the competition
platform
([ND-I-16](../decisions/intents.md#nd-i-16--recipient-rules-use-only-relationships-kizunia-knows)).

## 7. Competition updates

| ID | Story | Status | Where |
| --- | --- | --- | --- |
| US-22 | Receive an admin-designated competition update | **Future** | [`future/notification-intents.md`](../future/notification-intents.md) |
| US-23 | As an admin, choose which users receive a competition update | **Future** | [`future/notification-intents.md`](../future/notification-intents.md) |

The design position is recorded for when these are built: the **admin** decides whether an update
warrants a notification, so the system never has to decide whether an arbitrary field change is
important. Recipients may only be drawn from relationships Kizunia actually knows — bookmarked
users, users who marked themselves registered, relevant users — never an assumed set of registered
participants.

## 8. Notification preferences

| ID | Story | Status | Where |
| --- | --- | --- | --- |
| US-24 | Independently control different types of notification | **Phase 1**, partially | [`preferences/notification-preferences.md`](../preferences/notification-preferences.md) |

Phase 1 implements per-intent control for the two intents that exist. The broader preference tree
identified during design — competition updates, portfolio contact, platform features, promotional —
is future scope and is listed in
[`preferences/notification-preferences.md`](../preferences/notification-preferences.md#future-preference-surface).

## 9. Notification limits

| ID | Story | Status | Where |
| --- | --- | --- | --- |
| US-25 | Specify how many relevant competitions to be notified about | **Future** | [`future/notification-intents.md`](../future/notification-intents.md) |
| US-26 | Specify a maximum overall notification volume | **Future** | [`future/README.md`](../future/README.md) |

The exact meaning of a volume limit is undefined — whether it applies per batch, per day, or over
another period was explicitly left for later. Phase 1 has exactly one volume control: the maximum
number of competitions in the `REGISTRATION_CLOSING` summary
([ND-P-13](../decisions/preferences.md#nd-p-13--registration_closing-exposes-a-user-configurable-maximum)).

## 10 to 12. Portfolio, platform and subscription notifications

| ID | Story | Status | Where |
| --- | --- | --- | --- |
| US-27 | Portfolio contact notification | **Future** | [`future/notification-intents.md`](../future/notification-intents.md) |
| US-28 | Platform feature notification | **Future** | [`future/notification-intents.md`](../future/notification-intents.md) |
| US-29 | Control promotional notifications | **Future** | [`future/notification-intents.md`](../future/notification-intents.md) |
| US-30 | Subscription notification | **Future** | [`future/entitlements.md`](../future/entitlements.md) |

Architectural space is left for these; the subscription domain itself is not designed.

## 13. Plan-based access

| ID | Story | Status | Where |
| --- | --- | --- | --- |
| US-31 | Kizunia respects the notification capabilities included in my plan | **Future** | [`future/entitlements.md`](../future/entitlements.md) |

Relevant-competition notifications and portfolio contact notifications were identified as
*potentially* paid capabilities. The notification system must be able to support entitlements
without invasive change; the subscription system itself is future scope.

---

## Coverage summary

| Status | Count | Stories |
| --- | --- | --- |
| Phase 1 | 10 | US-01, 02, 03, 04, 05, 07, 11, 12, 13, 14, 16, 24 (partial) |
| Existing | 3 | US-09, US-10, US-20 |
| Future | 14 | US-06, 08, 15, 17, 19, 22, 23, 25, 26, 27, 28, 29, 30, 31 |
| Non-goal | 3 | US-18, US-21, competition completed |

Every story from the source register is accounted for. None were dropped.
