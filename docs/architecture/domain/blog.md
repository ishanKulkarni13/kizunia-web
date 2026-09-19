# Blog

> **Status:** Stable
>
> **Version:** 1.0
>
> **Referenced By:** Users, Portfolios
>
> **Last Updated:** 2026-07-18

---

# Purpose

The Blog model represents long-form written content published on Kizunia.

Blogs allow builders to share knowledge, document experiences, explain projects, write tutorials, and publish engineering-related content.

Unlike project documentation, blogs are standalone pieces of content that are discoverable independently.

---

# Design Philosophy

Blogs represent knowledge.

Projects represent engineering work.

Although both use the same editor, they serve different purposes.

A blog may describe a project, but it is never the project itself.

Similarly, project documentation should explain a project rather than replace a blog.

---

# Responsibilities

The Blog model is responsible for:

- Blog identity
- Long-form content
- Publishing workflow
- Discoverability
- Media
- External links

The Blog model is **not** responsible for:

- Project documentation
- User profiles
- Team information
- Portfolio customization

---

# Identity

Every blog has a unique identity.

| Field | Required | Unique | Description |
|--------|----------|--------|-------------|
| id | Yes | Yes | Primary identifier. |
| title | Yes | No | Blog title. |
| slug | Yes | Yes | Human-readable URL identifier. |
| summary | Yes | No | Short description displayed in previews. |

---

# Slug

Blog URLs follow the format:

```
/blogs/{slug}
```

Examples:

```
/blogs/how-we-built-kizunia

/blogs/sih-experience

/blogs/react-performance-guide
```

Rules:

- Unique
- Editable
- Lowercase
- Letters
- Numbers
- Hyphen
- Reserved slugs prohibited

---

# Content

Every blog owns exactly one Markdown / MDX document.

Content is written using the shared Kizunia content editor.

Examples include:

- Tutorials
- Engineering articles
- Project stories
- Hackathon experiences
- Open-source write-ups

The blog content should remain flexible and should not attempt to model structured application data.

---

# Author

Every blog has exactly one author.

The author is represented through a relationship with the User model.

Future versions may support multiple authors if a clear product requirement emerges.

---

# Media

Blogs support reusable media.

Examples include:

- Cover image
- Gallery images

Media is represented using the reusable Media entity.

Videos should be embedded using external platforms rather than uploaded.

---

# Links

Blogs support reusable links.

Examples include:

- GitHub Repository
- Project Page
- Documentation
- YouTube
- Google Drive
- External References

Links are represented using the reusable Link entity.

---

# Visibility

Blogs support three visibility levels.

- Public
- Unlisted
- Private

Visibility controls who can access the blog.

---

# Publishing Workflow

Every blog follows a publishing workflow.

```
Draft

↓

Submitted

↓

Pending Review

↓

Published
```

Only published blogs become publicly visible.

---

# Review

Blogs written by users require approval before publication.

Platform Owners and Administrators are responsible for reviewing submissions.

Future versions may introduce trusted authors who can publish without manual review.

---

# Search

Blogs should be searchable using structured metadata.

Examples include:

- Title
- Summary
- Author
- Categories
- Technologies

Search should prioritize metadata rather than parsing the entire Markdown document.

---

# Categories

Blogs may belong to one or more categories.

Examples include:

- Tutorial
- Project Showcase
- Hackathon Experience
- Engineering
- Career
- Open Source

Categories improve discoverability.

---

# Technologies

**Not implemented — future work.** No `BlogTechnology` model, relation, migration, API, or UI exists yet; `Blog` itself has no Prisma model today (see the module status note above). This section records the intended design so a future implementation reuses the existing centralized Technology model rather than reinventing it — see [`technology.md`](./technology.md), the canonical Technology reference.

Blogs may eventually reference multiple Technology entities, meaning technologies **materially discussed, demonstrated, or relevant to** the blog post — closer to Competition's "relevant" framing than Project's "actually used" framing.

Examples include:

- React
- Java
- Flutter
- Prisma
- Better Auth

These relationships would improve filtering and recommendations.

A future `BlogTechnology` join table would mirror `ProjectTechnology`/`CompetitionTechnology`'s plain shape (`blogId`, `technologyId`, composite key) unless a concrete need for ordering or per-relationship metadata emerges. It would reference the same canonical, context-free Technology entity — Technology itself gains no Blog-specific awareness. Authorization for managing a Blog's technologies would be a future `BlogAction`-scoped permission, never the global `PlatformAction.MANAGE_TECHNOLOGIES`, following the same global-vs-consumer separation already established for Project/Competition/Portfolio.

---

# Design Decisions

## Why Separate Blogs from Documentation?

Documentation belongs to an entity.

Blogs are standalone content.

Keeping them separate produces a clearer user experience and simpler relationships.

---

## Why Review Blogs?

Kizunia is a curated community.

Reviewing blogs helps maintain quality while still allowing every builder to contribute.

---

## Why One Author?

Most engineering blogs have a single author.

Supporting multiple authors introduces additional complexity.

This capability can be introduced later if required.

---

## Future Expansion

Potential future capabilities include:

- Series
- Reading time
- Table of contents
- Reactions
- Comments
- Scheduled publishing
- Version history

These features should extend the Blog model without changing its core philosophy.

---

# Guiding Principle

The Blog model should answer one question:

> **What knowledge is this builder sharing?**

It should never attempt to replace project documentation or become a social media feed.

Its purpose is to preserve and share engineering knowledge with the community.