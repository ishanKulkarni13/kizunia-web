# Technology

> **Status:** Stable
>
> **Version:** 2.0
>
> **Referenced By:** Projects, Competitions, Portfolios (Blogs — future)
>
> **Last Updated:** 2026-09-10

---

# Purpose

Technology is a centralized, platform-wide taxonomy entity — the canonical catalog every "what technology is this?" relationship in the platform points at.

This is the canonical reference for the Technology domain. Other docs that mention Technology (`tech-stack.md`, `user.md`, `blog.md`, feature specs) should link here rather than re-describing the model.

---

# Core Principle

**Technology itself is context-free. The entity consuming Technology determines the meaning of the relationship.**

Technology never encodes anything about how a particular consumer uses it — no frontend/backend flags, no competition-specific fields, no per-consumer `TechnologyType` variants. `type` describes what a Technology *is* (a language, a framework, a database, ...), never how any one consumer relates to it.

---

# Fields

| Field | Required | Unique | Description |
|-------|----------|--------|-------------|
| id | Yes | Yes | Primary identifier |
| name | Yes | Yes | Display name |
| slug | Yes | Yes | URL-safe identifier, admin-editable independently of `name` |
| type | Yes | No | What the Technology is — see `TechnologyType` below |
| description | No | No | Short description |
| iconAssetId | No | No | Optional Asset-backed icon (see Icons below) |
| deletedAt | No | No | Soft-delete marker — see Soft Delete below |
| createdAt | Yes | No | Creation timestamp |
| updatedAt | Yes | No | Last modification timestamp |

## TechnologyType

```
LANGUAGE FRAMEWORK LIBRARY DATABASE RUNTIME TOOL PLATFORM SERVICE OTHER
```

This enum is locked — it describes what the Technology *is*, not how any consumer uses it. Do not add consumer-specific values.

---

# Icons

Icons are Asset-backed, following the exact pattern already established by `Badge.iconAssetId` — no custom Technology-specific upload system. `AssetPurpose.TECHNOLOGY_ICON` is the purpose used when uploading a Technology's icon; the upload policy mirrors `BADGE_ICON` (`requiresTargetEntity: false`, since Technology has no per-instance owner at upload-intent time). A Technology may exist with no icon at all.

Authorization for setting/clearing an icon is `PlatformAction.MANAGE_TECHNOLOGIES` — the same action that governs every other change to the Technology entity. There is deliberately no separate `MANAGE_TECHNOLOGY_ICON` action: the actor authorized to manage the catalog is the actor authorized to manage every Technology's icon, because Technology has no per-instance ownership to further scope by.

See `docs/architecture/domain/assets/` for the general Asset lifecycle (upload intent → finalize → attach → reference-checked detach).

---

# Soft Delete

Technology supports soft deletion via `deletedAt`.

**For everyone except the dedicated Technology admin management surface, a deleted Technology behaves as if it does not exist.** This includes platform admins acting through normal consumer flows (attaching a technology to their Project, Competition, or Portfolio) — being a platform admin does not make a deleted Technology selectable in those flows.

Deleted Technologies are excluded from:
- The public taxonomy/filter-options endpoint (`GET /api/v1/technologies`).
- The authenticated catalog/picker endpoint used by Project/Competition/Portfolio editors (`GET /api/v1/technologies/catalog`).
- Any new attachment to a Project, Competition, or Portfolio.

**Existing relationships are never destroyed by a soft delete.** `ProjectTechnology`, `CompetitionTechnology`, and `PortfolioTechnology` rows referencing a deleted Technology remain in the database untouched — soft-deleting a Technology is a plain `UPDATE`, not a `DELETE`, so no cascade ever fires. An existing relationship can still be *removed* (detached) at any time, even if the Technology it points to is deleted — cleanup of a stale reference must always be possible. Restoring a Technology (`deletedAt` set back to `null`) makes its existing relationships immediately usable/visible again, under normal rules, with nothing needing to be recreated.

