# Asset — Overview

> **Status:** Draft (Target Architecture)
>
> **Version:** 1.0
>
> **Referenced By:** Users, Projects, Competitions, Competition Suggestions, Portfolios, Badges, Testimonials
>
> **Supersedes:** [`docs/architecture/domain/media.md`](../media.md)
>
> **Last Updated:** 2026-09-05

---

# Purpose

An **Asset** is a platform-owned uploaded resource together with its lifecycle and metadata.

It is the single reusable concept Kizunia uses whenever any part of the platform needs to let someone upload a file and attach it to something else — a user avatar, a competition banner, a portfolio resume, a gallery image.

This document, and the rest of the files in this folder, describe the **target architecture** for the Asset system. Where the current repository differs, that is called out explicitly under **Current Implementation** call-outs. The current code is real and working, but it is not the final shape of this system — see [Current State vs Target State](#current-state-vs-target-state) below.

---

# The Central Principle: Asset != Cloudinary

Kizunia currently stores uploaded files using Cloudinary. That is an infrastructure choice, not a domain concept.

> **Cloudinary is a storage provider. It is not part of what an Asset *means*.**

The Asset domain (its meaning, its lifecycle, its metadata, the rules about who can create or remove one) must not be architecturally dependent on Cloudinary. The dependency should run the other way: Cloudinary is one implementation of a storage-provider contract that the Asset system depends on.

This does **not** mean a migration away from Cloudinary is planned or decided. It means the Asset domain must be written so that such a migration is *possible* without rewriting the domain and application layers. See [`storage.md`](./storage.md) for the provider-abstraction design this implies.

---

# Asset Categories

The Asset system recognizes a small, controlled set of categories rather than an open-ended list of file types:

- **IMAGE**
- **VIDEO**
- **DOCUMENT**

This mirrors the platform's real needs — avatars, logos, banners, and galleries are images; a portfolio resume is a document; a future demo upload would be a video — without generalizing into a vague `FILE` / `BLOB` / `OTHER` model that says nothing about what the asset is for.

Categories are deliberately coarse. They classify *what kind of thing* an Asset is, not *what it's used for* — that second question belongs to [Upload Policies](./policies.md).

**Current Implementation:** The Prisma `Asset` model has no category field at all. There is an `AssetProvider` enum (`CLOUDINARY` only) and optional `format` / `mimeType` strings, but nothing that classifies an Asset as IMAGE, VIDEO, or DOCUMENT. In practice every Asset created today is an image — the upload path only ever calls Cloudinary's `image/upload` endpoint (see [`upload.md`](./upload.md)) — even though the schema already has a `Portfolio.resumeAsset` relation that is conceptually a DOCUMENT (a PDF). Introducing an explicit category is a target-architecture requirement, not a description of what exists.

---

# Asset Metadata

Conceptually, an Asset carries two kinds of metadata:

| Kind | Description | Examples |
|---|---|---|
| **Domain metadata** | Meaningful to Kizunia regardless of provider | category, lifecycle state, original filename, byte size, checksum, who uploaded it, what purpose it was uploaded for |
| **Provider metadata** | Meaningful only to the storage provider | Cloudinary `public_id`, resource type string, transformation URLs, delivery format |

The domain/application layer should only ever need the first kind. Provider metadata should stay behind the storage-provider adapter (see [`storage.md`](./storage.md)).

**Current Implementation:** The `Asset` model mixes both kinds of metadata in one table: `provider`, `publicId` (a Cloudinary concept — Cloudinary's `public_id`), `secureUrl`, `format`, `mimeType`, `width`, `height`, `bytes`, `checksum`, `originalFilename`. There is no separation between what the domain needs and what the provider happens to return. This is flagged again in [`storage.md`](./storage.md) as a boundary the current schema does not yet respect — the exact remediation (e.g. isolating provider fields into their own structure) is an implementation decision, not one this document makes.

---

# Relationships to Domain Entities

An Asset is a reusable, standalone resource. A domain entity (User, Project, Competition, Portfolio, …) *references* an Asset; it does not own it outright, because the same architectural shape is reused for many different attachment points across the platform.

Verified against the current Prisma schema, the entities that reference `Asset` today are:

| Entity | Relation | Cardinality |
|---|---|---|
| `User` | avatar, cover | one Asset each, optional |
| `Competition` | logo, banner, cover | one Asset each, optional |
| `CompetitionSuggestion` (via `CompetitionSuggestionAsset`) | gallery-style asset collection | many, **ordered** (`order` field) |
| `Project` | logo, cover | one Asset each, optional |
| `Portfolio` | resume | one Asset, optional |
| `PortfolioEducation` | institution logo | one Asset, optional |
| `PortfolioExperience` | company logo | one Asset, optional |
| `PortfolioAchievement` | asset | one Asset, optional |
| `PortfolioCertification` | asset | one Asset, optional |
| `Testimonial` | image | one Asset, optional |
| `Badge` | icon | one Asset, optional |

Every one of these is an **explicit, named foreign key relation** (`onDelete: SetNull` in every case), not a polymorphic relation. This is a deliberate, existing convention in the Kizunia schema (see [`folder-structure.md`](../../folder-structure.md) and [`relationships.md`](../relationships.md)) and the target architecture preserves it: **do not introduce a polymorphic `assetableType` / `assetableId` relation.** Each new use of Asset should add its own explicit, typed foreign key, exactly as the entities above already do.

The one existing *ordered* collection is `CompetitionSuggestionAsset`, which carries its own `order` column. Not every Asset relation is a gallery — a logo, a resume, and a single cover image have no ordering concept at all, and the Asset system itself has no opinion on ordering. Ordering is a concern of the consuming domain entity, not of Asset.

---

# Domain Responsibilities and Boundaries

## Asset vs. Storage Provider

Asset is the domain record: identity, lifecycle, metadata, category. The storage provider (Cloudinary today) is the infrastructure that actually holds the bytes and serves them. The Asset system depends on a storage-provider *contract*; it must not depend on Cloudinary specifics. See [`storage.md`](./storage.md).

## Asset vs. Uploader (UI)

An uploader is a specialized frontend component (an image uploader with cropping, a document uploader, a video uploader) that produces an upload. Asset is the resulting record. Multiple different uploaders can all end up creating Assets through the same underlying upload infrastructure. See [`upload.md`](./upload.md) for why Kizunia deliberately does **not** build one universal uploader component.

## Asset vs. Upload Policy

A policy answers "is this specific upload, for this specific purpose, by this specific actor, allowed?" (allowed MIME types, size limits, count limits, authorization). Asset itself has no opinion on what is allowed — it is the record that results once a policy has approved an upload and the upload has completed. See [`policies.md`](./policies.md).

---

# What Asset Is Not Responsible For

- Deciding who is allowed to upload, or what they're allowed to upload — that's [policy](./policies.md) and authorization.
- Talking to Cloudinary (or any provider) directly — that belongs behind the [storage-provider contract](./storage.md).
- Rendering upload UI, previews, cropping, or progress bars — those are uploader concerns.
- Ordering, display placement, or "is this the active one" semantics for a specific entity — those live on the join/relation the entity owns (e.g. `CompetitionSuggestionAsset.order`).

---

# Current State vs. Target State

| | Current Implementation | Target Architecture |
|---|---|---|
| Category | None — everything is implicitly an image | Explicit IMAGE / VIDEO / DOCUMENT |
| Lifecycle | None — an Asset row is created already "finished"; no state field exists | Explicit 4-state lifecycle: `ACTIVE`, `DETACHED`, `DELETING`, `DELETED` (see [`lifecycle.md`](./lifecycle.md)) |
| Provider coupling | Cloudinary concepts (`publicId`, `AssetProvider.CLOUDINARY`) live directly on the domain model; upload flow talks to Cloudinary straight from the browser | Storage-provider contract with a Cloudinary adapter behind it (see [`storage.md`](./storage.md)) |
| Upload authorization | A signing endpoint authenticates the caller and signs whatever parameters the client sends it | Upload intent scoped to a purpose, validated against a policy, before anything is authorized (see [`upload.md`](./upload.md), [`policies.md`](./policies.md)) |
| Deletion / cleanup | Not implemented at all — no delete-asset code path exists anywhere in the codebase today | Explicit DETACHED → DELETING → DELETED path with orphan reconciliation (see [`lifecycle.md`](./lifecycle.md), [`security.md`](./security.md)) |

The remaining documents in this folder describe the target in depth: [`lifecycle.md`](./lifecycle.md), [`upload.md`](./upload.md), [`policies.md`](./policies.md), [`storage.md`](./storage.md), [`security.md`](./security.md).

---

# Guiding Principle

> **An Asset is what Kizunia uploaded and now owns the record of — not what any particular storage provider happens to call it.**

Every architectural decision in this folder follows from keeping that distinction real, not just aspirational.
