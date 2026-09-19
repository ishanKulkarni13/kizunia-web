# Portfolio

> **Status:** Stable
>
> **Version:** 1.1
>
> **Referenced By:** Users
>
> **Last Updated:** 2026-09-07

---

> **Current Scope vs Future Vision**
>
> This document describes the Portfolio domain as it exists today. Several
> sections below (themes, custom domains, PDF export, analytics, Team/Blog
> highlighting) describe **future** capabilities, not current behavior —
> see [Future Expansion](#future-expansion). Where a section is aspirational
> rather than implemented, it says so explicitly.

# Purpose

The Portfolio model represents the public engineering profile of a builder.

A Kizunia Portfolio owns its own presentation-specific content (headline,
bio, contact fields, links, technologies, education, experience,
achievements, certifications) and genuinely owns its Testimonials. It does
**not** own Projects — it references them, and each referenced Project's
own visibility/status/deletion rules are respected wherever the Portfolio
presents it.

The portfolio acts as the public face of a builder while the actual engineering work continues to exist as independent entities.

---

# Design Philosophy

A portfolio should be generated from real work.

Builders should spend time building rather than maintaining portfolios.

The portfolio therefore serves as a presentation layer rather than a storage layer.

Projects remain Projects.

Blogs remain Blogs.

Teams remain Teams.

The portfolio simply decides what should be highlighted.

---

# Responsibilities

The Portfolio model is responsible for:

- Its own presentation fields (headline, bio, location, public contact fields, settings)
- Owning Testimonials (a real relation, cascades on delete — not a reference)
- Owning Links, Technologies, Education, Experience, Achievements, Certifications
- Referencing Projects (via `PortfolioProject`), respecting each Project's own visibility/status/deletion state
- Portfolio-level visibility (Public / Private)

The Portfolio model is **not** responsible for:

- Owning Projects — it references them, never duplicates their data
- Owning Teams — no such integration exists yet (future)
- Managing account identity — that belongs to `User` (see [Identity](#identity))

**Blogs:** the Portfolio is intended to reference Blogs the same way it references Projects, once a Blog domain exists. There is currently no `Blog` Prisma model in this codebase, so Blog-referencing is documented here as future scope, not current behavior.

---

# Ownership

Every User has **at most one** Portfolio (0..1) — not exactly one.

A Portfolio cannot exist without a User.

Portfolio creation is an **explicit, user-initiated action**. It is never
triggered automatically by signup or onboarding.

Creation is gated by a backend-enforced entitlement boundary
(`PlatformAction.CREATE_PORTFOLIO`). Today, every authenticated,
non-banned role is granted this as a baseline capability — there is no
subscription/plan system yet. The boundary exists so a future plan or
entitlement system can restrict portfolio creation by changing a
permission set entry, without any change to `PortfolioService.create` or
`PortfolioPolicy`. See [Editor API vs Public API](#editor-api-vs-public-api).

A banned user is not automatically prevented from editing an existing
Portfolio — only from creating a new one (via the same platform policy
that denies every platform action to banned actors) and from having that
Portfolio be publicly visible (see [Visibility](#visibility)).

---

# Identity

Unlike other entities, Portfolios do not require slugs.

Portfolio URLs always use the builder's username.

```
/u/{username}
```

Examples:

```
/u/ishankulkarni13

/u/john

/u/sarah-dev
```

A Portfolio may exist without its owner having a username. In that case it
is simply **not publicly reachable** — there is no valid URL for it, since
the public route is keyed by username. This is not an error state.

Changing or removing a username changes or breaks the Portfolio's public
URL. Any user-facing username-change flow must warn about this before the
change is applied. The Portfolio creation flow and the editor's "Change
Username" action both use Better Auth's `username` plugin
(`authClient.updateUser({ username })`) directly — there is no separate
Portfolio-owned username system.

---

# Customization

The Portfolio's actual current fields are:

| Field | Description |
|------|-------------|
| `displayName` | Public display name shown on the portfolio |
| `headline` | Short one-line tagline |
| `bio` | Longer free-text biography |
| `phone`, `publicContactEmail` | Public contact fields — see [Public Contact Fields](#public-contact-fields) |
| `location` | Free-text location |
| `visibility` | `PUBLIC` or `PRIVATE` — see [Visibility](#visibility) |
| `settings` | Theme, accent color, section order, hidden sections |
| `links` | Arbitrary external links |
| `technologies`, `education`, `experience`, `achievements`, `certifications` | Owned presentation content |
| `testimonials` | Owned Testimonials (see [Responsibilities](#responsibilities)) |
| `resumeAsset` | An attached resume `Asset` |
| `projects` | References to `Project` rows via `PortfolioProject` |

Everything else should be generated from relationships.

---

# Introduction

Builders may write a custom introduction, implemented today as the
Portfolio's `bio` field (there is no separate `introduction` field).

The introduction should answer questions such as:

- Who am I?
- What do I enjoy building?
- What am I currently working on?

The introduction complements the User bio rather than replacing it.

---

# Portfolio Projects

Builders may attach Projects they actively participate in to their
Portfolio, mark some as featured, and control their display order. This is
**relationship management only** — the Portfolio never becomes a Project
editor. It never modifies a Project's title, description, visibility,
status, members, content, technologies, categories, badges, testimonials,
media, competitions, or ownership. It controls exactly two things: whether a
Project is associated with the Portfolio, and whether that association is
featured.

## Data model

The relationship is the `PortfolioProject` model — a composite-key join
table (`@@id([portfolioId, projectId])`), not a synthetic `id`. That
composite key doubles as the authorization boundary: every mutation is
scoped by `(portfolioId, projectId)`, and `portfolioId` is always resolved
from the authenticated session, never accepted from a client. There is no
opaque relationship id for a client to guess.

- `featured` — a property of the *relationship*, not the Project. The same
  Project can be featured on one Portfolio and not on another.
- `displayOrder` — presentation order within the Portfolio, assigned when a
  Project is added and rewritten wholesale on reorder. Featured and order
  are independent: featuring a Project does not move it in the list, and
  there is no requirement that featured Projects occupy the first
  positions.
- `hidden` — **deprecated and unused.** No DTO exposes it, no API writes it,
  and no product behavior depends on it. It is retained in the schema
  purely because the pre-existing public query already filters on it
  (`hidden: false`); that filter is kept unchanged so existing behavior
  doesn't shift, but no new semantics have been assigned to the field. It
  is planned for removal in a future schema cleanup.

## Eligibility

Any **active ProjectMember** may add that Project to their own Portfolio —
`OWNER`, `MAINTAINER`, and `CONTRIBUTOR` all qualify. This is deliberately
*not* `ProjectAction.EDIT` or any other Project-side permission: a
`CONTRIBUTOR` holds only `ProjectAction.VIEW` under `ProjectPermissionSet`,
yet must still be able to showcase a Project they work on. Adding a Project
therefore requires two independent checks, both derived from trusted
server-side state:

1. **Portfolio ownership** — the actor must own the Portfolio, resolved from
   the session via `PortfolioAction.MANAGE_PROJECTS`.
2. **Project membership** — the actor must hold a `ProjectMember` row for
   the target Project. Membership is binary in this schema (the row exists
   or it doesn't; there is no status field), so existence is the whole
   check.

Removing a relationship requires only Portfolio ownership — **not** current
membership. A user removed from a Project must still be able to clear the
stale relationship from their own Portfolio. Featuring a relationship
requires both checks, like adding.

## The membership invariant

A `PortfolioProject` relationship is valid only while the Portfolio owner
remains an active member of the Project. There is currently no
`ProjectMember` removal/leave workflow anywhere in the codebase — membership
only ever ends today via a cascading `User` deletion — so this invariant is
enforced **at query time**, not by cleanup: every read of `PortfolioProject`
(both the editor and the public portfolio) joins `ProjectMember` and returns
only relationships where the owner is still a member. The instant that row
disappears, the Project stops appearing everywhere, even though the
`PortfolioProject` row itself is untouched and reappears automatically if
membership is restored.

A seam exists for whoever eventually builds `ProjectMember` removal:
`PortfolioProjectService.removeForMembershipEnd({ tx, projectId, userId })`
takes a `Prisma.TransactionClient` so relationship cleanup can be enlisted in
that workflow's own transaction. Nothing calls it today — correctness does
not depend on it being wired up.

## Editor visibility vs. public visibility

These are deliberately different queries.

**Editor** — a Project appears if the relationship exists and the owner is
still an active member. There is **no** Project visibility or status
filter: `DRAFT`, `PRIVATE`, and `UNLISTED` Projects all appear, so the owner
can keep managing (feature, reorder, remove) a relationship to a Project
that isn't public yet. The editor surfaces `status` and `visibility` on each
row so the owner can tell which Projects will and won't render publicly.

**Public** — a Project appears only if, in addition to the editor's rule, it
passes the Project module's own public-listability predicate
(`publiclyListableProjectWhere` in `modules/projects/backend/visibility.ts`:
not deleted, `visibility: PUBLIC`, `status: PUBLISHED`) and the pre-existing
`hidden: false` filter. This predicate is defined once in the Projects
module and consumed by the Portfolio's public query — never duplicated. A
Portfolio being public never widens what a Project itself is willing to
show; Project authorization remains authoritative.

## Project deletion

Projects are soft-deleted (`deletedAt`). `ProjectService.delete` performs no
`PortfolioProject` cleanup, and none is required: both the editor and public
queries already filter `project.deletedAt: null`, so a deleted Project is
immediately and permanently invisible through the Portfolio without any
side effect on the (reversible, in principle) delete operation.

---

# Portfolio Testimonials

Unlike Portfolio Projects, this is genuine ownership, not a reference:
Testimonials are Portfolio-owned content, created, edited, and deleted
entirely within the Portfolio's own data (see
[Responsibilities](#responsibilities)). A Testimonial belongs to exactly
one parent — this Portfolio, or a Project, never both — and a Project's own
Testimonials (see [project.md](project.md#testimonials)) are entirely
independent records, even when they describe the same person or quote.

## Data model

Testimonials share a single Prisma model (`Testimonial`) with Project
Testimonials — one Postgres table, with nullable `portfolioId` and
`projectId` foreign keys — but the read/write stacks are fully separate:
`PortfolioTestimonialRepository`/`Service`, scoped exclusively by
`portfolioId`, never touch a row's `projectId`. "Exactly one parent" is an
application-level invariant only (each domain's service writes only its own
FK and leaves the other null); there is intentionally no database-level XOR
constraint yet — see the comment on the `Testimonial` model in
`schema.prisma`.

Fields: `name`, `position` (optional), `company` (optional), `message`,
`rating` (optional, 1–5), an optional image (via the Asset system, purpose
`PORTFOLIO_TESTIMONIAL_IMAGE`), and `displayOrder` (schema default `100`,
matching `PortfolioProject`'s append-at-the-end convention).

The person referenced by a Testimonial is **not** a Kizunia User — it is
presentation data supplied by the Portfolio owner. Kizunia does not verify
that the person exists or endorsed the quote.

## Authorization

Testimonial management is **owner-only** — there are no collaborators on a
Portfolio, unlike Project membership roles. Gated by
`PortfolioAction.MANAGE_TESTIMONIALS`, resolved from the session exactly
like `MANAGE_PROJECTS`: the Portfolio is always the actor's own
(`portfolioRepository.findForAuthorizationByUserIdOrThrow`), never a
client-supplied id. Image management (attach, replace, remove a
testimonial's photo) is part of testimonial management — there is no
separate image-management action.

## Ordering

Persisted via a dedicated reorder endpoint (`PATCH
/api/v1/portfolio/testimonials`) that validates the request is an exact
cover of the portfolio's testimonial ids using the same
[`isExactCover`](../../../next/src/modules/links/utils/reorder.ts) utility
Portfolio Projects and Project Links both already use, inside a
transaction — a partial, duplicate, or foreign-id reorder request is
rejected and leaves ordering untouched.

## Public visibility

The public Portfolio DTO (`PortfolioPublicDto.testimonials`) already
includes Testimonials, correctly ordered and mapped through a safe, flat
shape — but there is currently **no public Portfolio page** in the frontend
to render it (only the public `/api/v1/portfolio/[username]` API exists).
Building that page is out of scope for the Testimonials feature; a reusable
presentation component (`PortfolioTestimonials`, mirroring the Project
side's `ProjectTestimonials`) exists and is ready to be wired in whenever
that page is built.

## Deletion

Hard delete, consistent with Portfolio Projects and Links (neither has a
`deletedAt`). Deleting the Portfolio cascades to delete its Testimonials at
the database level, but this only fires on a genuine hard delete — ordinary
"delete portfolio" flows soft-delete the Portfolio and leave Testimonial
rows intact.

---

# Featured Blogs (Future)

Builders may highlight important blog posts.

Examples include:

- Engineering articles
- Project write-ups
- Tutorials
- Hackathon experiences

Featured blogs should appear before the complete list of blogs.

**Not implemented today** — there is no `Blog` Prisma model in this
codebase yet. This section describes the intended shape once a Blog
domain exists; the Portfolio will reference Blogs the same way it
references Projects.

---

# Featured Teams (Future)

Builders may choose to highlight important teams.

Examples include:

- Open Source Team
- SIH Team
- Research Group

Feature ordering should be configurable.

**Not implemented today** — no Team-highlighting integration exists yet.

---

# Visibility

Portfolios support exactly two visibility levels:

- Public
- Private

A previous `UNLISTED` level was removed from the schema entirely. Any
existing rows that held it were conservatively migrated to `PRIVATE`
(narrowing exposure, never widening it) — see the
`remove_portfolio_unlisted_visibility` migration.

Visibility affects the entire portfolio rather than individual projects.

Referenced Projects continue using their own visibility/status/deletion
rules — a Portfolio being `PUBLIC` never overrides a `PRIVATE` or
unpublished Project it references.

A banned user's Portfolio is **never** publicly visible, regardless of its
`visibility` value — this is enforced at the repository query boundary
(the public lookup requires `visibility: PUBLIC`, `deletedAt: null`, and
the owning `User` to be both matched by username and not banned), not by
a frontend check.

---

# Generated Content

The following information should always be generated automatically.

Examples include:

- Complete Project List
- Complete Blog List
- Complete Team List
- Verification Badges
- Technologies
- Statistics
- Recent Activity

The Portfolio should never duplicate this information.

---

# Statistics

Portfolio statistics should be computed.

Examples include:

- Projects
- Teams
- Blogs
- Technologies
- Hackathons

Statistics should never be stored directly inside the Portfolio.

---

# Verification

Verification is inherited from the User.

The Portfolio does not maintain separate verification information.

---

# Search

Portfolios should be searchable using:

- Username
- Display Name
- Headline
- Technologies
- Featured Projects

Search should rely on structured data rather than parsing introductions.

---

# Public Contact Fields

`Portfolio.publicContactEmail` and `Portfolio.phone` are intentionally
**public presentation fields**, independent of the User's private account
email. A builder may publish a different, more public-facing contact
address than the one used to log in. If populated, both fields are
included in the public API response (`PortfolioPublicDto`). No other
account/private fields (account email, raw user id, etc.) are ever
exposed this way.

---

# Editor API vs Public API

The Portfolio module exposes two distinct API contracts, both served by
the same `PortfolioController`/`PortfolioService` (separated by method,
not by class — consistent with the rest of the codebase):

- **Editor API** — authenticated, owner-scoped (`findMine`, `create`,
  `updateProfile`). Returns `PortfolioEditorDto`. Every query is scoped by
  the actor's own id from the session; there is no id-based editor route
  that could be pointed at another user's portfolio.
- **Public API** — anonymous, keyed by username (`findPublicByUsername`).
  Enforces `visibility: PUBLIC`, `deletedAt: null`, owner has a username,
  and owner is not banned. Returns `PortfolioPublicDto` — an explicit,
  hand-mapped contract, never a raw Prisma entity.

**Portfolio Projects** is its own owner-scoped sub-resource
(`PortfolioProjectService`/`PortfolioProjectRepository`, not folded into
the module's general service/repository — mirroring how Project Links get
their own dedicated files), served at `/api/v1/portfolio/projects` and
`/api/v1/portfolio/projects/[projectId]`. No route accepts a portfolio id;
every handler resolves the portfolio from the session, exactly like
`updateProfile`. Its own summary DTO (`PortfolioProjectSummaryDto`) is
deliberately narrower than `PortfolioEditorDto`'s embedded relations —
see [Portfolio Projects](#portfolio-projects) above for the editor/public
distinction.

The public contract is intentionally "reasonably rich" beyond what the
current frontend renders, because it is designed to also support future
third-party consumers (e.g. an external site rendering a builder's
portfolio via an API key). **API-key authentication for third parties is
not implemented** — this is a structural note about the DTO's shape, not
a claim that the capability exists yet.

---

# Frontend Editor

The authenticated editor lives at `/portfolio/edit`, with route-driven
sections under it (`/portfolio/edit/profile`, `/portfolio/edit/links`,
etc.) — the active tab is derived from the URL, matching the Project
Editor's convention (`src/modules/projects/frontend/components/editor/`).
`/portfolio` itself only handles the empty/create state and, once a
Portfolio exists, links into the editor — it no longer renders the editor
inline.

**Profile**, **Projects**, and **Testimonials** are working editors today.
The remaining tabs (Links, Technologies, Education, Experience,
Achievements, Certifications, Settings) are real routes with a
placeholder component, establishing the route/component boundary for each
without a backend contract to back them yet.

State follows the Project Editor's split: a shared `portfolio.store.ts`
(current Portfolio, loading/error, create, `setPortfolio` for mutation
write-back) plus a per-section store once a section has real state to
hold — `portfolio-profile.store.ts` (dirty tracking, field errors, batched
save) for Profile, `portfolio-projects.store.ts` (list-immediate:
every mutation persists right away and replaces the list wholesale with
the server's authoritative response, mirroring Project Links'
`project-links.store.ts`) for Projects, and
`portfolio-testimonials.store.ts` (same list-immediate pattern) for
Testimonials. Neither the Projects nor the Testimonials section writes
back into the shared `portfolio.store.ts` — each is a sibling resource
with its own endpoint, not a field of the Portfolio
entity.

Any feature that requires a Portfolio to exist should wrap itself in
`<PortfolioRequired>` (`src/modules/portfolio/frontend/components/
portfolio-required.tsx`), which centralizes the existence check, the
Create Portfolio prompt, and the missing-username sub-flow (via the
existing `UsernameDialog`, using Better Auth's `updateUser`) behind one
reusable component instead of duplicating the sequence per feature.

---

# Design Decisions

## Why a Separate Portfolio Model?

A dedicated Portfolio model cleanly separates identity from presentation.

The User model represents the builder.

The Portfolio model represents how that builder is showcased.

This separation keeps both models focused on their own responsibilities.

---

## Why No Slug?

Portfolio URLs already use usernames.

Adding another slug would duplicate functionality.

---

## Why Generated Content?

Projects, blogs, teams, and statistics already exist elsewhere.

Duplicating them would introduce synchronization problems.

Instead, the Portfolio references them through relationships and presentation settings.

---

## Why Store Featured Items?

Featured ordering cannot be derived automatically.

Storing only the curated lists allows the portfolio to remain highly customizable while avoiding unnecessary duplication.

---

# Future Expansion

Potential future capabilities include:

- Portfolio themes
- Custom color accents
- Custom sections
- Resume export
- PDF generation
- Portfolio analytics
- Custom domains

These features should extend the Portfolio model without changing its core philosophy.

---

# Guiding Principle

The Portfolio model should answer one question:

> **How should this builder's work be presented?**

It should never become the source of truth for projects, teams, blogs, or achievements.

Those entities continue to own their own data.

The Portfolio simply curates and presents them in a meaningful way.