`name` and `slug` stay unique even for a soft-deleted Technology (the DB unique constraint doesn't care about `deletedAt`) — a new Technology cannot be created with the same identity as a soft-deleted one; the soft-deleted row must be restored instead.

## Restore

The only special operation available to a platform admin on a deleted Technology today is **restore** (`deletedAt → null`). Whether other properties (name, type, description, icon) should be editable while a Technology is still deleted is an open question, not yet decided — see the open questions in the implementation plan for this feature.

---

# Global Technology Management vs. Consumer Relationship Management

These are two distinct, deliberately separated concerns:

**Global Technology management** — creating, editing, soft-deleting, and restoring Technology entities themselves (the catalog). Gated by `PlatformAction.MANAGE_TECHNOLOGIES`, granted to platform `ADMIN`/`SUPER_ADMIN` roles.

**Consumer relationship management** — attaching/detaching an *existing* Technology to a Project, Competition, or Portfolio. Gated by that consumer's own permission:
- `ProjectAction.MANAGE_TECHNOLOGIES` — Project members with this permission (`OWNER`/`MAINTAINER`).
- `CompetitionAction.MANAGE_TECHNOLOGIES` — Competition members with this permission (`OWNER`/`ORGANIZER`/`MAINTAINER`).
- `PortfolioAction.MANAGE_TECHNOLOGIES` — the Portfolio owner.

**No consumer-relationship permission grants any authority over the global Technology catalog, and `MANAGE_TECHNOLOGIES` at the platform level does not by itself grant authority to edit any particular Project/Competition/Portfolio's relationships** (a platform admin reaches consumer data through the normal platform-override path used everywhere else in the authorization system, not through this action). A Project maintainer can attach/detach existing Technologies to their Project; they cannot rename a Technology or change its icon.

---

# Consumer Semantics

Technology is shared, but its meaning depends entirely on the consumer relationship:

## Projects — `ProjectTechnology`

Means technologies **actually used** in the Project's implementation/stack. Ordered (`displayOrder`) — the owner/maintainer controls presentation order.

## Competitions — `CompetitionTechnology`

Means technologies **relevant to** the Competition. This does **not** mean participants are required to use those technologies — no "required" concept exists on this relationship. Not ordered — `CompetitionTechnology` has no `displayOrder`.

## Portfolios — `PortfolioTechnology`

Means technologies the portfolio owner **intentionally wants to present** as part of their technical/professional profile. **Never auto-derived from `ProjectTechnology`** — only what the owner explicitly adds appears here. Carries relationship-specific metadata (`startedUsingAt`, `description`) and is ordered (`displayOrder`).

## Blogs — future, not implemented

See the dedicated section in `blog.md`. `BlogTechnology` would mean technologies materially discussed, demonstrated, or relevant to the blog post — no implementation exists yet, and none of the above changes anything about how Technology itself works when it eventually does.

---

# Ordering Matrix

| Consumer | Ordered? |
|---|---|
| ProjectTechnology | Yes — `displayOrder` |
| CompetitionTechnology | No |
| PortfolioTechnology | Yes — existing `displayOrder` |
| BlogTechnology (future) | Undecided — to be settled when Blog is actually implemented |

---

# Taxonomy API

`GET /api/v1/technologies` is a narrow, public, unauthenticated taxonomy/filter-options endpoint — `{ value: slug, label: name, count }` only, used by search/filter controls (competition and project discovery). It intentionally does **not** expose `type`, `icon`, or `description` — no consumer of it needs those fields. It is not the Technology read/management API.

Two other, separate read surfaces exist for the richer data:
- `GET /api/v1/technologies/catalog` — authenticated, active-only, lightweight (`id`, `name`, `slug`, `type`, `iconAsset`) — used by Project/Competition/Portfolio attach pickers.
- The admin management API under `/api/v1/admin/technologies/*` — full management representation, gated by `PlatformAction.MANAGE_TECHNOLOGIES`.

These three contracts are deliberately kept separate rather than merged.

---

# Removed: UserTechnology

Technology is **not** a direct User profile relationship. The previous `UserTechnology` join table (and `User.technologies` relation) has been removed entirely. `PortfolioTechnology` is the intentional, presentation-oriented replacement — a user who wants to show off their technology skills does so through their Portfolio, not through a direct User-level attachment.

# Removed: UserTechnology Notification Preference

No `UserTechnologyNotificationPreference` model, code, or route ever existed in this codebase — only design docs described one. Those docs have been corrected. A generic `NotificationPreference` model exists (email/push booleans plus a freeform JSON bag) but has no typed connection to Technology and is unaffected by this change. Future technology-aware notification/recommendation preferences are explicit future work, not designed or implemented as part of this feature — when built, they would read from `PortfolioTechnology`, not from a revived User-level technology relationship.

---

# Design Decisions

## Why context-free?

A single canonical Technology entity, with consumer-specific meaning attached only by the join relationship, avoids duplicating "what is React" four different ways for four different consumers, and keeps the catalog coherent as new consumers (Blog) are added later.

## Why soft delete instead of hard delete?

Projects, Competitions, and Portfolios can reference a Technology for a long time. Hard-deleting a Technology that's in active use elsewhere would either be blocked (annoying) or would silently destroy historical data (worse). Soft delete lets the catalog be curated (removing typos, duplicates, or technologies the platform no longer wants to promote) without breaking anything that already points at the deleted row.

## Why is icon authorization not per-instance?

Technology has no owner — it's a shared, platform-wide catalog. Unlike a Project's logo (owned by that Project's members) a Technology's icon has no natural "instance" to scope authorization to beyond the catalog itself.
