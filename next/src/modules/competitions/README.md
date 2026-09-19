# Competitions Module

## Purpose

Competition creation, registration, and management.

## Folder Structure

```
competitions/
├── README.md
├── index.ts
├── api/
├── backend/
│   ├── controller.ts
│   ├── service.ts
│   ├── repository.ts
│   ├── lifecycle.service.ts
│   ├── lifecycle.repository.ts
│   ├── mapper.ts
│   ├── permissions.ts
│   └── errors.ts
├── lifecycle/
│   ├── index.ts
│   └── resolver.ts
├── components/
├── hooks/
├── store/
├── schemas/
├── types/
├── utils/
├── constants.ts
└── metadata.ts
```

`lifecycle/` is deliberately outside `backend/`: `resolver.ts` has no
Prisma import and no server-only dependency — it is a pure function from
lifecycle dates and the current time to the status automation believes is
correct (`resolveAutomaticStatus`). `backend/lifecycle.service.ts` is its
only caller; it owns the database access, transactions, and the
preview/apply/sweep orchestration that use it. See
`docs/architecture/workflows/competition/lifecycle-automation.md` for the
precedence rules and the cron/admin/date-edit integration.

## Per-user state — bookmarks & mark-as-registered

Two independent relationships between a `User` and a `Competition`:

- `CompetitionBookmark` — "save this for later." Never implies registration.
- `CompetitionRegistration` — the user's own, **self-declared and
  unverified** claim that they registered on the organizer's external
  platform. Kizunia is a discovery platform, not the organizer, and has no
  channel to confirm this.

**Fully independent.** Neither table's repository or service imports the
other's. All four combinations of `(bookmarked, registered)` are legal, and
no write to one ever touches the other.

**Never removed by lifecycle.** No `CompetitionStatus` transition —
including `REGISTRATION_CLOSED`, `ONGOING`, `COMPLETED`, `CANCELLED` — and
no admin action on the competition ever deletes either row. Only the user's
own explicit request does. "Past vs upcoming" is derived at read time from
the competition's dates, never by deleting rows. Marking as registered is
allowed at every status — there is deliberately no "registration is
closed" guard (see `CompetitionRegistrationService`'s docblock).

**Why a batch endpoint instead of a field on the public DTOs.** The
competition list page is a Server Component that must stay cacheable,
shareable and indexable — adding `isBookmarked` to `CompetitionCardDTO`
would make every search response user-specific. The detail page fetches
over HTTP without forwarding cookies, so its DTO cannot carry per-user
state at all. Instead, `GET /api/v1/me/competition-states` batch-resolves
bookmark/registration state for a set of ids in one request, called
client-side after first paint by `CompetitionUserStateProvider`
(`components/user-state/`). An anonymous caller gets an empty answer
(`200`, not `401`) — "signed out" is a normal, successful state for this
read.

**id, not slug.** The per-user mutation endpoints
(`PUT`/`DELETE /api/v1/me/competitions/[id]/bookmark`, `.../registration`)
are keyed by competition id, unlike the public slug-keyed read route.
Slugs are mutable; ids are stable, and `CompetitionCardDTO`/
`CompetitionDetailDTO` already carry `id`. They also live under `/me/`
rather than beside the public `[slug]/` route, because Next.js does not
allow two differently-named dynamic segments (`[id]` and `[slug]`) at the
same route level.

**Visibility.** Bookmarking/registering reuses
`CompetitionAuthorizer.read` — the same rule that governs viewing a
competition — rather than a bookmark-specific visibility rule. A banned
actor or a private/deleted competition is rejected the same way
`findBySlug` already rejects them. Removing a bookmark or registration
mark is deliberately unguarded: it must always be possible to clear your
own record, including for a competition that has since been archived or
soft-deleted.

## Public API

```ts
import { ... } from "@/modules/competitions";
```

Other modules should **never** import internal files directly.
